-- ============================================================
-- 20261009000000: episodio de impago (suscripciones.impago_desde).
-- Gracia de past_due = 7 días desde el inicio del impago que informa el
-- proveedor (current_period_start del periodo impago), NO desde
-- current_period_end, que Stripe ya adelantó al periodo impago. Los
-- reintentos, duplicados y eventos fuera de orden no la reinician ni la
-- extienden; el pago la cierra; un impago posterior abre otra.
-- Solo corre con la migración aplicada (fase IM del runner).
-- Las RPC se llaman como service_role; las verificaciones, como postgres.
-- ============================================================

create or replace function tests.impago() returns boolean language sql as $$
  select to_regprocedure('public.billing_aplicar_evento(text,text,text,text,text,text,text,text,timestamptz,boolean,timestamptz,text,bigint,text,timestamptz,text)') is not null;
$$;
grant execute on function tests.impago() to anon, authenticated, service_role;

do $$ begin
  if not tests.impago() then raise notice 'INFO|99_billing_impago omitido: migración no aplicada'; end if;
end $$;

select tests.impago() as hay_impago_rpc \gset
\if :hay_impago_rpc

-- Lo que hace el webhook: evento normalizado con el inicio del impago.
create or replace function tests.evi(p_event text, p_estado text, p_sub text, p_impago timestamptz,
                                     p_version timestamptz default clock_timestamp(), p_checkout text default null,
                                     p_cpe timestamptz default now() + interval '28 days', p_estado_prov text default null)
returns text language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.billing_aplicar_evento('stripe', p_event, 'test.evento', p_estado, p_checkout, null, p_sub, 'cus_test',
                                     p_cpe, false, p_version, 'MXN', 49900, 'month', p_impago, coalesce(p_estado_prov, p_estado));
  reset role;
  return v->>'resultado';
end $$;

-- Estado de A: estado / impago_desde relativo a now() (en horas) / operativo.
-- Es plpgsql (nuevo snapshot por sentencia), así que ve lo que acaba de
-- escribir tests.evi en la MISMA sentencia; una subconsulta SQL no lo vería.
create or replace function tests.estado_a() returns text language plpgsql as $$
declare v_s public.suscripciones; v_op boolean;
begin
  select * into v_s from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.como('00000000-0000-0000-0000-00000000000a');
  set local role authenticated;
  v_op := public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000');
  reset role;
  return v_s.estado || '/' || coalesce(round(extract(epoch from v_s.impago_desde - now()) / 3600)::text, 'null') || 'h/' || v_op::text;
end $$;

create or replace function tests.huella_b() returns text language sql as $$
  select md5(row(s.*)::text) from public.suscripciones s where s.tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000';
$$;

-- ── Permisos de la firma nueva ────────────────────────────────
do $$ begin
  perform tests.igual('IM-00a', 'solo existe la firma de 16 argumentos (la de 14 se reemplazó): sin sobrecargas ambiguas',
    $q$select count(*)::text || '/' || max(pronargs)::text from pg_proc
       where pronamespace = 'public'::regnamespace and proname = 'billing_aplicar_evento'$q$, '1/16');
  perform tests.igual('IM-00b', 'EXECUTE solo para service_role; DEFINER y search_path vacío',
    $q$select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), '-') || '/'
         || has_function_privilege('anon', p.oid, 'execute')::text || has_function_privilege('authenticated', p.oid, 'execute')::text
         || has_function_privilege('service_role', p.oid, 'execute')::text || has_function_privilege('public', p.oid, 'execute')::text
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'billing_aplicar_evento'$q$,
    'true/search_path=""/falsefalsetruefalse');
  perform tests.igual('IM-00c', 'p_impago_desde y p_estado_proveedor son opcionales (la llamada de 14 argumentos resuelve a esta función)',
    $q$select pronargdefaults::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'billing_aplicar_evento'$q$, '2');
end $$;

select tests.como('00000000-0000-0000-0000-00000000000a');
set role authenticated;
do $$ begin
  if not tests.impago() then return; end if;
  perform tests.debe_fallar('IM-00d', 'un admin no puede llamar la RPC para fijar su propio impago_desde',
    $q$select public.billing_aplicar_evento('stripe', 'evt_x', 't', 'past_due', null, null, 'sub_x', 'cus_x', now(), false, now(), 'MXN', 1, 'month', now())$q$, '42501');
end $$;
reset role;

-- ── Ciclo completo sobre A ────────────────────────────────────
begin;
update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
create temp table im_b on commit drop as select tests.huella_b() as h;
do $$
declare v_c uuid; v_t0 timestamptz := now() - interval '2 days';
begin
  set local role service_role;
  v_c := (public.billing_crear_checkout('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50',
                                        'stripe', 'MXN', 49900, now() + interval '1 hour')->>'checkout_id')::uuid;
  perform public.billing_registrar_checkout_proveedor(v_c, 'cs_test_im1');
  reset role;

  -- Rechazo del pago inicial: incomplete → ignorar; nunca abre un impago.
  perform tests.igual('IM-01', 'rechazo del pago inicial (ignorar) aunque traiga fecha: ignorado, sigue en trial vencido, sin impago',
    $q$select tests.evi('evt_im_rech', 'ignorar', 'sub_im', now() - interval '1 hour', clock_timestamp(), 'cs_test_im1') || ' ' || tests.estado_a()$q$,
    'ignorado trialing/nullh/false');
  perform tests.igual('IM-02', 'pago confirmado: active, sin impago',
    $q$select tests.evi('evt_im_a1', 'active', 'sub_im', null, clock_timestamp(), 'cs_test_im1') || ' ' || tests.estado_a()$q$,
    'aplicado active/nullh/true');

  -- Renovación fallida: periodo ya adelantado (+28 d) e impago desde t0.
  perform tests.igual('IM-03', 'renovación fallida: past_due con impago_desde = inicio del periodo impago (−48 h), en gracia',
    format($q$select tests.evi('evt_im_f1', 'past_due', 'sub_im', %L) || ' ' || tests.estado_a()$q$, v_t0),
    'aplicado past_due/-48h/true');
  perform tests.igual('IM-04', 'reintento fallido con una fecha posterior: NO extiende (sigue −48 h)',
    format($q$select tests.evi('evt_im_f2', 'past_due', 'sub_im', %L) || ' ' || tests.estado_a()$q$, v_t0 + interval '3 days'),
    'aplicado past_due/-48h/true');
  perform tests.igual('IM-05', 'reintento sin fecha: conserva el inicio',
    $q$select tests.evi('evt_im_f3', 'past_due', 'sub_im', null) || ' ' || tests.estado_a()$q$,
    'aplicado past_due/-48h/true');
  perform tests.igual('IM-06', 'evento duplicado (mismo id) con otra fecha: duplicado, sin cambios',
    format($q$select tests.evi('evt_im_f2', 'past_due', 'sub_im', %L) || ' ' || tests.estado_a()$q$, now() - interval '1 hour'),
    'duplicado past_due/-48h/true');
  perform tests.igual('IM-07', 'evento fuera de orden (versión vieja): obsoleto, sin cambios',
    format($q$select tests.evi('evt_im_old', 'past_due', 'sub_im', %L, now() - interval '30 days') || ' ' || tests.estado_a()$q$, now() - interval '1 hour'),
    'obsoleto past_due/-48h/true');
  perform tests.igual('IM-08', 'fecha de impago futura (> versión + 5 min): descartada y registrada, sin cambios',
    format($q$select tests.evi('evt_im_fut', 'past_due', 'sub_im', %L) || ' ' || tests.estado_a()$q$, now() + interval '1 day'),
    'aplicado past_due/-48h/true');
  perform tests.igual('IM-08b', 'la fecha descartada queda en el detalle del evento (auditable)',
    $q$select (detalle ? 'impago_desde_descartado')::text from public.billing_eventos where provider_event_id = 'evt_im_fut'$q$, 'true');
  perform tests.igual('IM-09', 'una fecha anterior (p. ej. de un episodio previo) tampoco lo mueve: inmutable (−48 h)',
    format($q$select tests.evi('evt_im_f4', 'past_due', 'sub_im', %L) || ' ' || tests.estado_a()$q$, v_t0 - interval '1 day'),
    'aplicado past_due/-48h/true');

  -- Frontera exacta desde el inicio fijado por la RPC (no se toca la fila).
  update public.suscripciones set impago_desde = now() - interval '7 days' + interval '1 second' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.igual('IM-10a', '1 s antes de 7 días desde el impago (periodo +28 d): operativo',
    $q$select split_part(tests.estado_a(), '/', 3)$q$, 'true');
  update public.suscripciones set impago_desde = now() - interval '7 days' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.igual('IM-10b', 'REGRESIÓN: 7 días exactos desde el impago con periodo +28 d: bloqueado',
    $q$select tests.estado_a()$q$, 'past_due/-168h/false');
  perform tests.igual('IM-10c', 'otro reintento fallido con la gracia agotada: NO la reabre',
    $q$select tests.evi('evt_im_f5', 'past_due', 'sub_im', now() - interval '1 hour') || ' ' || tests.estado_a()$q$,
    'aplicado past_due/-168h/false');

  -- Recuperación y nuevo episodio.
  perform tests.igual('IM-11', 'pago exitoso: active, cierra el episodio (impago null) y recupera el acceso',
    $q$select tests.evi('evt_im_p1', 'active', 'sub_im', null, p_checkout => 'cs_test_im1') || ' ' || tests.estado_a()$q$,
    'aplicado active/nullh/true');
  perform tests.igual('IM-12', 'impago posterior: abre un episodio NUEVO desde su propio inicio (−1 h)',
    $q$select tests.evi('evt_im_g1', 'past_due', 'sub_im', now() - interval '1 hour') || ' ' || tests.estado_a()$q$,
    'aplicado past_due/-1h/true');
  perform tests.igual('IM-13', 'unpaid (normalizado a past_due) mantiene el inicio del episodio aunque traiga otra fecha',
    $q$select tests.evi('evt_im_g2', 'past_due', 'sub_im', now() - interval '30 minutes', p_estado_prov => 'unpaid') || ' ' || tests.estado_a()$q$,
    'aplicado past_due/-1h/true');
  perform tests.igual('IM-13b', 'unpaid: status real en el detalle del evento',
    $q$select detalle->>'estado_proveedor' from public.billing_eventos where provider_event_id = 'evt_im_g2'$q$, 'unpaid');

  -- Sin fecha fiable: falla cerrado; un evento posterior con fecha la fija.
  perform tests.igual('IM-14', 'pago exitoso: active', $q$select tests.evi('evt_im_p2', 'active', 'sub_im', null, p_checkout => 'cs_test_im1')$q$, 'aplicado');
  perform tests.igual('IM-14a', 'past_due sin fecha fiable: sin gracia (falla cerrado)',
    $q$select tests.evi('evt_im_h1', 'past_due', 'sub_im', null) || ' ' || tests.estado_a()$q$,
    'aplicado past_due/nullh/false');
  perform tests.igual('IM-14b', 'el siguiente evento con fecha fija el inicio (sin inventarlo)',
    $q$select tests.evi('evt_im_h2', 'past_due', 'sub_im', now() - interval '5 hours') || ' ' || tests.estado_a()$q$,
    'aplicado past_due/-5h/true');

  -- unpaid/paused sin episodio abierto (se perdió el past_due): no abre gracia.
  perform tests.evi('evt_im_p3', 'active', 'sub_im', null, p_checkout => 'cs_test_im1');
  perform tests.igual('IM-14c', 'active → unpaid directo con fecha: past_due SIN inicio (no abre gracia), bloqueado',
    $q$select tests.evi('evt_im_u1', 'past_due', 'sub_im', now() - interval '1 hour', p_estado_prov => 'unpaid') || ' ' || tests.estado_a()$q$,
    'aplicado past_due/nullh/false');
  perform tests.igual('IM-14d', 'paused tampoco abre gracia',
    $q$select tests.evi('evt_im_u2', 'past_due', 'sub_im', now() - interval '1 hour', p_estado_prov => 'paused') || ' ' || tests.estado_a()$q$,
    'aplicado past_due/nullh/false');

  -- Estado final canceled.
  perform tests.igual('IM-15', 'canceled: bloqueado y cierra el episodio',
    $q$select tests.evi('evt_im_c1', 'canceled', 'sub_im', now() - interval '5 hours') || ' ' || tests.estado_a()$q$,
    'aplicado canceled/nullh/false');

  perform tests.igual('IM-16', 'auditoría: impago_desde en datos_nuevos de cada aplicación, sin datos personales',
    $q$select count(*) filter (where datos_nuevos ? 'impago_desde')::text || '/' || count(*)::text || '/'
              || bool_or(coalesce(datos_nuevos::text, '') ~* '(email|@|card|tarjeta)')::text
       from public.audit_log where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' and accion like 'billing.%' and accion <> 'billing.checkout_iniciado'$q$,
    (select count(*)::text || '/' || count(*)::text || '/false' from public.audit_log
      where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' and accion like 'billing.%' and accion <> 'billing.checkout_iniciado'));
  perform tests.igual('IM-17', 'aislamiento: la suscripción de B no cambió en todo el ciclo',
    $q$select (tests.huella_b() = (select h from im_b))::text$q$, 'true');
end $$;
rollback;

-- Un evento de la suscripción de B no toca el episodio de A.
begin;
do $$
begin
  update public.suscripciones set estado = 'past_due', provider = 'stripe', provider_subscription_id = 'sub_imA', plan = 'hasta-50',
         current_period_end = now() + interval '28 days', impago_desde = now() - interval '2 days'
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  update public.suscripciones set estado = 'active', provider = 'stripe', provider_subscription_id = 'sub_imB', plan = 'hasta-50',
         current_period_end = now() + interval '28 days'
  where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000';
  perform tests.igual('IM-18a', 'past_due de B se aplica a B',
    $q$select tests.evi('evt_im_b1', 'past_due', 'sub_imB', now() - interval '1 hour')$q$, 'aplicado');
  perform tests.igual('IM-18b', 'B abre SU episodio (−1 h) y el de A queda intacto (−48 h)',
    $q$select string_agg(round(extract(epoch from impago_desde - now()) / 3600)::text, ',' order by tenant_id)
       from public.suscripciones where tenant_id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000')$q$,
    '-48,-1');
end $$;
rollback;

-- Llamada EXACTA del servidor anterior (14 argumentos, sin p_impago_desde
-- ni p_estado_proveedor) contra el esquema migrado.
begin;
do $$
begin
  update public.suscripciones set estado = 'active', provider = 'stripe', provider_subscription_id = 'sub_old', plan = 'hasta-50',
         current_period_end = now() + interval '28 days'
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  set local role service_role;
  perform tests.debe_fallar_msg('IM-20', 'servidor anterior + past_due: error billing:estado_proveedor_requerido (500 → el proveedor reintenta)',
    $q$select public.billing_aplicar_evento('stripe', 'evt_im_old1', 'invoice.payment_failed', 'past_due', null, null, 'sub_old', 'cus_test',
                                            now() + interval '28 days', false, clock_timestamp(), 'MXN', 49900, 'month')$q$, 'billing:estado_proveedor_requerido');
  reset role;
  perform tests.igual('IM-21', 'el past_due rechazado no se registró ni cambió la suscripción (el reintento se aplicará completo)',
    $q$select (select count(*) from public.billing_eventos where provider_event_id = 'evt_im_old1')::text || '/'
              || (select estado from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000')$q$, '0/active');
  set local role service_role;
  perform tests.igual('IM-22', 'servidor anterior + canceled (14 argumentos): se aplica',
    $q$select public.billing_aplicar_evento('stripe', 'evt_im_old2', 'customer.subscription.deleted', 'canceled', null, null, 'sub_old', 'cus_test',
                                            now() + interval '28 days', false, clock_timestamp(), 'MXN', 49900, 'month')->>'resultado'$q$, 'aplicado');
  reset role;
end $$;
rollback;
\endif
