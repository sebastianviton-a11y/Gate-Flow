-- ============================================================
-- Batería billing + lifecycle — capa B (base de datos).
--
-- El MISMO archivo corre contra la base local desechable
-- (tests/billing/db/run-local.sh) y, solo con opt-in explícito, contra
-- staging (tests/billing/staging/run-staging.sh). NUNCA confirma nada:
--
--   1. abre una transacción (begin) y no hay ningún commit;
--   2. el bloque final SIEMPRE termina con una excepción que lleva los
--      resultados ("GF_AUTOTEST_RESULTADOS:{json}") → rollback total,
--      también si quien lo ejecuta olvida el rollback;
--   3. aun así, el teardown se ejecuta y se verifica DENTRO de la
--      transacción (solo por los ids registrados, con marca sintética,
--      contando filas y abortando si el número no coincide) y se
--      comprueba que los datos reales no cambiaron (hash antes/después).
--
-- Fixtures: prefijo ZZ_AUTOTEST_<fecha>_<azar> en empresa, tenants y
-- usuarios (email zz_autotest+…@gateflow.invalid, dominio reservado:
-- nunca se envía correo), observaciones 'gf-autotest:<run>', eventos
-- evt_<run>_…, checkouts cs_test_<run>_…, suscripciones sub_<run>_….
-- El tiempo se controla con instantes relativos a now() (estable en la
-- transacción); nunca se cambia el reloj.
-- Los montos replican lib/billing/catalogo.ts (un test TS lo verifica).
-- ============================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '180s';

-- ── Helpers (pg_temp: viven solo en esta sesión y se revierten) ───────

create function pg_temp.gf_r(p_r jsonb, p_e text, p_c text, p_ok boolean, p_d text default null)
returns jsonb language sql as $$
  select p_r || jsonb_build_array(jsonb_build_object('e', p_e, 'c', p_c, 'ok', coalesce(p_ok, false), 'd', coalesce(p_d, '')));
$$;

-- null si el SQL funciona; si falla, "SQLSTATE: mensaje".
create function pg_temp.gf_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- tenant_operativo evaluado como lo evalúa PostgREST: JWT simulado + rol authenticated.
create function pg_temp.gf_op(p_uid uuid, p_tenant uuid) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.tenant_operativo(p_tenant);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise;
end $$;

create function pg_temp.gf_checkout(p_user uuid, p_tenant uuid, p_plan text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  v := public.billing_crear_checkout(p_user, p_tenant, p_plan, 'stripe', 'MXN',
         case p_plan when 'hasta-50' then 49900 when 'hasta-150' then 89900 else 1 end,
         now() + interval '60 minutes');
  return jsonb_build_object('ok', true) || v;
exception when others then
  return jsonb_build_object('ok', false, 'err', sqlerrm);
end $$;

-- p_impago: inicio del impago que normaliza el servidor (solo past_due).
-- p_estado_prov: status real del proveedor (por defecto, el normalizado).
create function pg_temp.gf_evento(p_event text, p_tipo text, p_estado text, p_cs text, p_ref text, p_sub text, p_cus text,
                                  p_cpe timestamptz, p_cancel boolean, p_ver timestamptz, p_moneda text, p_monto bigint,
                                  p_impago timestamptz default null, p_estado_prov text default null)
returns jsonb language plpgsql as $$
begin
  return public.billing_aplicar_evento('stripe', p_event, p_tipo, p_estado, p_cs, p_ref, p_sub, p_cus, p_cpe, p_cancel, p_ver,
                                       p_moneda, p_monto, 'month', p_impago, coalesce(p_estado_prov, p_estado));
exception when others then
  return jsonb_build_object('resultado', 'error', 'err', sqlerrm);
end $$;

-- La llamada EXACTA del servidor anterior a 20261009000000 (14 argumentos,
-- sin inicio de impago ni status del proveedor).
create function pg_temp.gf_evento_antiguo(p_event text, p_tipo text, p_estado text, p_cs text, p_ref text, p_sub text, p_cus text,
                                          p_cpe timestamptz, p_cancel boolean, p_ver timestamptz, p_moneda text, p_monto bigint)
returns jsonb language plpgsql as $$
begin
  return public.billing_aplicar_evento('stripe', p_event, p_tipo, p_estado, p_cs, p_ref, p_sub, p_cus, p_cpe, p_cancel, p_ver,
                                       p_moneda, p_monto, 'month');
exception when others then
  return jsonb_build_object('resultado', 'error', 'err', sqlerrm);
end $$;

create function pg_temp.gf_hs(p_tenant uuid) returns text language sql as $$
  select md5(s::text) from public.suscripciones s where s.tenant_id = p_tenant;
$$;

-- Hash de TODO lo que no es sintético (datos reales).
create function pg_temp.gf_hash_reales(p_run text, p_tenants uuid[], p_users uuid[]) returns text language sql as $$
  select md5(concat_ws('#',
    (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.tenants t where t.id <> all (p_tenants)),
    (select md5(coalesce(string_agg(s::text, '|' order by s.id), '')) from public.suscripciones s where s.tenant_id <> all (p_tenants)),
    (select md5(coalesce(string_agg(u::text, '|' order by u.id), '')) from public.user_tenants u where u.tenant_id <> all (p_tenants) and u.user_id <> all (p_users)),
    (select md5(coalesce(string_agg(c::text, '|' order by c.id), '')) from public.billing_checkouts c where c.tenant_id <> all (p_tenants)),
    (select md5(coalesce(string_agg(e::text, '|' order by e.id), '')) from public.billing_eventos e where left(e.provider_event_id, length('evt_' || p_run)) <> 'evt_' || p_run),
    (select md5(coalesce(string_agg(u::text, '|' order by u.id), '')) from public.users u where u.id <> all (p_users)),
    (select md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.unidades x where x.tenant_id <> all (p_tenants)),
    (select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) from public.empresas m where m.nombre <> p_run),
    (select count(*)::text || ':' || coalesce(max(a.created_at)::text, '-') from public.audit_log a
      where coalesce(a.tenant_id <> all (p_tenants), true) and coalesce(a.user_id <> all (p_users), true))
  ));
$$;

\ir teardown.sql

-- ── Escenarios ────────────────────────────────────────────────────────

do $pack$
declare
  v_run text := 'ZZ_AUTOTEST_' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS') || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
  v_marca text;
  r jsonb := '[]'::jsonb;
  reg jsonb;
  v_emp uuid;
  v_rol_admin uuid; v_rol_guardia uuid; v_rol_residente uuid; v_rol_super uuid;
  -- tenants
  t_trial uuid; t_venc uuid; t_pago uuid; t_b uuid; t_elig uuid; t_marca uuid;
  -- usuarios
  u_admin_trial uuid; u_guard_trial uuid; u_admin_venc uuid; u_guard_venc uuid; u_admin_pago uuid; u_guard_pago uuid;
  u_residente uuid; u_admin_b uuid; u_sin_tenant uuid; u_super uuid; u_admin_elig uuid; u_multi uuid; u_marca uuid;
  v_hash_antes text; v_hash_despues text;
  v_conteo_antes jsonb; v_conteo_despues jsonb; v_borradas jsonb;
  v jsonb; v2 jsonb; v_txt text; v_txt2 text; v_n int; v_b boolean; v_b2 boolean;
  c1 uuid; c2 uuid; v_hs text; v_hs_b text;
  v_ver timestamptz := now();
  v_eventos text[] := '{}';
  v_ev text;
  v_cs1 text; v_cs2 text; v_sub_a text; v_sub_a2 text; v_sub_b text; v_cus_a text;
  v_impago timestamptz; v_impago2 timestamptz;
begin
  v_marca := 'gf-autotest:' || v_run;
  v_cs1 := 'cs_test_' || v_run || '_1'; v_cs2 := 'cs_test_' || v_run || '_2';
  v_sub_a := 'sub_' || v_run || '_A'; v_sub_a2 := 'sub_' || v_run || '_A2'; v_sub_b := 'sub_' || v_run || '_B';
  v_cus_a := 'cus_' || v_run || '_A';

  -- Residuos previos de corridas anteriores (no debería haber: nada se confirma).
  select count(*) into v_n from public.tenants where left(nombre, 12) = 'ZZ_AUTOTEST_';
  r := pg_temp.gf_r(r, '00', 'sin residuos ZZ_AUTOTEST_ previos en el destino', v_n = 0, v_n || ' tenants');

  select id into v_rol_admin from public.roles where clave = 'admin_residencial';
  select id into v_rol_guardia from public.roles where clave = 'guardia';
  select id into v_rol_residente from public.roles where clave = 'residente';
  select id into v_rol_super from public.roles where clave = 'super_admin';

  -- Hash de datos reales ANTES (sin ids sintéticos todavía).
  v_hash_antes := pg_temp.gf_hash_reales(v_run, '{}'::uuid[], '{}'::uuid[]);

  -- ── Fixtures ──
  insert into public.empresas (nombre, observaciones) values (v_run, v_marca) returning id into v_emp;

  insert into public.tenants (nombre, tipo, timezone, plan, estado_servicio, onboarding_completado, empresa_id, observaciones)
  values (v_run || '_TRIAL', 'residencial', 'America/Mexico_City', 'trial', 'activo', true, v_emp, v_marca) returning id into t_trial;
  insert into public.tenants (nombre, tipo, timezone, plan, estado_servicio, onboarding_completado, empresa_id, observaciones)
  values (v_run || '_VENCIDO', 'residencial', 'America/Mexico_City', 'trial', 'activo', true, v_emp, v_marca) returning id into t_venc;
  insert into public.tenants (nombre, tipo, timezone, plan, estado_servicio, onboarding_completado, empresa_id, observaciones)
  values (v_run || '_PAGO', 'residencial', 'America/Mexico_City', 'trial', 'activo', true, v_emp, v_marca) returning id into t_pago;
  insert into public.tenants (nombre, tipo, timezone, plan, estado_servicio, onboarding_completado, empresa_id, observaciones)
  values (v_run || '_B', 'residencial', 'America/Mexico_City', 'trial', 'activo', true, v_emp, v_marca) returning id into t_b;
  insert into public.tenants (nombre, tipo, timezone, plan, estado_servicio, onboarding_completado, empresa_id, observaciones)
  values (v_run || '_ELIG', 'residencial', 'America/Mexico_City', 'trial', 'activo', true, v_emp, v_marca) returning id into t_elig;
  insert into public.tenants (nombre, tipo, timezone, plan, estado_servicio, onboarding_completado, empresa_id, observaciones)
  values (v_run || '_MARCA', 'residencial', 'America/Mexico_City', 'trial', 'activo', true, v_emp, v_marca) returning id into t_marca;

  insert into public.suscripciones (tenant_id, estado, origen, trial_started_at, trial_ends_at, viviendas_declaradas) values
    (t_trial, 'trialing', 'registro_publico', now() - interval '5 days', now() + interval '25 days', 40),
    (t_venc, 'trialing', 'registro_publico', now() - interval '31 days', now() - interval '1 second', 40),
    (t_pago, 'trialing', 'registro_publico', now() - interval '31 days', now() - interval '1 hour', 40),
    (t_elig, 'trialing', 'registro_publico', now() - interval '31 days', now() - interval '1 hour', 30),
    (t_marca, 'trialing', 'registro_publico', now() - interval '1 day', now() + interval '29 days', 10);
  -- B: ya pagado con su propia suscripción del proveedor.
  insert into public.suscripciones (tenant_id, estado, origen, viviendas_declaradas, plan, provider, provider_customer_id,
                                    provider_subscription_id, current_period_end, cancel_at_period_end, provider_version_at)
  values (t_b, 'active', 'registro_publico', 20, 'hasta-50', 'stripe', 'cus_' || v_run || '_B', v_sub_b,
          now() + interval '20 days', false, now() - interval '1 hour');

  -- Usuarios como los crea GoTrue (el trigger crea public.users).
  insert into auth.users (id, email, raw_user_meta_data)
  select gen_random_uuid(), 'zz_autotest+' || lower(v_run) || '-' || k || '@gateflow.invalid', jsonb_build_object('nombre_completo', v_run)
  from unnest(array['admin_trial','guard_trial','admin_venc','guard_venc','admin_pago','guard_pago','residente','admin_b',
                    'sin_tenant','super','admin_elig','multi','marca']) k;
  select id into u_admin_trial from auth.users where email = 'zz_autotest+' || lower(v_run) || '-admin_trial@gateflow.invalid';
  select id into u_guard_trial from auth.users where email = 'zz_autotest+' || lower(v_run) || '-guard_trial@gateflow.invalid';
  select id into u_admin_venc from auth.users where email = 'zz_autotest+' || lower(v_run) || '-admin_venc@gateflow.invalid';
  select id into u_guard_venc from auth.users where email = 'zz_autotest+' || lower(v_run) || '-guard_venc@gateflow.invalid';
  select id into u_admin_pago from auth.users where email = 'zz_autotest+' || lower(v_run) || '-admin_pago@gateflow.invalid';
  select id into u_guard_pago from auth.users where email = 'zz_autotest+' || lower(v_run) || '-guard_pago@gateflow.invalid';
  select id into u_residente from auth.users where email = 'zz_autotest+' || lower(v_run) || '-residente@gateflow.invalid';
  select id into u_admin_b from auth.users where email = 'zz_autotest+' || lower(v_run) || '-admin_b@gateflow.invalid';
  select id into u_sin_tenant from auth.users where email = 'zz_autotest+' || lower(v_run) || '-sin_tenant@gateflow.invalid';
  select id into u_super from auth.users where email = 'zz_autotest+' || lower(v_run) || '-super@gateflow.invalid';
  select id into u_admin_elig from auth.users where email = 'zz_autotest+' || lower(v_run) || '-admin_elig@gateflow.invalid';
  select id into u_multi from auth.users where email = 'zz_autotest+' || lower(v_run) || '-multi@gateflow.invalid';
  select id into u_marca from auth.users where email = 'zz_autotest+' || lower(v_run) || '-marca@gateflow.invalid';

  insert into public.user_tenants (user_id, tenant_id, rol_id) values
    (u_admin_trial, t_trial, v_rol_admin), (u_guard_trial, t_trial, v_rol_guardia),
    (u_admin_venc, t_venc, v_rol_admin), (u_guard_venc, t_venc, v_rol_guardia),
    (u_admin_pago, t_pago, v_rol_admin), (u_guard_pago, t_pago, v_rol_guardia), (u_residente, t_pago, v_rol_residente),
    (u_admin_b, t_b, v_rol_admin),
    (u_super, t_b, v_rol_super),           -- super_admin (membresía en un tenant sintético)
    (u_admin_elig, t_elig, v_rol_admin),
    (u_multi, t_elig, v_rol_admin), (u_multi, t_venc, v_rol_guardia),
    (u_marca, t_marca, v_rol_admin);

  insert into public.unidades (tenant_id, tipo, identificador)
  select t, 'casa', 'ZZ ' || g from unnest(array[t_venc, t_pago]) t, generate_series(1, 3) g;
  insert into public.calles (tenant_id, nombre) values (t_venc, v_run || ' calle');

  reg := jsonb_build_object('empresa', v_emp,
    'tenants', jsonb_build_array(t_trial, t_venc, t_pago, t_b, t_elig, t_marca),
    'users', jsonb_build_array(u_admin_trial, u_guard_trial, u_admin_venc, u_guard_venc, u_admin_pago, u_guard_pago, u_residente,
                               u_admin_b, u_sin_tenant, u_super, u_admin_elig, u_multi, u_marca),
    'eventos', '[]'::jsonb);

  -- Los fixtures existen y ninguno es real.
  select count(*) into v_n from public.users where id = any (array[u_admin_trial, u_guard_trial, u_admin_venc, u_guard_venc, u_admin_pago,
    u_guard_pago, u_residente, u_admin_b, u_sin_tenant, u_super, u_admin_elig, u_multi, u_marca]) and nombre_completo = v_run;
  r := pg_temp.gf_r(r, '00', 'fixtures sintéticos creados (13 usuarios con marca)', v_n = 13, v_n::text);

  -- ═════ 1. Trial activo ═════
  r := pg_temp.gf_r(r, '01', 'trial activo: admin operativo', pg_temp.gf_op(u_admin_trial, t_trial), null);
  r := pg_temp.gf_r(r, '01', 'trial activo: guardia operativo', pg_temp.gf_op(u_guard_trial, t_trial), null);
  v := pg_temp.gf_checkout(u_admin_trial, t_trial, 'hasta-50');
  r := pg_temp.gf_r(r, '01', 'trial activo: no se cobra (billing:estado_no_permite)', v->>'err' like '%billing:estado_no_permite%', v::text);
  select count(*) into v_n from public.billing_checkouts where tenant_id = t_trial;
  r := pg_temp.gf_r(r, '01', 'trial activo: 0 checkouts', v_n = 0, v_n::text);

  -- ═════ 2. Trial vencido ═════
  r := pg_temp.gf_r(r, '02', 'trial vencido: admin NO operativo', not pg_temp.gf_op(u_admin_venc, t_venc), null);
  r := pg_temp.gf_r(r, '02', 'trial vencido: guardia NO operativo', not pg_temp.gf_op(u_guard_venc, t_venc), null);
  update public.suscripciones set trial_ends_at = now() where tenant_id = t_venc;
  r := pg_temp.gf_r(r, '02', 'trial vencido: frontera exacta (trial_ends_at = now) NO operativo', not pg_temp.gf_op(u_admin_venc, t_venc), null);
  update public.suscripciones set trial_ends_at = now() + interval '1 second' where tenant_id = t_venc;
  r := pg_temp.gf_r(r, '02', 'trial: 1 s antes del fin sigue operativo', pg_temp.gf_op(u_admin_venc, t_venc), null);
  update public.suscripciones set trial_ends_at = now() - interval '1 second' where tenant_id = t_venc;
  select count(*) into v_n from public.unidades where tenant_id = t_venc;
  select count(*) into v_txt from public.calles where tenant_id = t_venc;
  r := pg_temp.gf_r(r, '02', 'trial vencido: datos preservados (3 unidades, 1 calle, estado sigue trialing)',
                    v_n = 3 and v_txt = '1' and (select estado from public.suscripciones where tenant_id = t_venc) = 'trialing',
                    v_n || ' unidades, ' || v_txt || ' calles');

  -- ═════ 17. Roles (antes de cualquier checkout de PAGO) ═════
  v := pg_temp.gf_checkout(u_guard_pago, t_pago, 'hasta-50');
  r := pg_temp.gf_r(r, '17', 'guardia no puede pagar (billing:rol)', v->>'err' like '%billing:rol%', v::text);
  v := pg_temp.gf_checkout(u_residente, t_pago, 'hasta-50');
  r := pg_temp.gf_r(r, '17', 'residente no puede pagar (billing:rol)', v->>'err' like '%billing:rol%', v::text);
  v := pg_temp.gf_checkout(u_sin_tenant, t_pago, 'hasta-50');
  r := pg_temp.gf_r(r, '17', 'usuario sin tenant no puede pagar (billing:rol)', v->>'err' like '%billing:rol%', v::text);
  v := pg_temp.gf_checkout(u_super, t_pago, 'hasta-50');
  r := pg_temp.gf_r(r, '17', 'super_admin no paga por este flujo (billing:rol, lógica existente)', v->>'err' like '%billing:rol%', v::text);
  r := pg_temp.gf_r(r, '17', 'super_admin: tenant_operativo true aun con trial vencido (excepción administrativa)', pg_temp.gf_op(u_super, t_venc), null);
  r := pg_temp.gf_r(r, '17', 'residente: no opera con el trial vencido', not pg_temp.gf_op(u_residente, t_pago), null);
  r := pg_temp.gf_r(r, '17', 'usuario sin tenant: no opera', not pg_temp.gf_op(u_sin_tenant, t_pago), null);
  select count(*) into v_n from public.billing_checkouts where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '17', 'roles rechazados no crearon checkouts', v_n = 0, v_n::text);

  -- ═════ 18. Multitenant ═════
  v := pg_temp.gf_checkout(u_admin_b, t_pago, 'hasta-50');
  r := pg_temp.gf_r(r, '18', 'admin de B no crea checkout para PAGO (billing:rol)', v->>'err' like '%billing:rol%', v::text);
  v := pg_temp.gf_checkout(u_multi, t_venc, 'hasta-50');
  r := pg_temp.gf_r(r, '18', 'admin en ELIG + guardia en VENCIDO: no paga VENCIDO (rol evaluado por tenant)', v->>'err' like '%billing:rol%', v::text);
  r := pg_temp.gf_r(r, '18', 'admin de TRIAL no opera PAGO (sin membresía)', not pg_temp.gf_op(u_admin_trial, t_pago), null);
  r := pg_temp.gf_r(r, '18', 'admin de B no opera VENCIDO', not pg_temp.gf_op(u_admin_b, t_venc), null);
  r := pg_temp.gf_r(r, '18', 'admin de B opera B (activo)', pg_temp.gf_op(u_admin_b, t_b), null);
  update public.user_tenants set activo = false where user_id = u_admin_b and tenant_id = t_b;
  r := pg_temp.gf_r(r, '18', 'membresía desactivada: no opera', not pg_temp.gf_op(u_admin_b, t_b), null);
  update public.user_tenants set activo = true where user_id = u_admin_b and tenant_id = t_b;

  -- ═════ 3. Checkout válido ═════
  v := pg_temp.gf_checkout(u_admin_pago, t_pago, 'hasta-999');
  r := pg_temp.gf_r(r, '03', 'plan inexistente rechazado (billing:plan)', v->>'err' like '%billing:plan%', v::text);
  v_txt := pg_temp.gf_err(format('select public.billing_crear_checkout(%L, %L, %L, %L, %L, %s, now() + interval ''10 minutes'')',
                                 u_admin_pago, t_pago, 'hasta-50', 'stripe', 'MXN', 49900));
  r := pg_temp.gf_r(r, '03', 'vigencia < 29 min rechazada (billing:parametros)', v_txt like '%billing:parametros%', v_txt);
  v := pg_temp.gf_checkout(u_admin_pago, t_pago, 'hasta-50');
  c1 := (v->>'checkout_id')::uuid;
  r := pg_temp.gf_r(r, '03', 'admin_residencial crea checkout', (v->>'ok')::boolean and c1 is not null, v::text);
  select count(*) into v_n from public.billing_checkouts where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '03', 'exactamente 1 billing_checkout', v_n = 1, v_n::text);
  select concat_ws('/', plan, monto, moneda, estado, provider, (user_id = u_admin_pago)) into v_txt from public.billing_checkouts where id = c1;
  r := pg_temp.gf_r(r, '03', 'plan/monto/moneda/estado correctos (hasta-50/49900/MXN/created)', v_txt = 'hasta-50/49900/MXN/created/stripe/t', v_txt);
  r := pg_temp.gf_r(r, '03', 'sin activación antes del webhook (sigue trialing, no operativo)',
                    (select estado from public.suscripciones where tenant_id = t_pago) = 'trialing' and not pg_temp.gf_op(u_admin_pago, t_pago), null);
  perform public.billing_registrar_checkout_proveedor(c1, v_cs1);
  v_txt := pg_temp.gf_err(format('select public.billing_registrar_checkout_proveedor(%L, %L)', c1, v_cs1 || 'x'));
  r := pg_temp.gf_r(r, '03', 'el id del proveedor no se puede reescribir', v_txt like '%billing:checkout_no_registrable%', v_txt);
  v := pg_temp.gf_checkout(u_admin_pago, t_pago, 'hasta-50');
  c2 := (v->>'checkout_id')::uuid;
  r := pg_temp.gf_r(r, '03', 'segundo intento: el anterior se devuelve para expirarlo en el proveedor',
                    (v->'anteriores') = jsonb_build_array(v_cs1), v::text);
  select count(*) filter (where estado = 'created'), coalesce(bool_or(estado = 'canceled' and id = c1), false) into v_n, v_b
    from public.billing_checkouts where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '03', 'un solo checkout abierto (el anterior queda canceled)', v_n = 1 and v_b, v_n::text);
  perform public.billing_registrar_checkout_proveedor(c2, v_cs2);

  -- ═════ 4. checkout.session.completed → active ═════
  -- Antes, los rechazos que NUNCA deben activar.
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_04a'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'checkout.session.completed', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 100);
  r := pg_temp.gf_r(r, '04', 'monto distinto al del checkout: rechazado (monto_no_coincide)', v->>'motivo' = 'monto_no_coincide', v::text);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_04b'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'checkout.session.completed', 'active', v_cs2, c1::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '04', 'client_reference_id distinto: rechazado (referencia_no_coincide)', v->>'motivo' = 'referencia_no_coincide', v::text);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_04c'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'checkout.session.completed', 'active', 'cs_test_' || v_run || '_desconocido', null, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '04', 'checkout desconocido: sin_asociacion', v->>'resultado' = 'sin_asociacion', v::text);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_04i'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.created', 'ignorar', null, null, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, null, null, now());
  r := pg_temp.gf_r(r, '04', 'rechazo del PAGO INICIAL (incomplete → ignorar): ignorado, sin impago_desde', v->>'resultado' = 'ignorado'
                    and (select impago_desde is null from public.suscripciones where tenant_id = t_pago), v::text);
  r := pg_temp.gf_r(r, '04', 'tras los rechazos sigue trialing', (select estado from public.suscripciones where tenant_id = t_pago) = 'trialing', null);

  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_04'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'checkout.session.completed', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '04', 'evento aplicado', v->>'resultado' = 'aplicado' and (v->>'tenant_id')::uuid = t_pago, v::text);
  select concat_ws('/', estado, provider, provider_subscription_id = v_sub_a, provider_customer_id = v_cus_a, plan,
                   current_period_end = now() + interval '30 days', cancel_at_period_end)
    into v_txt from public.suscripciones where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '04', 'suscripción active / stripe / sub / customer / plan / current_period_end', v_txt = 'active/stripe/t/t/hasta-50/t/f', v_txt);
  r := pg_temp.gf_r(r, '04', 'tenant_operativo true (admin)', pg_temp.gf_op(u_admin_pago, t_pago), null);
  r := pg_temp.gf_r(r, '04', 'tenant_operativo true (guardia)', pg_temp.gf_op(u_guard_pago, t_pago), null);
  select concat_ws('/', estado, provider_subscription_id = v_sub_a) into v_txt from public.billing_checkouts where id = c2;
  r := pg_temp.gf_r(r, '04', 'checkout completed con la suscripción', v_txt = 'completed/t', v_txt);
  select count(*) into v_n from public.audit_log where tenant_id = t_pago and accion = 'billing.suscripcion_activada';
  r := pg_temp.gf_r(r, '04', 'auditoría billing.suscripcion_activada (1)', v_n = 1, v_n::text);

  -- ═════ 5. Idempotencia ═════
  v_hs := pg_temp.gf_hs(t_pago);
  v := pg_temp.gf_evento('evt_' || v_run || '_04', 'checkout.session.completed', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '60 days', false, v_ver + interval '1 hour', 'MXN', 49900);
  r := pg_temp.gf_r(r, '05', 'mismo event id: duplicado (resultado_original aplicado)', v->>'resultado' = 'duplicado' and v->>'resultado_original' = 'aplicado', v::text);
  r := pg_temp.gf_r(r, '05', 'mismo event id: la suscripción no cambia (hash)', pg_temp.gf_hs(t_pago) = v_hs, null);
  select count(*) into v_n from public.billing_eventos where provider_event_id = 'evt_' || v_run || '_04';
  r := pg_temp.gf_r(r, '05', 'una sola fila en billing_eventos', v_n = 1, v_n::text);
  select count(*) into v_n from public.audit_log where tenant_id = t_pago and accion = 'billing.suscripcion_activada';
  r := pg_temp.gf_r(r, '05', 'sin auditoría duplicada', v_n = 1, v_n::text);

  -- ═════ 6. Evento con la suscripción de OTRO tenant (W04) ═════
  v_hs := pg_temp.gf_hs(t_pago); v_hs_b := pg_temp.gf_hs(t_b);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_06'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'checkout.session.completed', 'active', v_cs2, c2::text, v_sub_b, 'cus_' || v_run || '_B', now() + interval '30 days', false, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '06', 'rechazado con suscripcion_de_otro_tenant', v->>'resultado' = 'rechazado' and v->>'motivo' = 'suscripcion_de_otro_tenant', v::text);
  r := pg_temp.gf_r(r, '06', 'NO se clasifica como duplicada (el servidor no cancela la de B)', v->>'resultado' <> 'suscripcion_duplicada', v->>'resultado');
  r := pg_temp.gf_r(r, '06', 'B intacto (hash)', pg_temp.gf_hs(t_b) = v_hs_b, null);
  r := pg_temp.gf_r(r, '06', 'PAGO intacto (hash)', pg_temp.gf_hs(t_pago) = v_hs, null);
  r := pg_temp.gf_r(r, '06', 'B sigue operativo', pg_temp.gf_op(u_admin_b, t_b), null);
  select resultado into v_txt from public.billing_eventos where provider_event_id = v_ev;
  r := pg_temp.gf_r(r, '06', 'reentrega del mismo evento: duplicado con resultado_original rechazado (sin cancelar B)',
                    (pg_temp.gf_evento(v_ev, 'checkout.session.completed', 'active', v_cs2, c2::text, v_sub_b, null, now() + interval '30 days', false, v_ver, 'MXN', 49900))->>'resultado_original' = 'rechazado'
                    and v_txt = 'rechazado', v_txt);

  -- ═════ 7. Suscripción duplicada del mismo tenant ═════
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_07'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'checkout.session.completed', 'active', v_cs2, c2::text, v_sub_a2, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '07', 'segunda suscripción con la primera vigente: suscripcion_duplicada', v->>'resultado' = 'suscripcion_duplicada', v::text);
  r := pg_temp.gf_r(r, '07', 'la suscripción vigente no se pisa (hash)', pg_temp.gf_hs(t_pago) = v_hs, null);
  v := pg_temp.gf_evento(v_ev, 'checkout.session.completed', 'active', v_cs2, c2::text, v_sub_a2, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '07', 'reintento: duplicado con resultado_original suscripcion_duplicada (el servidor reintenta cancelar)',
                    v->>'resultado' = 'duplicado' and v->>'resultado_original' = 'suscripcion_duplicada', v::text);

  -- ═════ 13. Eventos fuera de orden (provider_version_at) ═════
  v_ev := 'evt_' || v_run || '_13'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.updated', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() - interval '1 day', false, v_ver - interval '1 hour', null, null);
  r := pg_temp.gf_r(r, '13', 'snapshot más viejo: obsoleto', v->>'resultado' = 'obsoleto', v::text);
  r := pg_temp.gf_r(r, '13', 'snapshot viejo no cambia la suscripción (hash)', pg_temp.gf_hs(t_pago) = v_hs, null);
  v_ev := 'evt_' || v_run || '_13b'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.updated', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() - interval '1 day', false,
                         (select provider_version_at from public.suscripciones where tenant_id = t_pago), null, null);
  r := pg_temp.gf_r(r, '13', 'misma versión que la aplicada: obsoleto', v->>'resultado' = 'obsoleto', v::text);

  -- ═════ 8. cancel_at_period_end ═════
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_08a'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.updated', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '10 days', true, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '08', 'cancelación programada aplicada', v->>'resultado' = 'aplicado'
                    and (select cancel_at_period_end from public.suscripciones where tenant_id = t_pago), v::text);
  r := pg_temp.gf_r(r, '08', 'antes del límite: operativo (admin y guardia)', pg_temp.gf_op(u_admin_pago, t_pago) and pg_temp.gf_op(u_guard_pago, t_pago), null);
  select count(*) into v_n from public.audit_log where tenant_id = t_pago and accion = 'billing.cancelacion_solicitada';
  r := pg_temp.gf_r(r, '08', 'auditoría billing.cancelacion_solicitada', v_n = 1, v_n::text);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_08b'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.updated', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '1 second', true, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '08', '1 s antes del límite: operativo', pg_temp.gf_op(u_admin_pago, t_pago), v->>'resultado');
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_08c'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.updated', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now(), true, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '08', 'en el límite exacto (sin webhook de cancelación): NO operativo',
                    v->>'resultado' = 'aplicado' and not pg_temp.gf_op(u_admin_pago, t_pago) and not pg_temp.gf_op(u_guard_pago, t_pago), v::text);
  v := pg_temp.gf_checkout(u_admin_pago, t_pago, 'hasta-50');
  r := pg_temp.gf_r(r, '08', 'cumplida la cancelación se puede volver a pagar', (v->>'ok')::boolean, v::text);
  -- Esa nueva sesión no se paga: se expira para no dejar nada abierto.
  perform public.billing_registrar_checkout_proveedor((v->>'checkout_id')::uuid, 'cs_test_' || v_run || '_3');
  v_ev := 'evt_' || v_run || '_08x'; v_eventos := v_eventos || v_ev;
  v2 := pg_temp.gf_evento(v_ev, 'checkout.session.expired', 'checkout_expirado', 'cs_test_' || v_run || '_3', v->>'checkout_id', null, null, null, false, now(), null, null);
  r := pg_temp.gf_r(r, '08', 'checkout.session.expired → checkout expired', (select estado from public.billing_checkouts where id = (v->>'checkout_id')::uuid) = 'expired', v2::text);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_08d'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.updated', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  select count(*) into v_n from public.audit_log where tenant_id = t_pago and accion = 'billing.cancelacion_revertida';
  r := pg_temp.gf_r(r, '08', 'cancelación revertida: operativo y auditada', v->>'resultado' = 'aplicado' and pg_temp.gf_op(u_admin_pago, t_pago) and v_n = 1, v::text);

  -- ═════ 9. past_due: 7 días de gracia desde el INICIO DEL IMPAGO ═════
  -- Renovación fallida como la deja Stripe: el periodo YA avanzó
  -- (current_period_end ≈ +27 días) y el impago empezó al inicio de ese
  -- periodo (impago_desde, que normaliza el servidor).
  v_hs_b := pg_temp.gf_hs(t_b);
  v_impago := now() - interval '3 days';
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_09'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '27 days', false, v_ver, 'MXN', 49900, v_impago);
  r := pg_temp.gf_r(r, '09', 'renovación fallida → past_due con impago_desde = inicio del periodo impago',
                    v->>'resultado' = 'aplicado' and (select estado = 'past_due' and impago_desde = v_impago and current_period_end > now() + interval '20 days' from public.suscripciones where tenant_id = t_pago), v::text);
  r := pg_temp.gf_r(r, '09', 'día 3 desde el inicio del impago: operativo (admin y guardia)', pg_temp.gf_op(u_admin_pago, t_pago) and pg_temp.gf_op(u_guard_pago, t_pago), null);
  select count(*) into v_n from public.audit_log where tenant_id = t_pago and accion = 'billing.pago_fallido' and (datos_nuevos->>'impago_desde')::timestamptz = v_impago;
  r := pg_temp.gf_r(r, '09', 'auditoría billing.pago_fallido con impago_desde', v_n = 1, v_n::text);
  -- Reintento posterior (otra fecha, versión más nueva): no reinicia ni extiende.
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_09r'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '27 days', false, v_ver, 'MXN', 49900, now() - interval '1 hour');
  r := pg_temp.gf_r(r, '09', 'reintento con una fecha posterior: impago_desde NO cambia (no extiende la gracia)',
                    v->>'resultado' = 'aplicado' and (select impago_desde from public.suscripciones where tenant_id = t_pago) = v_impago, v::text);
  v_hs := pg_temp.gf_hs(t_pago);
  v := pg_temp.gf_evento('evt_' || v_run || '_09', 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '27 days', false, v_ver + interval '1 hour', 'MXN', 49900, now());
  r := pg_temp.gf_r(r, '09', 'evento duplicado: sin cambios (ni impago_desde)', v->>'resultado' = 'duplicado' and pg_temp.gf_hs(t_pago) = v_hs, v::text);
  v_ev := 'evt_' || v_run || '_09o'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '27 days', false, v_ver - interval '1 hour', 'MXN', 49900, now() - interval '20 days');
  r := pg_temp.gf_r(r, '09', 'evento fuera de orden (versión vieja): obsoleto, impago_desde intacto', v->>'resultado' = 'obsoleto' and pg_temp.gf_hs(t_pago) = v_hs, v::text);
  update public.suscripciones set impago_desde = now() - interval '7 days' + interval '1 second' where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '09', '1 s antes de cumplir 7 días desde el inicio del impago: operativo', pg_temp.gf_op(u_admin_pago, t_pago), null);

  -- ═════ 10. past_due fuera de la gracia ═════
  update public.suscripciones set impago_desde = now() - interval '7 days' where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '10', 'frontera exacta: 7 días desde el inicio del impago → bloqueado (admin y guardia) aunque current_period_end sea futuro',
                    not pg_temp.gf_op(u_admin_pago, t_pago) and not pg_temp.gf_op(u_guard_pago, t_pago)
                    and (select current_period_end > now() from public.suscripciones where tenant_id = t_pago), null);
  update public.suscripciones set impago_desde = now() - interval '8 days' where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '10', 'día 8: bloqueado', not pg_temp.gf_op(u_admin_pago, t_pago), null);
  update public.suscripciones set impago_desde = null where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '10', 'regresión: sin impago_desde, un current_period_end futuro NO concede gracia (falla cerrado)', not pg_temp.gf_op(u_admin_pago, t_pago), null);
  update public.suscripciones set impago_desde = now() - interval '8 days' where tenant_id = t_pago;
  -- unpaid (reintentos agotados) llega normalizado como past_due: mismo episodio, no extiende.
  -- Aunque traiga una fecha (defensa: el servidor no la envía para unpaid), se ignora.
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_10u'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.updated', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '27 days', false, v_ver, 'MXN', 49900, now() - interval '1 hour', 'unpaid');
  r := pg_temp.gf_r(r, '10', 'unpaid/reintentos agotados: sigue el mismo inicio de impago y bloqueado',
                    (select impago_desde from public.suscripciones where tenant_id = t_pago) = now() - interval '8 days' and not pg_temp.gf_op(u_admin_pago, t_pago), v::text);
  r := pg_temp.gf_r(r, '10', 'unpaid: el status real del proveedor queda en el detalle del evento',
                    (select detalle->>'estado_proveedor' from public.billing_eventos where provider_event_id = v_ev) = 'unpaid', v::text);
  v := pg_temp.gf_checkout(u_admin_pago, t_pago, 'hasta-50');
  r := pg_temp.gf_r(r, '10', 'past_due no paga un checkout nuevo (se gestiona en el portal)', v->>'err' like '%billing:estado_no_permite%', v::text);
  select count(*) into v_n from public.unidades where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '10', 'bloqueado: datos preservados', v_n = 3, v_n::text);

  -- ═════ 11. Pago recuperado y nuevo impago ═════
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'invoice.paid', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '11', 'invoice.paid → active y el episodio de impago se cierra (impago_desde null)',
                    v->>'resultado' = 'aplicado' and (select estado = 'active' and impago_desde is null from public.suscripciones where tenant_id = t_pago), v::text);
  r := pg_temp.gf_r(r, '11', 'operativo de nuevo (admin y guardia)', pg_temp.gf_op(u_admin_pago, t_pago) and pg_temp.gf_op(u_guard_pago, t_pago), null);
  select count(*) into v_n from public.audit_log where tenant_id = t_pago and accion = 'billing.pago_recuperado';
  r := pg_temp.gf_r(r, '11', 'auditoría billing.pago_recuperado', v_n = 1, v_n::text);
  v_impago2 := now() - interval '1 hour';
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11b'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900, v_impago2);
  r := pg_temp.gf_r(r, '11', 'nuevo impago posterior: nuevo inicio (no hereda el anterior) y gracia nueva',
                    (select impago_desde from public.suscripciones where tenant_id = t_pago) = v_impago2 and pg_temp.gf_op(u_admin_pago, t_pago), v::text);
  -- Webhook del episodio ANTERIOR recibido tras la recuperación y el nuevo impago.
  v_ev := 'evt_' || v_run || '_11o'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '27 days', false, v_ver - interval '1 hour', 'MXN', 49900, v_impago);
  r := pg_temp.gf_r(r, '11', 'webhook del episodio anterior con snapshot viejo: obsoleto, el episodio nuevo intacto',
                    v->>'resultado' = 'obsoleto' and (select impago_desde from public.suscripciones where tenant_id = t_pago) = v_impago2, v::text);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11p'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '27 days', false, v_ver, 'MXN', 49900, v_impago);
  r := pg_temp.gf_r(r, '11', 'fecha del episodio anterior con snapshot nuevo: NO acorta ni mueve el episodio nuevo (inmutable)',
                    v->>'resultado' = 'aplicado' and (select impago_desde from public.suscripciones where tenant_id = t_pago) = v_impago2 and pg_temp.gf_op(u_admin_pago, t_pago), v::text);
  -- Sin fecha fiable al entrar en past_due: falla cerrado; un evento posterior la completa.
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11c'; v_eventos := v_eventos || v_ev;
  perform pg_temp.gf_evento(v_ev, 'invoice.paid', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11d'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900, null);
  r := pg_temp.gf_r(r, '11', 'past_due sin inicio de impago: impago_desde null y NO operativo (no se inventa fecha)',
                    (select estado = 'past_due' and impago_desde is null from public.suscripciones where tenant_id = t_pago) and not pg_temp.gf_op(u_admin_pago, t_pago), v::text);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11e'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900, now() - interval '2 hours');
  r := pg_temp.gf_r(r, '11', 'el siguiente evento con la fecha del proveedor la completa → gracia',
                    (select impago_desde from public.suscripciones where tenant_id = t_pago) = now() - interval '2 hours' and pg_temp.gf_op(u_admin_pago, t_pago), v::text);
  -- Fecha no fiable (posterior al snapshot del proveedor): se descarta.
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11f'; v_eventos := v_eventos || v_ev;
  perform pg_temp.gf_evento(v_ev, 'invoice.paid', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11g'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900, v_ver + interval '1 day');
  r := pg_temp.gf_r(r, '11', 'impago_desde posterior al snapshot: descartado (null, registrado en el detalle) y sin gracia',
                    v ? 'impago_desde_descartado' and (select impago_desde is null from public.suscripciones where tenant_id = t_pago) and not pg_temp.gf_op(u_admin_pago, t_pago), v::text);
  -- unpaid sin haber visto el past_due (se perdió ese webhook): no abre gracia.
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11h'; v_eventos := v_eventos || v_ev;
  perform pg_temp.gf_evento(v_ev, 'invoice.paid', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11u'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.updated', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900, now() - interval '1 hour', 'unpaid');
  r := pg_temp.gf_r(r, '10', 'active → unpaid directo: past_due SIN inicio de impago (no abre gracia) y bloqueado',
                    v->>'resultado' = 'aplicado' and (select estado = 'past_due' and impago_desde is null from public.suscripciones where tenant_id = t_pago)
                    and not pg_temp.gf_op(u_admin_pago, t_pago), v::text);
  -- Servidor anterior durante el despliegue: su past_due (sin status del proveedor) se rechaza
  -- sin registrar nada (500 → Stripe reintenta); el resto de sus eventos se aplica.
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_11v'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento_antiguo(v_ev, 'invoice.paid', 'active', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '11', 'llamada del servidor anterior (14 argumentos): active se aplica igual',
                    v->>'resultado' = 'aplicado' and (select estado = 'active' and impago_desde is null from public.suscripciones where tenant_id = t_pago), v::text);
  v_hs := pg_temp.gf_hs(t_pago);
  v_ver := v_ver + interval '1 second';
  v := pg_temp.gf_evento_antiguo('evt_' || v_run || '_11w', 'invoice.payment_failed', 'past_due', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '11', 'llamada del servidor anterior con past_due: error (el proveedor reintenta), sin registrar el evento ni cambiar la suscripción',
                    v->>'err' like '%billing:estado_proveedor_requerido%' and pg_temp.gf_hs(t_pago) = v_hs
                    and not exists (select 1 from public.billing_eventos where provider_event_id = 'evt_' || v_run || '_11w'), v::text);
  r := pg_temp.gf_r(r, '11', 'aislamiento: los impagos de PAGO no tocan al tenant B (hash)', pg_temp.gf_hs(t_b) = v_hs_b and (select impago_desde is null from public.suscripciones where tenant_id = t_b), null);

  -- ═════ 12. customer.subscription.deleted ═════
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_12'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.deleted', 'canceled', v_cs2, c2::text, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  select concat_ws('/', estado, cancel_at_period_end) into v_txt from public.suscripciones where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '12', 'canceled (cancel_at_period_end se limpia)', v->>'resultado' = 'aplicado' and v_txt = 'canceled/f', v_txt);
  r := pg_temp.gf_r(r, '12', 'canceled cierra el episodio de impago (impago_desde null)', (select impago_desde is null from public.suscripciones where tenant_id = t_pago), null);
  r := pg_temp.gf_r(r, '12', 'canceled: NO operativo (admin y guardia)', not pg_temp.gf_op(u_admin_pago, t_pago) and not pg_temp.gf_op(u_guard_pago, t_pago), null);
  select count(*) into v_n from public.unidades where tenant_id = t_pago;
  r := pg_temp.gf_r(r, '12', 'canceled: datos preservados', v_n = 3, v_n::text);
  v_ver := v_ver + interval '1 second'; v_ev := 'evt_' || v_run || '_12b'; v_eventos := v_eventos || v_ev;
  v := pg_temp.gf_evento(v_ev, 'customer.subscription.updated', 'active', null, null, v_sub_a, v_cus_a, now() + interval '30 days', false, v_ver, 'MXN', 49900);
  r := pg_temp.gf_r(r, '12', 'tras canceled, un evento active sin checkout no reactiva (rechazado sin_checkout)',
                    v->>'motivo' = 'sin_checkout' and (select estado from public.suscripciones where tenant_id = t_pago) = 'canceled', v::text);
  v := pg_temp.gf_checkout(u_admin_pago, t_pago, 'hasta-50');
  r := pg_temp.gf_r(r, '12', 'canceled: se puede volver a pagar (nuevo checkout)', (v->>'ok')::boolean, v::text);

  -- ═════ 16. Elegibilidad por viviendas: max(declaradas, unidades activas) ═════
  r := pg_temp.gf_r(r, '16', 'declaradas 30, 0 unidades → 30', public.billing_viviendas_requeridas(t_elig) = 30, public.billing_viviendas_requeridas(t_elig)::text);
  insert into public.unidades (tenant_id, tipo, identificador) select t_elig, 'casa', 'ZZ ' || g from generate_series(1, 50) g;
  r := pg_temp.gf_r(r, '16', '50 unidades activas → 50', public.billing_viviendas_requeridas(t_elig) = 50, public.billing_viviendas_requeridas(t_elig)::text);
  v := pg_temp.gf_checkout(u_admin_elig, t_elig, 'hasta-50');
  r := pg_temp.gf_r(r, '16', '50 viviendas: hasta-50 permitido (≤50)', (v->>'ok')::boolean, v::text);
  insert into public.unidades (tenant_id, tipo, identificador) values (t_elig, 'casa', 'ZZ 51');
  v := pg_temp.gf_checkout(u_admin_elig, t_elig, 'hasta-50');
  r := pg_temp.gf_r(r, '16', '51 viviendas: hasta-50 rechazado (billing:viviendas)', v->>'err' like '%billing:viviendas%', v::text);
  v := pg_temp.gf_checkout(u_admin_elig, t_elig, 'hasta-150');
  r := pg_temp.gf_r(r, '16', '51 viviendas: hasta-150 permitido', (v->>'ok')::boolean, v::text);
  update public.unidades set activo = false where tenant_id = t_elig and identificador in ('ZZ 51', 'ZZ 50');
  r := pg_temp.gf_r(r, '16', 'unidades inactivas no cuentan (51 → 49 → max(30, 49) = 49)', public.billing_viviendas_requeridas(t_elig) = 49, public.billing_viviendas_requeridas(t_elig)::text);
  update public.suscripciones set viviendas_declaradas = 120 where tenant_id = t_elig;
  r := pg_temp.gf_r(r, '16', 'declaradas 120 > 49 activas → 120', public.billing_viviendas_requeridas(t_elig) = 120, null);
  v := pg_temp.gf_checkout(u_admin_elig, t_elig, 'hasta-50');
  r := pg_temp.gf_r(r, '16', 'declaradas 120: hasta-50 rechazado aunque haya 49 unidades', v->>'err' like '%billing:viviendas%', v::text);
  update public.suscripciones set viviendas_declaradas = 150 where tenant_id = t_elig;
  v := pg_temp.gf_checkout(u_admin_elig, t_elig, 'hasta-150');
  r := pg_temp.gf_r(r, '16', '150 viviendas: hasta-150 permitido (≤150)', (v->>'ok')::boolean, v::text);
  update public.suscripciones set viviendas_declaradas = 151 where tenant_id = t_elig;
  v := pg_temp.gf_checkout(u_admin_elig, t_elig, 'hasta-150');
  v2 := pg_temp.gf_checkout(u_admin_elig, t_elig, 'hasta-50');
  r := pg_temp.gf_r(r, '16', '>150 viviendas: ningún plan de autoservicio (billing:viviendas)',
                    v->>'err' like '%billing:viviendas%' and v2->>'err' like '%billing:viviendas%', v::text);
  r := pg_temp.gf_r(r, '16', 'límites de plan en la base = catálogo (50/150)',
                    public.billing_limite_plan('hasta-50') = 50 and public.billing_limite_plan('hasta-150') = 150 and public.billing_limite_plan('otro') is null, null);
  v := pg_temp.gf_checkout(u_multi, t_elig, 'hasta-150');
  r := pg_temp.gf_r(r, '18', 'usuario multitenant pasa el control de rol en ELIG (donde es admin): el rechazo es por viviendas, no por rol',
                    v->>'err' like '%billing:viviendas%', v::text);

  -- ═════ 19. Integridad referencial ═════
  v_txt := pg_temp.gf_err(format('insert into public.billing_checkouts (tenant_id, user_id, plan, provider, moneda, monto, expires_at) values (%L, %L, ''hasta-50'', ''stripe'', ''MXN'', 49900, now() + interval ''1 hour'')',
                                 gen_random_uuid(), u_admin_pago));
  r := pg_temp.gf_r(r, '19', 'checkout con tenant inexistente: FK (23503)', v_txt like '23503%', v_txt);
  v_txt := pg_temp.gf_err(format('insert into public.billing_checkouts (tenant_id, user_id, plan, provider, moneda, monto, expires_at) values (%L, %L, ''hasta-50'', ''stripe'', ''MXN'', 49900, now() + interval ''1 hour'')',
                                 t_pago, gen_random_uuid()));
  r := pg_temp.gf_r(r, '19', 'checkout con usuario inexistente: FK (23503)', v_txt like '23503%', v_txt);
  v_txt := pg_temp.gf_err(format('update public.suscripciones set provider = ''stripe'', plan = ''hasta-50'', provider_subscription_id = %L where tenant_id = %L', v_sub_b, t_trial));
  r := pg_temp.gf_r(r, '19', 'una suscripción del proveedor pertenece a un solo tenant (23505)', v_txt like '23505%', v_txt);
  v_txt := pg_temp.gf_err(format('update public.suscripciones set cancel_at_period_end = true, current_period_end = null where tenant_id = %L', t_trial));
  r := pg_temp.gf_r(r, '19', 'cancel_at_period_end exige current_period_end (23514)', v_txt like '23514%', v_txt);
  v_txt := pg_temp.gf_err(format('update public.suscripciones set provider_subscription_id = %L where tenant_id = %L', 'sub_' || v_run || '_x', t_trial));
  r := pg_temp.gf_r(r, '19', 'suscripción del proveedor sin provider/plan rechazada (23514)', v_txt like '23514%', v_txt);
  v_txt := pg_temp.gf_err(format('update public.suscripciones set impago_desde = now() where tenant_id = %L', t_trial));
  r := pg_temp.gf_r(r, '19', 'impago_desde solo con estado past_due (23514)', v_txt like '23514%', v_txt);
  v_txt := pg_temp.gf_err(format('update public.suscripciones set tenant_id = %L where tenant_id = %L', t_b, t_trial));
  r := pg_temp.gf_r(r, '19', 'suscripciones.tenant_id es inmutable', v_txt is not null, v_txt);
  v_txt := pg_temp.gf_err(format('insert into public.billing_eventos (provider, provider_event_id, tipo) values (''stripe'', %L, ''x'')', 'evt_' || v_run || '_04'));
  r := pg_temp.gf_r(r, '19', 'billing_eventos: (provider, event id) único (23505)', v_txt like '23505%', v_txt);
  select count(*) into v_n from public.billing_checkouts c
   where c.tenant_id = any (array[t_trial, t_venc, t_pago, t_b, t_elig, t_marca])
     and not exists (select 1 from public.user_tenants ut join public.roles ro on ro.id = ut.rol_id
                     where ut.user_id = c.user_id and ut.tenant_id = c.tenant_id and ro.clave = 'admin_residencial');
  r := pg_temp.gf_r(r, '19', 'todo checkout lo creó un admin_residencial de SU tenant', v_n = 0, v_n::text);
  select count(*) into v_n from public.billing_eventos e
   where e.provider_event_id = any (v_eventos) and e.tenant_id is not null and e.tenant_id <> all (array[t_trial, t_venc, t_pago, t_b, t_elig, t_marca]);
  r := pg_temp.gf_r(r, '19', 'ningún evento sintético quedó asociado a un tenant real', v_n = 0, v_n::text);
  select count(*) into v_n from public.billing_eventos where provider_event_id = any (v_eventos);
  r := pg_temp.gf_r(r, '19', 'cada evento sintético registrado una sola vez', v_n = array_length(v_eventos, 1), v_n || '/' || array_length(v_eventos, 1));

  -- ═════ 14 / 15: sin base de datos (firma y configuración) ═════
  -- Se prueban en la capa A y en el pipeline (billing-bateria-*.test.ts):
  -- una firma inválida responde 401 antes de llamar a billing_aplicar_evento.

  -- ═════ 20. Teardown ═════
  reg := jsonb_set(reg, '{eventos}', to_jsonb(v_eventos));
  v_conteo_antes := pg_temp.gf_conteo(v_run, reg);

  -- 20a. Sin marca inequívoca → aborta y no borra nada.
  update public.tenants set observaciones = null where id = t_marca;
  begin
    perform pg_temp.gf_teardown(v_run, reg);
    r := pg_temp.gf_r(r, '20', 'teardown aborta si un tenant registrado no tiene marca', false, 'no abortó');
  exception when others then
    r := pg_temp.gf_r(r, '20', 'teardown aborta si un tenant registrado no tiene marca', sqlerrm like 'GF_TEARDOWN_ABORTADO%', sqlerrm);
  end;
  r := pg_temp.gf_r(r, '20', 'el teardown abortado no borró nada', pg_temp.gf_conteo(v_run, reg) = v_conteo_antes, null);
  update public.tenants set observaciones = v_marca where id = t_marca;

  -- 20b. Un id ajeno al run (aunque fuera sintético de otro run) → aborta.
  begin
    perform pg_temp.gf_teardown(v_run, jsonb_set(reg, '{users}', (reg->'users') || jsonb_build_array(gen_random_uuid())));
    r := pg_temp.gf_r(r, '20', 'teardown aborta con un id no registrado/sin marca', false, 'no abortó');
  exception when others then
    r := pg_temp.gf_r(r, '20', 'teardown aborta con un id no registrado/sin marca', sqlerrm like 'GF_TEARDOWN_ABORTADO%', sqlerrm);
  end;
  begin
    perform pg_temp.gf_teardown('ZZ_OTRO', reg);
    r := pg_temp.gf_r(r, '20', 'teardown aborta con un run sin prefijo válido', false, 'no abortó');
  exception when others then
    r := pg_temp.gf_r(r, '20', 'teardown aborta con un run sin prefijo válido', sqlerrm like 'GF_TEARDOWN_ABORTADO%', sqlerrm);
  end;

  -- 20c. Teardown real.
  v_borradas := pg_temp.gf_teardown(v_run, reg);
  v_conteo_despues := pg_temp.gf_conteo(v_run, reg);
  select coalesce(sum(value::int), 0) into v_n from jsonb_each_text(v_conteo_despues);
  r := pg_temp.gf_r(r, '20', '0 residuos tras el teardown (todas las tablas)', v_n = 0, v_conteo_despues::text);
  select count(*) into v_n from public.tenants where left(nombre, length(v_run)) = v_run;
  v_b2 := exists (select 1 from auth.users where left(email, length('zz_autotest+' || lower(v_run))) = 'zz_autotest+' || lower(v_run));
  r := pg_temp.gf_r(r, '20', 'búsqueda por prefijo del run: 0 tenants y 0 usuarios', v_n = 0 and not v_b2, v_n::text);

  v_hash_despues := pg_temp.gf_hash_reales(v_run, '{}'::uuid[], '{}'::uuid[]);
  r := pg_temp.gf_r(r, '20', 'datos reales intactos (hash antes = después)', v_hash_antes = v_hash_despues, left(v_hash_antes, 8) || ' / ' || left(v_hash_despues, 8));

  -- ── Fin: SIEMPRE excepción → rollback de todo ──
  raise exception using
    errcode = 'P0001',
    message = 'GF_AUTOTEST_RESULTADOS:' || jsonb_build_object(
      'run', v_run,
      -- Primero en el JSON (jsonb ordena claves cortas primero): visible aunque la salida se trunque.
      'resumen', jsonb_build_object(
        'total', jsonb_array_length(r),
        'pass', (select count(*) from jsonb_array_elements(r) x where (x->>'ok')::boolean),
        'fail', (select count(*) from jsonb_array_elements(r) x where not (x->>'ok')::boolean),
        'fallas', (select coalesce(jsonb_agg(x->>'e' || ' ' || (x->>'c')), '[]'::jsonb) from jsonb_array_elements(r) x where not (x->>'ok')::boolean)),
      'resultados', r,
      'fixtures', jsonb_build_object('creados', v_conteo_antes, 'eliminados', v_borradas, 'residuos', v_conteo_despues),
      'hash_reales', jsonb_build_object('antes', v_hash_antes, 'despues', v_hash_despues)
    )::text;
end
$pack$;

-- Inalcanzable: el bloque anterior siempre falla. Si algo cambiara, igual se revierte.
rollback;
