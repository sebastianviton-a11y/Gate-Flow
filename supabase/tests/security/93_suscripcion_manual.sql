-- ============================================================
-- 20261013000000: administración manual de la suscripción desde Super
-- Admin (extender prueba, activar sin cobro, extender la activación).
-- Solo corre con la migración aplicada (fase SM del runner). Cada caso
-- prepara la suscripción de A como postgres, llama la RPC con el JWT de
-- quien corresponda (authenticated, como el panel) y verifica como
-- postgres. Todo dentro de BEGIN … ROLLBACK.
--   A  usuario: super (super_admin en P); admin_a/guard_a de A; solo
--   B  intacto en todos los casos
-- La concurrencia real (dos sesiones) está en concurrencia_suscripcion_manual.sh.
-- ============================================================

create or replace function tests.sm() returns boolean language sql as $$
  select to_regprocedure('public.superadmin_activar_suscripcion_manual(uuid,date,text)') is not null;
$$;
grant execute on function tests.sm() to anon, authenticated, service_role;

do $$ begin
  if not tests.sm() then raise notice 'INFO|93_suscripcion_manual omitido: migración no aplicada'; end if;
end $$;

select tests.sm() as hay_sm \gset
\if :hay_sm

-- Resultado de una llamada con el JWT de p_uid (rol authenticated, como
-- PostgREST): 'resultado' del jsonb, o 'ERR:<sqlstate>:<mensaje>'.
create or replace function tests.sm_llamar(p_uid uuid, p_sql text, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare v jsonb;
begin
  perform tests.como(p_uid);
  execute format('set local role %I', p_rol);
  execute 'select ' || p_sql into v;
  reset role;
  return v->>'resultado';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- ¿El admin de A puede operar A? (tenant_operativo con su JWT)
create or replace function tests.sm_operativo(p_uid uuid default '00000000-0000-0000-0000-00000000000a',
                                              p_tenant uuid default 'aaaaaaaa-0000-0000-0000-000000000000') returns boolean
language plpgsql as $$
declare v boolean;
begin
  perform tests.como(p_uid);
  set local role authenticated;
  v := public.tenant_operativo(p_tenant);
  reset role;
  return v;
end $$;

-- Hoy en la zona de A (la fecha "hasta" es un día local).
create or replace function tests.sm_hoy(p_tenant uuid default 'aaaaaaaa-0000-0000-0000-000000000000') returns date
language sql as $$
  select (now() at time zone t.timezone)::date from public.tenants t where t.id = p_tenant;
$$;

create or replace function tests.sm_fin(p_fecha date, p_tenant uuid default 'aaaaaaaa-0000-0000-0000-000000000000') returns timestamptz
language sql as $$
  select ((p_fecha + 1)::timestamp at time zone t.timezone) from public.tenants t where t.id = p_tenant;
$$;

create or replace function tests.sm_ok(p_id text, p_desc text, p_cond boolean, p_detalle text default '') returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) then perform tests.pass(p_id, p_desc); else perform tests.fail(p_id, p_desc, coalesce(p_detalle, '')); end if;
end $$;

create or replace function tests.sm_huella(p_tenant uuid) returns text language sql as $$
  select md5(row(s.*)::text) from public.suscripciones s where s.tenant_id = p_tenant;
$$;

-- Prepara A (como postgres).
create or replace function tests.sm_trial_a(p_fin interval) returns void language sql as $$
  update public.suscripciones set estado = 'trialing', origen = 'registro_publico', plan = null,
         trial_started_at = now() - interval '40 days', trial_ends_at = now() + p_fin,
         current_period_end = null, cancel_at_period_end = false, impago_desde = null,
         provider = null, provider_subscription_id = null, provider_customer_id = null
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
$$;

-- ── Permisos y forma de las funciones ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.superadmin_extender_trial(uuid,date)', 'public.superadmin_activar_suscripcion_manual(uuid,date,text)',
                           'public.superadmin_extender_suscripcion_manual(uuid,date)'] loop
    perform tests.sm_ok('SM-00', f || ': SECURITY DEFINER, search_path vacío, EXECUTE solo authenticated (sin PUBLIC, anon ni service_role)',
      (select p.prosecdef and p.proconfig = array['search_path=""']
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and not has_function_privilege('anon', p.oid, 'EXECUTE')
              and not has_function_privilege('service_role', p.oid, 'EXECUTE')
              and not exists (select 1 from unnest(p.proacl) a where a::text like '=%')
       from pg_proc p where p.oid = f::regprocedure),
      (select coalesce(array_to_string(p.proacl, ','), 'acl nula') from pg_proc p where p.oid = f::regprocedure));
  end loop;
  perform tests.sm_ok('SM-00b', 'suscripcion_fin_dia_local: interna (invoker, nadie de la API la ejecuta)',
    (select not p.prosecdef and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
            and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')
     from pg_proc p where p.oid = 'public.suscripcion_fin_dia_local(date,text)'::regprocedure));
  perform tests.sm_ok('SM-00c', 'fin del día local: 30/11 en Cancún → 01/12 05:00 UTC; en Buenos Aires → 01/12 03:00 UTC',
    public.suscripcion_fin_dia_local('2026-11-30', 'America/Cancun') = '2026-12-01 05:00:00+00'
    and public.suscripcion_fin_dia_local('2026-11-30', 'America/Argentina/Buenos_Aires') = '2026-12-01 03:00:00+00');
  perform tests.sm_ok('SM-00d', 'authenticated sigue sin INSERT/UPDATE/DELETE en suscripciones (solo las funciones escriben)',
    not has_table_privilege('authenticated', 'public.suscripciones', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.suscripciones', 'INSERT')
    and not has_table_privilege('authenticated', 'public.suscripciones', 'DELETE'));
end $$;

-- ── H. Solo Super Admin ───────────────────────────────────────
begin;
select tests.sm_trial_a(interval '-1 day');
do $$
declare
  v_huella text := tests.sm_huella('aaaaaaaa-0000-0000-0000-000000000000');
  d date := tests.sm_hoy() + 10;
  u record;
  r text;
  llamadas text[] := array[
    format('public.superadmin_extender_trial(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d),
    format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', d),
    format('public.superadmin_extender_suscripcion_manual(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d)];
  q text;
begin
  for u in select * from (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'admin_residencial de A'),
                                 ('00000000-0000-0000-0000-0000000000a9'::uuid, 'guardia de A'),
                                 ('00000000-0000-0000-0000-0000000000f1'::uuid, 'admin_residencial de la plataforma (no super)'),
                                 ('00000000-0000-0000-0000-000000000099'::uuid, 'autenticado sin rol')) x(uid, quien) loop
    foreach q in array llamadas loop
      r := tests.sm_llamar(u.uid, q);
      perform tests.sm_ok('SM-H1', u.quien || ' no puede: ' || split_part(q, '(', 1), r like 'ERR:42501:suscripcion_manual:no_autorizado%', r);
    end loop;
  end loop;
  foreach q in array llamadas loop
    r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', q, 'anon');
    perform tests.sm_ok('SM-H2', 'anon (cliente público) sin EXECUTE: ' || split_part(q, '(', 1), r like 'ERR:42501:permission denied%', r);
    r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', q, 'service_role');
    perform tests.sm_ok('SM-H3', 'service_role sin EXECUTE: ' || split_part(q, '(', 1), r like 'ERR:42501:permission denied%', r);
  end loop;
  begin
    perform tests.como('00000000-0000-0000-0000-000000000001');
    set local role authenticated;
    update public.suscripciones set estado = 'active' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
    reset role;
    r := 'actualizó';
  exception when others then
    r := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  perform tests.sm_ok('SM-H4', 'ni Super Admin puede hacer UPDATE directo sobre suscripciones (sin grant): solo vía RPC', r like 'ERR:42501:%', r);
  perform tests.sm_ok('SM-H5', 'ninguno de los intentos cambió la suscripción de A', tests.sm_huella('aaaaaaaa-0000-0000-0000-000000000000') = v_huella);
end $$;
rollback;

-- ── A. Extender una prueba vigente ────────────────────────────
begin;
select tests.sm_trial_a(interval '5 days');
do $$
declare d date := tests.sm_hoy() + 20; r text; s public.suscripciones; n_s bigint := (select count(*) from public.suscripciones);
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_trial(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d));
  select * into s from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.sm_ok('SM-A1', 'prueba vigente extendida: aplicado, sigue trialing, trial_ends_at = fin del día local elegido',
    r = 'aplicado' and s.estado = 'trialing' and s.trial_ends_at = tests.sm_fin(d), r || ' ' || s.estado || ' ' || s.trial_ends_at);
  perform tests.sm_ok('SM-A2', 'sin proveedor ni plan ni periodo: no toca Stripe/Mercado Pago',
    s.provider is null and s.provider_subscription_id is null and s.provider_customer_id is null and s.plan is null
    and s.current_period_end is null and not s.cancel_at_period_end and s.origen = 'registro_publico');
  perform tests.sm_ok('SM-A3', 'no se crea otra suscripción', (select count(*) from public.suscripciones) = n_s);
  perform tests.sm_ok('SM-A4', 'el residencial sigue operativo', tests.sm_operativo());
end $$;
rollback;

-- ── B. Extender una prueba vencida ────────────────────────────
begin;
select tests.sm_trial_a(interval '-3 days');
do $$
declare d date := tests.sm_hoy() + 15; r text; antes boolean := tests.sm_operativo();
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_trial(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d));
  perform tests.sm_ok('SM-B1', 'prueba vencida: no operativo antes; extendida → operativo otra vez',
    not antes and r = 'aplicado' and tests.sm_operativo(), antes::text || ' ' || r);
  perform tests.sm_ok('SM-B2', 'trial_ends_at = fin del día local elegido',
    (select trial_ends_at from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') = tests.sm_fin(d));
end $$;
rollback;

begin;
select tests.sm_trial_a(interval '-3 days');
do $$
declare r text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_trial(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy()));
  perform tests.sm_ok('SM-B3', 'hasta HOY (local) es válido: opera hasta la medianoche local', r = 'aplicado' and tests.sm_operativo(), r);
end $$;
rollback;

-- ── C/D/E. Activar manualmente ────────────────────────────────
begin;
select tests.sm_trial_a(interval '-2 days');
do $$
declare
  d date := tests.sm_hoy() + 45; r text; s public.suscripciones;
  n_ck bigint := (select count(*) from public.billing_checkouts);
  n_ev bigint := (select count(*) from public.billing_eventos);
  n_s bigint := (select count(*) from public.suscripciones);
  antes boolean := tests.sm_operativo();
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d, 'hasta-50'));
  select * into s from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.sm_ok('SM-C1', 'prueba vencida → active, alta_manual, vence al fin del día local, sin renovación automática',
    r = 'aplicado' and s.estado = 'active' and s.origen = 'alta_manual' and s.plan = 'hasta-50'
    and s.current_period_end = tests.sm_fin(d) and s.cancel_at_period_end and s.impago_desde is null,
    r || ' ' || s.estado || ' ' || s.origen || ' ' || coalesce(s.current_period_end::text, 'null'));
  perform tests.sm_ok('SM-C2', 'provider sigue NULL (sin proveedor ficticio)', s.provider is null and s.provider_subscription_id is null and s.provider_customer_id is null);
  perform tests.sm_ok('SM-C3', 'no operativo antes; operativo después (tenant_operativo sin cambios)', not antes and tests.sm_operativo());
  perform tests.sm_ok('SM-C4', 'ningún billing_checkout ni billing_evento creado; una sola suscripción',
    (select count(*) from public.billing_checkouts) = n_ck and (select count(*) from public.billing_eventos) = n_ev
    and (select count(*) from public.suscripciones) = n_s);
end $$;
rollback;

begin;
select tests.sm_trial_a(interval '20 days');
do $$
declare r text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 60));
  perform tests.sm_ok('SM-C5', 'activar durante una prueba vigente (sin plan de catálogo) → active hasta la fecha', r = 'aplicado'
    and (select estado || '/' || coalesce(plan, '-') from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 'active/-', r);
end $$;
rollback;

begin;
select tests.sm_trial_a(interval '20 days');
do $$
declare r text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 5));
  perform tests.sm_ok('SM-C6', 'activar con una fecha ANTERIOR al fin de la prueba vigente → fecha_anterior (no acorta el acceso)',
    r like 'ERR:22023:suscripcion_manual:fecha_anterior%', r);
end $$;
rollback;

begin;
update public.suscripciones set estado = 'canceled', origen = 'registro_publico', trial_started_at = null, trial_ends_at = null,
       current_period_end = null, cancel_at_period_end = false, provider = null where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
do $$
declare r text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  perform tests.sm_ok('SM-D1', 'canceled (sin proveedor) → active manual y operativo', r = 'aplicado' and tests.sm_operativo(), r);
end $$;
rollback;

begin;
update public.suscripciones set estado = 'expired', origen = 'registro_publico', trial_started_at = now() - interval '60 days', trial_ends_at = now() - interval '30 days',
       current_period_end = null, cancel_at_period_end = false, provider = null where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
do $$
declare r text; antes boolean := tests.sm_operativo();
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  perform tests.sm_ok('SM-E1', 'expired → active manual y operativo', not antes and r = 'aplicado' and tests.sm_operativo(), r);
end $$;
rollback;

-- ── F. Extender una activación manual ─────────────────────────
begin;
select tests.sm_trial_a(interval '-1 day');
do $$
declare d1 date := tests.sm_hoy() + 30; d2 date := tests.sm_hoy() + 90; r1 text; r2 text; r3 text;
begin
  r1 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', d1));
  r2 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_suscripcion_manual(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d2));
  perform tests.sm_ok('SM-F1', 'active manual extendida: sigue active, nueva fecha', r1 = 'aplicado' and r2 = 'aplicado'
    and (select estado = 'active' and current_period_end = tests.sm_fin(d2) and cancel_at_period_end from public.suscripciones
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') and tests.sm_operativo(), r1 || ' ' || r2);
  r3 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_suscripcion_manual(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d1));
  perform tests.sm_ok('SM-F2', 'extender a una fecha anterior → fecha_anterior (nunca acorta)', r3 like 'ERR:22023:suscripcion_manual:fecha_anterior%', r3);
  r3 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 120));
  perform tests.sm_ok('SM-F3', 'activar otra vez sobre una activación manual → ya_activa_manual (se usa extender)', r3 like 'ERR:22023:suscripcion_manual:ya_activa_manual%', r3);
  -- Vencida (el reloj pasó la fecha): se puede extender y vuelve a operar.
  update public.suscripciones set current_period_end = now() - interval '2 days' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  r3 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_suscripcion_manual(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 10));
  perform tests.sm_ok('SM-F4', 'activación manual vencida: no operativo; extendida → operativo', r3 = 'aplicado' and tests.sm_operativo(), r3);
end $$;
rollback;

-- ── G. Fechas y parámetros inválidos ──────────────────────────
begin;
select tests.sm_trial_a(interval '10 days');
do $$
declare
  a constant text := 'aaaaaaaa-0000-0000-0000-000000000000';
  v_huella text := tests.sm_huella('aaaaaaaa-0000-0000-0000-000000000000');
  c record; r text;
begin
  for c in select * from (values
    ('SM-G1', 'prueba: fecha pasada', format('public.superadmin_extender_trial(%L, %L)', a, tests.sm_hoy() - 1), 'fecha_pasada'),
    ('SM-G2', 'prueba: más de 180 días', format('public.superadmin_extender_trial(%L, %L)', a, tests.sm_hoy() + 181), 'fecha_lejana'),
    ('SM-G3', 'prueba: anterior al fin vigente (no acorta)', format('public.superadmin_extender_trial(%L, %L)', a, tests.sm_hoy() + 3), 'fecha_anterior'),
    ('SM-G4', 'prueba: fecha nula', format('public.superadmin_extender_trial(%L, null)', a), 'parametros'),
    ('SM-G5', 'activar: fecha pasada', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', a, tests.sm_hoy() - 1), 'fecha_pasada'),
    ('SM-G6', 'activar: más de 2 años', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', a, (tests.sm_hoy() + interval '2 years 1 day')::date), 'fecha_lejana'),
    ('SM-G7', 'activar: plan fuera del catálogo', format('public.superadmin_activar_suscripcion_manual(%L, %L, %L)', a, tests.sm_hoy() + 30, 'oro'), 'plan_invalido'),
    ('SM-G8', 'activar: tenant nulo', format('public.superadmin_activar_suscripcion_manual(null, %L, null)', tests.sm_hoy() + 30), 'parametros'),
    ('SM-G9', 'extender vigencia sobre una prueba', format('public.superadmin_extender_suscripcion_manual(%L, %L)', a, tests.sm_hoy() + 30), 'estado_no_permite')
  ) x(id, descr, llamada, codigo) loop
    r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', c.llamada);
    perform tests.sm_ok(c.id, c.descr || ' → ' || c.codigo, r like 'ERR:22023:suscripcion_manual:' || c.codigo || '%', r);
  end loop;
  perform tests.sm_ok('SM-G10', 'ningún intento inválido cambió la suscripción', tests.sm_huella('aaaaaaaa-0000-0000-0000-000000000000') = v_huella);
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', a, (tests.sm_hoy() + interval '2 years')::date));
  perform tests.sm_ok('SM-G11', 'activar justo a 2 años: permitido', r = 'aplicado', r);
end $$;
rollback;

-- Plan vs viviendas (misma regla que el checkout: max(declaradas, unidades activas)).
begin;
select tests.sm_trial_a(interval '-1 day');
update public.suscripciones set viviendas_declaradas = 120 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
do $$
declare r text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30, 'hasta-50'));
  perform tests.sm_ok('SM-G12', '120 viviendas con plan hasta-50 → plan_insuficiente', r like 'ERR:22023:suscripcion_manual:plan_insuficiente%', r);
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30, 'hasta-150'));
  perform tests.sm_ok('SM-G13', '120 viviendas con plan hasta-150 → aplicado', r = 'aplicado', r);
end $$;
rollback;

-- Pago en curso con el proveedor (checkout abierto).
begin;
select tests.sm_trial_a(interval '-1 day');
insert into public.billing_checkouts (tenant_id, user_id, plan, provider, moneda, monto, expires_at)
values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'hasta-50', 'stripe', 'MXN', 49900, now() + interval '30 minutes');
do $$
declare r text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  perform tests.sm_ok('SM-G14', 'checkout abierto del residencial → checkout_abierto (no se pisa un pago en curso)', r like 'ERR:22023:suscripcion_manual:checkout_abierto%', r);
end $$;
rollback;

-- ── I/J. Tenant o suscripción inexistentes ────────────────────
begin;
insert into public.tenants (id, nombre, tipo, empresa_id) values ('cccccccc-0000-0000-0000-000000000000', 'Residencial sin suscripción', 'residencial', 'e0000000-0000-0000-0000-000000000001');
do $$
declare r text; f text;
begin
  foreach f in array array['superadmin_extender_trial(%L, %L)', 'superadmin_activar_suscripcion_manual(%L, %L, null)', 'superadmin_extender_suscripcion_manual(%L, %L)'] loop
    r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.' || f, 'dddddddd-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
    perform tests.sm_ok('SM-I1', 'tenant inexistente → tenant_inexistente: ' || split_part(f, '(', 1), r like 'ERR:22023:suscripcion_manual:tenant_inexistente%', r);
    r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.' || f, 'cccccccc-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
    perform tests.sm_ok('SM-J1', 'residencial sin suscripción → sin_suscripcion: ' || split_part(f, '(', 1), r like 'ERR:22023:suscripcion_manual:sin_suscripcion%', r);
  end loop;
  perform tests.sm_ok('SM-J2', 'no se crea una suscripción para el residencial que no tenía',
    not exists (select 1 from public.suscripciones where tenant_id = 'cccccccc-0000-0000-0000-000000000000'));
end $$;
rollback;

-- ── K. Doble envío ────────────────────────────────────────────
begin;
select tests.sm_trial_a(interval '-1 day');
do $$
declare d date := tests.sm_hoy() + 30; r1 text; r2 text; r3 text; r4 text; v_sus uuid;
begin
  select s.id into v_sus from public.suscripciones s where s.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  r1 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', d));
  r2 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', d));
  perform tests.sm_ok('SM-K1', 'activar dos veces con la misma fecha → aplicado + sin_cambios; una sola auditoría',
    r1 = 'aplicado' and r2 = 'sin_cambios'
    and (select count(*) from public.audit_log where entidad_id = v_sus and accion = 'superadmin.suscripcion_activada_manual') = 1, r1 || ' ' || r2);
  r3 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_suscripcion_manual(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d + 10));
  r4 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_suscripcion_manual(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d + 10));
  perform tests.sm_ok('SM-K2', 'extender dos veces con la misma fecha → aplicado + sin_cambios; una sola auditoría',
    r3 = 'aplicado' and r4 = 'sin_cambios'
    and (select count(*) from public.audit_log where entidad_id = v_sus and accion = 'superadmin.suscripcion_vigencia_extendida') = 1, r3 || ' ' || r4);
end $$;
rollback;

begin;
select tests.sm_trial_a(interval '-1 day');
do $$
declare d date := tests.sm_hoy() + 30; r1 text; r2 text;
begin
  r1 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_trial(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d));
  r2 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_trial(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d));
  perform tests.sm_ok('SM-K3', 'extender la prueba dos veces con la misma fecha → aplicado + sin_cambios; una sola auditoría',
    r1 = 'aplicado' and r2 = 'sin_cambios'
    and (select count(*) from public.audit_log where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' and accion = 'superadmin.trial_extendido') = 1, r1 || ' ' || r2);
end $$;
rollback;

-- ── M/N. Gestionada por un proveedor: bloqueada ───────────────
begin;
update public.suscripciones set estado = 'active', origen = 'registro_publico', plan = 'hasta-50', provider = 'stripe',
       provider_subscription_id = 'sub_test_sm', provider_customer_id = 'cus_test_sm',
       current_period_end = now() + interval '20 days', cancel_at_period_end = false
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
do $$
declare v_huella text := tests.sm_huella('aaaaaaaa-0000-0000-0000-000000000000'); r text; f text;
begin
  foreach f in array array['superadmin_extender_trial(%L, %L)', 'superadmin_activar_suscripcion_manual(%L, %L, null)', 'superadmin_extender_suscripcion_manual(%L, %L)'] loop
    r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.' || f, 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
    perform tests.sm_ok('SM-M1', 'Stripe active → gestionada_por_proveedor: ' || split_part(f, '(', 1), r like 'ERR:22023:suscripcion_manual:gestionada_por_proveedor%', r);
  end loop;
  perform tests.sm_ok('SM-M2', 'la suscripción de Stripe queda idéntica (provider, ids, periodo)', tests.sm_huella('aaaaaaaa-0000-0000-0000-000000000000') = v_huella);
end $$;
rollback;

begin;
update public.suscripciones set estado = 'canceled', origen = 'registro_publico', plan = 'hasta-50', provider = 'stripe',
       provider_subscription_id = 'sub_test_sm_cancelada', provider_customer_id = 'cus_test_sm',
       current_period_end = now() - interval '3 days', cancel_at_period_end = false
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
do $$
declare v_huella text := tests.sm_huella('aaaaaaaa-0000-0000-0000-000000000000'); r text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  perform tests.sm_ok('SM-N1', 'canceled de Stripe con provider_subscription_id → gestionada_por_proveedor; no se altera el id',
    r like 'ERR:22023:suscripcion_manual:gestionada_por_proveedor%' and tests.sm_huella('aaaaaaaa-0000-0000-0000-000000000000') = v_huella, r);
end $$;
rollback;

begin;
select tests.sm_trial_a(interval '-1 day');
update public.suscripciones set provider_customer_id = 'cus_huerfano' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
do $$
declare r text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  perform tests.sm_ok('SM-N2', 'solo con cliente del proveedor (provider_customer_id) también se bloquea', r like 'ERR:22023:suscripcion_manual:gestionada_por_proveedor%', r);
end $$;
rollback;

-- Alta manual anterior al trial (active sin vencimiento): no se toca.
begin;
update public.suscripciones set estado = 'active', origen = 'alta_manual', plan = null, trial_started_at = null, trial_ends_at = null,
       current_period_end = null, cancel_at_period_end = false, provider = null, provider_subscription_id = null, provider_customer_id = null
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
do $$
declare v_huella text := tests.sm_huella('aaaaaaaa-0000-0000-0000-000000000000'); r1 text; r2 text; r3 text;
begin
  r1 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  r2 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_suscripcion_manual(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  r3 := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_trial(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  perform tests.sm_ok('SM-L0', 'alta manual sin vencimiento: no se le pone fecha (activa_sin_vencimiento / estado_no_permite) y queda idéntica',
    r1 like 'ERR:22023:suscripcion_manual:activa_sin_vencimiento%' and r2 like 'ERR:22023:suscripcion_manual:activa_sin_vencimiento%'
    and r3 like 'ERR:22023:suscripcion_manual:estado_no_permite%' and tests.sm_huella('aaaaaaaa-0000-0000-0000-000000000000') = v_huella,
    r1 || ' | ' || r2 || ' | ' || r3);
end $$;
rollback;

-- ── O. Otro tenant intacto · R. sin duplicados ────────────────
begin;
select tests.sm_trial_a(interval '-1 day');
do $$
declare
  hb text := tests.sm_huella('bbbbbbbb-0000-0000-0000-000000000000');
  hp text := tests.sm_huella('11111111-0000-0000-0000-000000000000');
  n_s bigint := (select count(*) from public.suscripciones);
  r text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_trial(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 5));
  r := r || '/' || tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  r := r || '/' || tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_extender_suscripcion_manual(%L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 60));
  perform tests.sm_ok('SM-O1', 'tres acciones sobre A: B y la plataforma quedan idénticos',
    r = 'aplicado/aplicado/aplicado' and tests.sm_huella('bbbbbbbb-0000-0000-0000-000000000000') = hb
    and tests.sm_huella('11111111-0000-0000-0000-000000000000') = hp, r);
  perform tests.sm_ok('SM-O2', 'B sigue operativo para su admin y A no se volvió visible para él',
    tests.sm_operativo('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000')
    and not tests.sm_operativo('00000000-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000000'));
  perform tests.sm_ok('SM-R1', 'sin suscripciones nuevas ni duplicadas (una por residencial)',
    (select count(*) from public.suscripciones) = n_s
    and (select count(*) from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 1);
end $$;
rollback;

-- ── P. Llegada exacta a current_period_end ────────────────────
begin;
select tests.sm_trial_a(interval '-1 day');
do $$
declare r text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  -- now() es fijo dentro de la transacción: el reloj "llega" moviendo la fecha.
  update public.suscripciones set current_period_end = now() + interval '1 microsecond' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.sm_ok('SM-P1', 'un microsegundo antes del vencimiento: operativo', r = 'aplicado' and tests.sm_operativo(), r);
  update public.suscripciones set current_period_end = now() where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.sm_ok('SM-P2', 'en el instante exacto del vencimiento: deja de ser operativo (no queda activo indefinido)', not tests.sm_operativo());
  perform tests.sm_ok('SM-P3', 'y sigue active con su fecha: no hace falta cron ni webhook para cortar',
    (select estado = 'active' and cancel_at_period_end from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'));
  perform tests.sm_ok('SM-P4', 'el guardia de A también queda bloqueado al vencer',
    not tests.sm_operativo('00000000-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-000000000000'));
end $$;
rollback;

-- México: al vencer una activación manual se puede contratar con Stripe; mientras rige, no.
begin;
select tests.sm_trial_a(interval '-1 day');
do $$
declare r text; ck text;
begin
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, null)', 'aaaaaaaa-0000-0000-0000-000000000000', tests.sm_hoy() + 30));
  begin
    set local role service_role;
    perform public.billing_crear_checkout('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50', 'stripe', 'MXN', 49900, now() + interval '1 hour');
    reset role;
    ck := 'creado';
  exception when others then
    ck := sqlerrm;
  end;
  perform tests.sm_ok('SM-P5', 'activación manual vigente: el checkout de Stripe no se ofrece (billing:estado_no_permite)', r = 'aplicado' and ck = 'billing:estado_no_permite', ck);
  update public.suscripciones set current_period_end = now() - interval '1 second' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  begin
    set local role service_role;
    perform public.billing_crear_checkout('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50', 'stripe', 'MXN', 49900, now() + interval '1 hour');
    reset role;
    ck := 'creado';
  exception when others then
    ck := sqlerrm;
  end;
  perform tests.sm_ok('SM-P6', 'vencida: el residencial puede contratar con Stripe (regla existente de billing_crear_checkout)', ck = 'creado', ck);
end $$;
rollback;

-- ── Q. Auditoría ──────────────────────────────────────────────
begin;
select tests.sm_trial_a(interval '-1 day');
do $$
declare d date := tests.sm_hoy() + 30; r text; a public.audit_log; v_sus uuid;
begin
  select s.id into v_sus from public.suscripciones s where s.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  r := tests.sm_llamar('00000000-0000-0000-0000-000000000001', format('public.superadmin_activar_suscripcion_manual(%L, %L, %L)', 'aaaaaaaa-0000-0000-0000-000000000000', d, 'hasta-50'));
  select * into a from public.audit_log where entidad_id = v_sus and accion = 'superadmin.suscripcion_activada_manual';
  perform tests.sm_ok('SM-Q1', 'auditoría: tenant, suscripción, acción, actor (super) y momento',
    r = 'aplicado' and a.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' and a.entidad = 'suscripciones'
    and a.user_id = '00000000-0000-0000-0000-000000000001' and a.created_at = now(), coalesce(a.accion, 'sin fila'));
  perform tests.sm_ok('SM-Q2', 'estado y fechas anteriores → nuevos',
    a.datos_anteriores->>'estado' = 'trialing' and (a.datos_anteriores->>'trial_ends_at')::timestamptz < now()
    and a.datos_anteriores->>'current_period_end' is null
    and a.datos_nuevos->>'estado' = 'active' and (a.datos_nuevos->>'current_period_end')::timestamptz = tests.sm_fin(d)
    and a.datos_nuevos->>'hasta' = d::text and a.datos_nuevos->>'cobro' = 'ninguno', a.datos_anteriores::text || ' → ' || a.datos_nuevos::text);
  perform tests.sm_ok('SM-Q3', 'sin datos personales, secretos ni tokens en la auditoría',
    (a.datos_anteriores::text || a.datos_nuevos::text) !~* '@|email|correo|telefono|token|secret|nombre' and a.ip_address is null and a.user_agent is null);
end $$;
rollback;

\endif
