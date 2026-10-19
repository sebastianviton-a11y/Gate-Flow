-- ============================================================
-- Billing base (20261008100000_billing_base.sql): checkout, webhook
-- (billing_aplicar_evento), ciclo de vida y permisos. Solo corre con
-- la migración aplicada (fases B y OB del runner). La gracia y la
-- cancelación al final del periodo en tenant_operativo están en
-- 97_tenant_operativo_billing.sql; la concurrencia real (dos sesiones)
-- la prueba el runner.
--
-- Fixtures: A (aaaa…) y B (bbbb…), ambos active/alta_manual tras el
-- backfill; unidad activa a1… en A y b1… en B. admin_a (…000a),
-- guard_a (…00a9), admin_b (…000b), mixto (…00ab: admin en A,
-- guardia en B), super (…0001).
-- Las llamadas al servidor se simulan como service_role (el webhook y
-- las server actions usan esa clave); las verificaciones, como postgres.
-- ============================================================

create or replace function tests.billing() returns boolean language sql as $$
  -- Cualquier firma: 14 argumentos (20261008100000) o 15 con p_impago_desde
  -- (20261009000000); tests.ev llama con 14 posicionales, válido en ambas.
  select exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'billing_aplicar_evento');
$$;

-- Lo que hace la server action: crea el checkout con el monto del catálogo.
create or replace function tests.bc(p_user uuid, p_tenant uuid, p_plan text, p_monto bigint default 49900, p_moneda text default 'MXN')
returns uuid language plpgsql as $$
begin
  return (public.billing_crear_checkout(p_user, p_tenant, p_plan, 'stripe', p_moneda, p_monto, now() + interval '1 hour')->>'checkout_id')::uuid;
end $$;

-- Lo que hace el webhook tras verificar la firma y consultar a Stripe.
create or replace function tests.ev(p_event text, p_estado text, p_checkout text, p_sub text,
                                    p_cpe timestamptz default now() + interval '30 days', p_cancel boolean default false,
                                    p_monto bigint default 49900, p_moneda text default 'MXN', p_intervalo text default 'month',
                                    p_ref text default null, p_version timestamptz default clock_timestamp())
returns text language plpgsql as $$
begin
  -- Con 20261009000000 el servidor envía además el status del proveedor
  -- (un past_due sin él se rechaza para que el proveedor reintente).
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'billing_aplicar_evento' and pronargs = 16) then
    return public.billing_aplicar_evento('stripe', p_event, 'test.evento', p_estado, p_checkout, p_ref, p_sub, 'cus_test',
                                         p_cpe, p_cancel, p_version, p_moneda, p_monto, p_intervalo, p_estado_proveedor => p_estado)->>'resultado';
  end if;
  return public.billing_aplicar_evento('stripe', p_event, 'test.evento', p_estado, p_checkout, p_ref, p_sub, 'cus_test',
                                       p_cpe, p_cancel, p_version, p_moneda, p_monto, p_intervalo)->>'resultado';
end $$;

create or replace function tests.debe_fallar_msg(p_id text, p_desc text, p_sql text, p_fragmento text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like '%' || p_fragmento || '%' then
      perform tests.pass(p_id, p_desc || ' [' || sqlerrm || ']');
    else
      perform tests.fail(p_id, p_desc, 'falló con ' || sqlstate || ': ' || sqlerrm || ' (esperado ' || p_fragmento || ')');
    end if;
    return;
  end;
  perform tests.fail(p_id, p_desc, 'se ejecutó sin error');
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

do $$ begin
  if not tests.billing() then raise notice 'INFO|96_billing omitido: migración no aplicada'; end if;
end $$;

-- Sin la migración no se ejecuta nada más (ni las preparaciones).
select tests.billing() as hay_billing \gset
\if :hay_billing


-- ── Catálogo ──────────────────────────────────────────────────
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BB-00a', 'suscripciones: 7 columnas nuevas, nulas o con default (no rompen filas existentes)',
    $q$select string_agg(column_name || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by column_name)
       from information_schema.columns where table_schema = 'public' and table_name = 'suscripciones'
         and column_name in ('plan','provider','provider_customer_id','provider_subscription_id','current_period_end','cancel_at_period_end','provider_version_at')$q$,
    'cancel_at_period_end:NO:false,current_period_end:YES:-,plan:YES:-,provider:YES:-,provider_customer_id:YES:-,provider_subscription_id:YES:-,provider_version_at:YES:-');
  perform tests.igual('BB-00b', 'filas existentes intactas: sin plan ni proveedor, cancel_at_period_end=false',
    $q$select count(*) filter (where plan is null and provider is null and provider_subscription_id is null and not cancel_at_period_end)::text
         || '/' || count(*)::text from public.suscripciones$q$,
    (select count(*)::text || '/' || count(*)::text from public.suscripciones));
  perform tests.igual('BB-00c', 'RPC: DEFINER, search_path vacío, EXECUTE solo service_role',
    $q$select string_agg(p.proname || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-') || ':'
         || has_function_privilege('anon', p.oid, 'execute')::text || has_function_privilege('authenticated', p.oid, 'execute')::text
         || has_function_privilege('service_role', p.oid, 'execute')::text, ',' order by p.proname)
       from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('billing_crear_checkout','billing_registrar_checkout_proveedor','billing_aplicar_evento')$q$,
    'billing_aplicar_evento:true:search_path="":falsefalsetrue,billing_crear_checkout:true:search_path="":falsefalsetrue,billing_registrar_checkout_proveedor:true:search_path="":falsefalsetrue');
  perform tests.igual('BB-00d', 'funciones internas sin EXECUTE para la API',
    $q$select count(*)::text from pg_proc p, unnest(array['anon','authenticated','service_role']) r
       where p.proname in ('billing_limite_plan','billing_viviendas_requeridas') and has_function_privilege(r, p.oid, 'execute')$q$, '0');
  perform tests.igual('BB-00e', 'límites de plan en la base: 50 / 150 / mas-150 sin límite (sin checkout)',
    $q$select public.billing_limite_plan('hasta-50') || '/' || public.billing_limite_plan('hasta-150') || '/' || coalesce(public.billing_limite_plan('mas-150')::text, 'null')$q$,
    '50/150/null');
end $$;


-- ── 37–40. Permisos ───────────────────────────────────────────
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BP-01', 'anon, authenticated y service_role: ningún privilegio directo sobre billing_checkouts ni billing_eventos',
    $q$select count(*)::text from unnest(array['anon','authenticated','service_role']) r,
              unnest(array['public.billing_checkouts','public.billing_eventos']) t,
              unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
       where has_table_privilege(r, t, p)$q$, '0');
  perform tests.igual('BP-02', 'RLS activada y sin políticas en las tablas de billing',
    $q$select (select bool_and(relrowsecurity)::text from pg_class where oid in ('public.billing_checkouts'::regclass, 'public.billing_eventos'::regclass))
       || '/' || (select count(*)::text from pg_policies where tablename in ('billing_checkouts','billing_eventos'))$q$, 'true/0');
end $$;

begin;
set local role anon;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar('BP-37a', 'anon no lee billing_checkouts', $q$select count(*) from public.billing_checkouts$q$, '42501');
  perform tests.debe_fallar('BP-37b', 'anon no lee billing_eventos', $q$select count(*) from public.billing_eventos$q$, '42501');
  perform tests.debe_fallar('BP-37c', 'anon no ejecuta billing_aplicar_evento',
    $q$select tests.ev('evt_anon', 'active', null, 'sub_x')$q$, '42501');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar('BP-38a', 'admin_residencial no lee billing_checkouts', $q$select count(*) from public.billing_checkouts$q$, '42501');
  perform tests.debe_fallar('BP-38b', 'admin_residencial no inserta billing_eventos',
    $q$insert into public.billing_eventos (provider, provider_event_id, tipo) values ('stripe', 'evt_falso', 'x')$q$, '42501');
  perform tests.debe_fallar('BP-38c', 'admin_residencial no se activa a sí mismo (UPDATE suscripciones)',
    $q$update public.suscripciones set estado = 'active', provider = 'stripe' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('BP-38d', 'admin_residencial no ejecuta billing_crear_checkout desde el navegador',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50', 1)$q$, '42501');
  perform tests.debe_fallar('BP-38e', 'admin_residencial no ejecuta billing_aplicar_evento ("pagué")',
    $q$select tests.ev('evt_pague', 'active', null, 'sub_x')$q$, '42501');
  perform tests.igual('BP-38f', 'admin_residencial sí lee la suscripción de su residencial (sin cambios)',
    $q$select count(*)::text from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '1');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar('BP-40', 'guardia sin billing: ni tablas ni RPC',
    $q$select tests.bc('00000000-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, '42501');
end $$;
rollback;

begin;
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar('BP-39a', 'service_role tampoco lee billing_checkouts directo (solo RPC)', $q$select count(*) from public.billing_checkouts$q$, '42501');
  perform tests.debe_fallar('BP-39b', 'service_role tampoco escribe suscripciones directo', $q$update public.suscripciones set estado = 'active'$q$, '42501');
end $$;
rollback;


-- ── 1–10. Checkout ────────────────────────────────────────────
begin;
update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_funcionar('BC-01', 'admin_residencial de A, trial vencido: crea checkout hasta-50',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$);
  perform tests.debe_fallar_msg('BC-02', 'guardia de A rechazado',
    $q$select tests.bc('00000000-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:rol');
  perform tests.debe_fallar_msg('BC-03', 'admin de B no paga el residencial A (tenant equivocado)',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:rol');
  perform tests.debe_fallar_msg('BC-04a', 'multitenant: admin en A y guardia en B no paga B',
    $q$select tests.bc('00000000-0000-0000-0000-0000000000ab', 'bbbbbbbb-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:rol');
  perform tests.debe_funcionar('BC-04b', 'multitenant: el mismo usuario sí paga A (su rol en ESE residencial)',
    $q$select tests.bc('00000000-0000-0000-0000-0000000000ab', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$);
  perform tests.debe_fallar_msg('BC-05a', 'plan inexistente rechazado',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'gratis')$q$, 'billing:plan');
  perform tests.debe_fallar_msg('BC-05b', 'mas-150 no tiene checkout',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'mas-150')$q$, 'billing:plan');
  perform tests.debe_fallar_msg('BC-05c', 'super_admin no inicia checkout por este flujo',
    $q$select tests.bc('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:rol');
  perform tests.debe_fallar_msg('BC-05d', 'expires_at fuera de rango (5 min) rechazado',
    $q$select public.billing_crear_checkout('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50', 'stripe', 'MXN', 49900, now() + interval '5 minutes')$q$, 'billing:parametros');
  perform tests.debe_fallar_msg('BC-05e', 'monto 0 rechazado (CHECK)',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50', 0)$q$, 'billing_checkouts_monto_check');
end $$;
rollback;

-- 6–7. Viviendas: max(declaradas, unidades activas).
begin;
update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.unidades (tenant_id, tipo, identificador)
select 'aaaaaaaa-0000-0000-0000-000000000000', 'casa', 'TC-V-' || g from generate_series(1, 79) g;
insert into public.unidades (tenant_id, tipo, identificador, activo)
select 'aaaaaaaa-0000-0000-0000-000000000000', 'casa', 'TC-INACTIVA-' || g, false from generate_series(1, 100) g;
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar_msg('BC-06a', '80 unidades activas + hasta-50 → rechazado (aunque el request lo pida)',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:viviendas');
  perform tests.debe_funcionar('BC-06b', '80 unidades activas + hasta-150 → permitido (las inactivas no cuentan)',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-150', 89900)$q$);
end $$;
reset role;
update public.unidades set activo = false where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' and identificador like 'TC-V-%';
update public.suscripciones set viviendas_declaradas = 80 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar_msg('BC-06c', '80 declaradas (1 unidad cargada) + hasta-50 → rechazado',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:viviendas');
end $$;
reset role;
update public.suscripciones set viviendas_declaradas = 151 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar_msg('BC-07', 'más de 150 viviendas: ningún plan de autoservicio',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-150', 89900)$q$, 'billing:viviendas');
end $$;
rollback;

-- 9–10. Estado de la suscripción.
begin;
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar_msg('BC-09', 'residencial active (alta manual) no genera una alta duplicada',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:estado_no_permite');
end $$;
reset role;
update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '5 days', trial_ends_at = now() + interval '25 days'
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar_msg('BC-10', 'trial vigente: no se cobra todavía',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:estado_no_permite');
end $$;
reset role;
update public.suscripciones set trial_ends_at = now() - interval '1 second', trial_started_at = now() - interval '30 days'
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
update public.tenants set estado_servicio = 'suspendido' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar_msg('BC-11', 'residencial suspendido: sin checkout (lo atiende soporte)',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:suspendido');
end $$;
reset role;
update public.tenants set estado_servicio = 'activo' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
update public.suscripciones set estado = 'past_due', current_period_end = now() + interval '3 days' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_fallar_msg('BC-11b', 'past_due: no hay alta nueva (se actualiza la tarjeta en el portal)',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:estado_no_permite');
end $$;
reset role;
update public.suscripciones set estado = 'expired' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.debe_funcionar('BC-11c', 'expired: checkout permitido',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$);
end $$;
rollback;

-- 34 (secuencial). Un solo checkout abierto; límite de intentos.
begin;
update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$
declare v1 uuid; v2 jsonb;
begin
  if not tests.billing() then return; end if;
  v1 := tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50');
  perform public.billing_registrar_checkout_proveedor(v1, 'cs_test_primero');
  perform tests.debe_fallar_msg('BC-12a', 'el checkout se registra con el proveedor una sola vez',
    format($q$select public.billing_registrar_checkout_proveedor(%L, 'cs_test_otro')$q$, v1), 'billing:checkout_no_registrable');
  v2 := public.billing_crear_checkout('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50', 'stripe', 'MXN', 49900, now() + interval '1 hour');
  if v2->'anteriores' = '["cs_test_primero"]'::jsonb then
    perform tests.pass('BC-12b', 'un segundo checkout cancela el abierto y devuelve su id para expirarlo en Stripe');
  else
    perform tests.fail('BC-12b', 'un segundo checkout cancela el abierto', v2::text);
  end if;
  for i in 1..8 loop
    perform tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50');
  end loop;
  perform tests.debe_fallar_msg('BC-13', 'límite: 10 checkouts por hora y residencial',
    $q$select tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50')$q$, 'billing:limite_intentos');
end $$;
reset role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BC-12c', 'queda exactamente un checkout abierto (created) para el residencial',
    $q$select count(*) filter (where estado = 'created')::text || '/' || count(*) filter (where estado = 'canceled')::text
       from public.billing_checkouts where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '1/9');
  perform tests.igual('BC-12d', 'auditoría: un billing.checkout_iniciado por checkout, sin email ni tarjeta',
    $q$select count(*)::text || '/' || bool_or(datos_nuevos::text ~* '(email|@|card|tarjeta)')::text
       from public.audit_log where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' and accion = 'billing.checkout_iniciado'$q$, '10/false');
end $$;
rollback;


-- ── 11–36. Webhook y ciclo de vida ────────────────────────────
-- Recorrido completo sobre A: trial vencido → pago → renovación →
-- fallo → recuperación → cancelación pedida → cancelada → alta nueva.
begin;
update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
create temp table tc_huella on commit drop as
select (select count(*) from public.unidades where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') as unidades,
       (select count(*) from public.paquetes where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') as paquetes,
       (select id from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') as suscripcion_id,
       (select estado_servicio from public.tenants where id = 'aaaaaaaa-0000-0000-0000-000000000000') as estado_servicio;
grant select on tc_huella to service_role, authenticated;
set local role service_role;
do $$
declare v_c uuid;
begin
  if not tests.billing() then return; end if;
  v_c := tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50');
  perform public.billing_registrar_checkout_proveedor(v_c, 'cs_test_a1');
  perform tests.igual('BE-21', 'el checkout solo no activa nada (success URL / checkout creado ≠ pago)',
    $q$select tests.ev('evt_pendiente', 'ignorar', 'cs_test_a1', 'sub_a1')$q$, 'ignorado');
  perform tests.igual('BE-22', 'pago confirmado del trial vencido → aplicado',
    format($q$select tests.ev('evt_a1', 'active', 'cs_test_a1', 'sub_a1', p_ref => %L)$q$, v_c), 'aplicado');
  perform tests.igual('BE-14', 'mismo evento otra vez → duplicado, sin efectos',
    format($q$select tests.ev('evt_a1', 'active', 'cs_test_a1', 'sub_a1', p_ref => %L)$q$, v_c), 'duplicado');
  perform tests.igual('BE-15', 'snapshot más viejo que el aplicado → obsoleto',
    $q$select tests.ev('evt_viejo', 'past_due', 'cs_test_a1', 'sub_a1', p_version => now() - interval '1 hour')$q$, 'obsoleto');
end $$;
reset role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BE-22b', 'suscripción active, stripe, plan, ids del proveedor, cancel=false',
    $q$select estado || '/' || provider || '/' || plan || '/' || provider_subscription_id || '/' || provider_customer_id || '/' || cancel_at_period_end::text
              || '/' || (current_period_end > now())::text
       from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'active/stripe/hasta-50/sub_a1/cus_test/false/true');
  perform tests.igual('BE-23', 'mismos datos: misma suscripción, mismas unidades y paquetes, sin tenant nuevo',
    $q$select ((select id from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') = h.suscripcion_id)::text
              || '/' || ((select count(*) from public.unidades where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') = h.unidades)::text
              || '/' || ((select count(*) from public.paquetes where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') = h.paquetes)::text
              || '/' || ((select estado_servicio from public.tenants where id = 'aaaaaaaa-0000-0000-0000-000000000000') = h.estado_servicio)::text
       from tc_huella h$q$, 'true/true/true/true');
  perform tests.igual('BE-22c', 'checkout completed con su suscripción; eventos registrados sin payload',
    $q$select (select estado || '/' || provider_subscription_id from public.billing_checkouts where provider_checkout_id = 'cs_test_a1')
              || '/' || (select string_agg(provider_event_id || ':' || resultado, ',' order by recibido_at, provider_event_id) from public.billing_eventos)$q$,
    'completed/sub_a1/evt_a1:aplicado,evt_pendiente:ignorado,evt_viejo:obsoleto');
end $$;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BE-22d', 'tenant_operativo vuelve a true: Admin y Guard operan',
    $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'true');
end $$;
reset role;
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BE-25', 'renovación correcta: active → active con periodo nuevo',
    $q$select tests.ev('evt_a2', 'active', 'cs_test_a1', 'sub_a1', p_cpe => now() + interval '60 days')$q$, 'aplicado');
  perform tests.igual('BE-26', 'renovación fallida: active → past_due',
    $q$select tests.ev('evt_a3', 'past_due', 'cs_test_a1', 'sub_a1', p_cpe => now() + interval '60 days')$q$, 'aplicado');
  perform tests.igual('BE-29', 'pago recuperado: past_due → active',
    $q$select tests.ev('evt_a4', 'active', 'cs_test_a1', 'sub_a1', p_cpe => now() + interval '60 days')$q$, 'aplicado');
  perform tests.igual('BE-30', 'cancelación pedida: sigue active con cancel_at_period_end',
    $q$select tests.ev('evt_a5', 'active', 'cs_test_a1', 'sub_a1', p_cpe => now() + interval '60 days', p_cancel => true)$q$, 'aplicado');
  perform tests.igual('BE-32', 'fin del periodo: canceled',
    $q$select tests.ev('evt_a6', 'canceled', 'cs_test_a1', 'sub_a1', p_cpe => now() + interval '60 days')$q$, 'aplicado');
end $$;
reset role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BE-32b', 'auditoría del ciclo completo, en orden y sin datos personales',
    $q$select string_agg(accion, ',' order by created_at, accion) || '/' || bool_or(coalesce(datos_nuevos::text, '') ~* '(email|@|card|tarjeta)')::text
       from public.audit_log where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' and accion like 'billing.%' and accion <> 'billing.checkout_iniciado'$q$,
    -- created_at es now() (igual dentro de la transacción): el orden es alfabético.
    'billing.cancelacion_solicitada,billing.pago_fallido,billing.pago_recuperado,billing.periodo_renovado,billing.suscripcion_activada,billing.suscripcion_cancelada/false');
  perform tests.igual('BE-32c', 'canceled: cancel_at_period_end vuelve a false, nunca trialing',
    $q$select estado || '/' || cancel_at_period_end::text from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'canceled/false');
end $$;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BE-32d', 'canceled bloquea', $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'false');
end $$;
reset role;
set local role service_role;
do $$
declare v_c uuid;
begin
  if not tests.billing() then return; end if;
  v_c := tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-150', 89900);
  perform public.billing_registrar_checkout_proveedor(v_c, 'cs_test_a2');
  perform tests.igual('BE-33', 'alta nueva tras canceled: nueva suscripción reemplaza a la terminada',
    format($q$select tests.ev('evt_a7', 'active', 'cs_test_a2', 'sub_a2', p_monto => 89900, p_ref => %L)$q$, v_c), 'aplicado');
  perform tests.igual('BE-33b', 'eventos tardíos de la suscripción vieja se ignoran',
    $q$select tests.ev('evt_a8', 'canceled', 'cs_test_a1', 'sub_a1')$q$, 'ignorado');
end $$;
reset role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BE-33c', 'misma fila de suscripción, ahora hasta-150 con sub_a2',
    $q$select estado || '/' || plan || '/' || provider_subscription_id || '/' || ((select id from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') = (select suscripcion_id from tc_huella))::text
       from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'active/hasta-150/sub_a2/true');
end $$;
rollback;

-- 16–20. Eventos inválidos o ajenos.
begin;
update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
where tenant_id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000');
set local role service_role;
do $$
declare v_a uuid; v_b uuid;
begin
  if not tests.billing() then return; end if;
  v_a := tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50');
  perform public.billing_registrar_checkout_proveedor(v_a, 'cs_test_A');
  v_b := tests.bc('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'hasta-50');
  perform public.billing_registrar_checkout_proveedor(v_b, 'cs_test_B');
  perform tests.igual('BE-16', 'suscripción desconocida (sin checkout nuestro) → sin_asociacion',
    $q$select tests.ev('evt_x1', 'past_due', null, 'sub_desconocida')$q$, 'sin_asociacion');
  perform tests.igual('BE-17', 'checkout desconocido → sin_asociacion',
    $q$select tests.ev('evt_x2', 'active', 'cs_inventado', 'sub_x')$q$, 'sin_asociacion');
  perform tests.igual('BE-17b', 'client_reference_id que no es el de nuestro checkout → rechazado',
    format($q$select tests.ev('evt_x3', 'active', 'cs_test_A', 'sub_A', p_ref => %L)$q$, v_b), 'rechazado');
  perform tests.igual('BE-19', 'monto distinto al del checkout → rechazado',
    $q$select tests.ev('evt_x4', 'active', 'cs_test_A', 'sub_A', p_monto => 100)$q$, 'rechazado');
  perform tests.igual('BE-20', 'moneda distinta → rechazado',
    $q$select tests.ev('evt_x5', 'active', 'cs_test_A', 'sub_A', p_moneda => 'USD')$q$, 'rechazado');
  perform tests.igual('BE-20b', 'intervalo anual → rechazado',
    $q$select tests.ev('evt_x6', 'active', 'cs_test_A', 'sub_A', p_intervalo => 'year')$q$, 'rechazado');
  perform tests.igual('BE-20c', 'active sin fin de periodo → rechazado',
    $q$select tests.ev('evt_x7', 'active', 'cs_test_A', 'sub_A', p_cpe => null)$q$, 'rechazado');
  perform tests.igual('BE-20d', 'pago fallido antes de la primera activación → ignorado (sigue trialing)',
    $q$select tests.ev('evt_x8', 'past_due', 'cs_test_A', 'sub_A')$q$, 'ignorado');
  -- B se activa con su propio checkout.
  perform tests.igual('BE-18a', 'B se activa con SU checkout',
    $q$select tests.ev('evt_b1', 'active', 'cs_test_B', 'sub_B')$q$, 'aplicado');
  perform tests.igual('BE-18b', 'checkout de A con la suscripción de B → rechazado (A nunca toma la de B)',
    $q$select tests.ev('evt_x9', 'active', 'cs_test_A', 'sub_B')$q$, 'rechazado');
  perform tests.igual('BE-18c', 'evento de la suscripción de B sin checkout solo toca B',
    $q$select tests.ev('evt_b2', 'past_due', null, 'sub_B')$q$, 'aplicado');
  perform tests.igual('BE-17c', 'checkout expirado en el proveedor → aplicado sobre el checkout',
    $q$select tests.ev('evt_x10', 'checkout_expirado', 'cs_test_A', null)$q$, 'aplicado');
end $$;
reset role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BE-18d', 'A sigue en trial vencido sin proveedor; B past_due con sub_B',
    $q$select (select estado || '/' || coalesce(provider_subscription_id, '-') from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000')
              || ' ' || (select estado || '/' || provider_subscription_id from public.suscripciones where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000')
              || ' ' || (select estado from public.billing_checkouts where provider_checkout_id = 'cs_test_A')$q$,
    'trialing/- past_due/sub_B expired');
  perform tests.igual('BE-19b', 'los rechazos quedan registrados con su motivo, sin payload',
    $q$select string_agg(provider_event_id || ':' || resultado || ':' || coalesce(detalle->>'motivo', '-'), ',' order by provider_event_id)
       from public.billing_eventos where provider_event_id in ('evt_x3','evt_x4','evt_x5','evt_x9')$q$,
    'evt_x3:rechazado:referencia_no_coincide,evt_x4:rechazado:monto_no_coincide,evt_x5:rechazado:monto_no_coincide,evt_x9:rechazado:suscripcion_de_otro_tenant');
end $$;
rollback;

-- 24. Suspendido sigue suspendido aunque pague.
begin;
update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$
declare v_c uuid;
begin
  if not tests.billing() then return; end if;
  v_c := tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50');
  perform public.billing_registrar_checkout_proveedor(v_c, 'cs_test_s');
end $$;
reset role;
update public.tenants set estado_servicio = 'suspendido' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BE-24a', 'el pago de un residencial suspendido se registra',
    $q$select tests.ev('evt_s1', 'active', 'cs_test_s', 'sub_s')$q$, 'aplicado');
end $$;
reset role;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BE-24b', 'pero el residencial sigue suspendido y sin operar (billing no toca estado_servicio)',
    $q$select (select estado_servicio from public.tenants where id = 'aaaaaaaa-0000-0000-0000-000000000000') || '/' || public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$,
    'suspendido/false');
end $$;
rollback;

-- 34/36. Dos checkouts pagados: solo una suscripción queda vigente.
begin;
update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role service_role;
do $$
declare v1 uuid; v2 uuid;
begin
  if not tests.billing() then return; end if;
  v1 := tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50');
  perform public.billing_registrar_checkout_proveedor(v1, 'cs_test_d1');
  -- Otro admin (mixto) abre el suyo: el primero queda cancelado en la base,
  -- pero su pago (si llega) se acepta porque el checkout es nuestro.
  v2 := tests.bc('00000000-0000-0000-0000-0000000000ab', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50');
  perform public.billing_registrar_checkout_proveedor(v2, 'cs_test_d2');
  perform tests.igual('BE-34a', 'primer pago (checkout ya cancelado en la base) → aplicado',
    $q$select tests.ev('evt_d1', 'active', 'cs_test_d1', 'sub_d1')$q$, 'aplicado');
  perform tests.igual('BE-36a', 'segundo pago simultáneo → suscripcion_duplicada (el servidor la cancela)',
    $q$select tests.ev('evt_d2', 'active', 'cs_test_d2', 'sub_d2')$q$, 'suscripcion_duplicada');
  perform tests.igual('BE-36d', 'reintento del evento duplicado: sin efectos, pero informa el resultado original (el servidor reintenta cancelar)',
    $q$select r->>'resultado' || '/' || (r->>'resultado_original')
       from (select public.billing_aplicar_evento('stripe', 'evt_d2', 'test.evento', 'active', 'cs_test_d2', null, 'sub_d2', 'cus_test',
                                                  now() + interval '30 days', false, clock_timestamp(), 'MXN', 49900, 'month') as r) x$q$,
    'duplicado/suscripcion_duplicada');
  perform tests.igual('BE-36b', 'eventos posteriores de la duplicada no tocan nada',
    $q$select tests.ev('evt_d3', 'canceled', 'cs_test_d2', 'sub_d2')$q$, 'ignorado');
end $$;
reset role;
do $$ begin
  if not tests.billing() then return; end if;
  perform tests.igual('BE-36c', 'provider_subscription_id no se pisa: sigue la primera',
    $q$select estado || '/' || provider_subscription_id from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'active/sub_d1');
end $$;
rollback;
\endif
