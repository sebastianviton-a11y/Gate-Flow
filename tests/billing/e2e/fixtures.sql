-- ============================================================
-- Fixtures CONFIRMADOS de la capa C local (Next + PostgREST + Playwright).
-- SOLO base local gf_billing_*: aborta en cualquier otra (staging se
-- llama "postgres"). Todo lleva la marca del run (ZZ_AUTOTEST_…) y se
-- borra con teardown.sql por ids registrados.
--   psql -v run=ZZ_AUTOTEST_… -At -f fixtures.sql  → JSON del registro
-- ============================================================
\set ON_ERROR_STOP 1
begin;
select set_config('gf.run', :'run', true) \g /dev/null
create temp table gf_registro (j jsonb) on commit drop;

do $f$
declare
  v_run text := current_setting('gf.run');
  v_marca text := 'gf-autotest:' || current_setting('gf.run');
  v_emp uuid;
  v_t jsonb := '{}'::jsonb;
  v_u jsonb := '{}'::jsonb;
  v_id uuid;
  k text;
  r_admin uuid := (select id from public.roles where clave = 'admin_residencial');
  r_guardia uuid := (select id from public.roles where clave = 'guardia');
begin
  if current_database() not like 'gf\_billing\_%' then
    raise exception 'fixtures e2e: solo en una base local gf_billing_* (actual: %)', current_database();
  end if;
  if left(v_run, 12) <> 'ZZ_AUTOTEST_' then raise exception 'run sin prefijo sintético'; end if;

  insert into public.empresas (nombre, observaciones) values (v_run, v_marca) returning id into v_emp;
  -- tenant → (estado de suscripción, viviendas declaradas)
  foreach k in array array['VENC', 'GRANDE', 'ACTIVO', 'PIPE', 'OTRO'] loop
    insert into public.tenants (nombre, tipo, timezone, plan, estado_servicio, onboarding_completado, empresa_id, observaciones)
    values (v_run || '_' || k, 'residencial', 'America/Mexico_City', 'trial', 'activo', true, v_emp, v_marca) returning id into v_id;
    v_t := v_t || jsonb_build_object(k, v_id);
    if k in ('VENC', 'GRANDE', 'PIPE') then
      insert into public.suscripciones (tenant_id, estado, origen, trial_started_at, trial_ends_at, viviendas_declaradas)
      values (v_id, 'trialing', 'registro_publico', now() - interval '31 days', now() - interval '1 hour', case k when 'GRANDE' then 60 else 40 end);
    else
      insert into public.suscripciones (tenant_id, estado, origen, viviendas_declaradas, plan, provider, provider_customer_id,
                                        provider_subscription_id, current_period_end, cancel_at_period_end, provider_version_at)
      values (v_id, 'active', 'registro_publico', 20, 'hasta-50', 'stripe', 'cus_' || v_run || '_' || k, 'sub_' || v_run || '_' || k,
              now() + interval '20 days', false, now() - interval '1 hour');
    end if;
    insert into public.unidades (tenant_id, tipo, identificador) select v_id, 'casa', 'ZZ ' || g from generate_series(1, 3) g;
  end loop;

  foreach k in array array['admin_venc', 'guard_venc', 'admin_grande', 'guard_grande', 'admin_activo', 'guard_activo', 'multi', 'admin_pipe'] loop
    insert into auth.users (id, email, raw_user_meta_data)
    values (gen_random_uuid(), 'zz_autotest+' || lower(v_run) || '-' || k || '@gateflow.invalid', jsonb_build_object('nombre_completo', v_run))
    returning id into v_id;
    v_u := v_u || jsonb_build_object(k, v_id);
  end loop;

  insert into public.user_tenants (user_id, tenant_id, rol_id) values
    ((v_u->>'admin_venc')::uuid, (v_t->>'VENC')::uuid, r_admin), ((v_u->>'guard_venc')::uuid, (v_t->>'VENC')::uuid, r_guardia),
    ((v_u->>'admin_grande')::uuid, (v_t->>'GRANDE')::uuid, r_admin), ((v_u->>'guard_grande')::uuid, (v_t->>'GRANDE')::uuid, r_guardia),
    ((v_u->>'admin_activo')::uuid, (v_t->>'ACTIVO')::uuid, r_admin), ((v_u->>'guard_activo')::uuid, (v_t->>'ACTIVO')::uuid, r_guardia),
    ((v_u->>'multi')::uuid, (v_t->>'ACTIVO')::uuid, r_admin), ((v_u->>'multi')::uuid, (v_t->>'GRANDE')::uuid, r_admin),
    ((v_u->>'admin_pipe')::uuid, (v_t->>'PIPE')::uuid, r_admin);

  insert into gf_registro values (jsonb_build_object(
    'run', v_run, 'empresa', v_emp, 'tenant', v_t, 'usuario', v_u,
    -- formato de teardown.sql
    'registro', jsonb_build_object('empresa', v_emp,
      'tenants', (select jsonb_agg(value) from jsonb_each_text(v_t)),
      'users', (select jsonb_agg(value) from jsonb_each_text(v_u)),
      'eventos', '[]'::jsonb)));
end
$f$;

select j::text from gf_registro;
commit;
