-- ============================================================
-- Teardown de la batería de billing (pg_temp: solo esta sesión).
-- Lo incluyen escenarios.sql (staging/local, siempre revertido) y
-- tests/billing/e2e (fixtures confirmados en la base LOCAL).
--
--   gf_conteo(run, registro)    filas ligadas a los ids registrados
--   gf_teardown(run, registro)  borra SOLO esos ids; aborta (excepción,
--                               nada borrado) si un id no lleva la marca
--                               sintética del run o si un DELETE afecta
--                               un número de filas distinto del esperado
--
-- registro = {"empresa": uuid, "tenants": [uuid], "users": [uuid], "eventos": [text]}
-- ============================================================

-- Filas que dependen de los ids registrados (para creados / residuos).
create function pg_temp.gf_conteo(p_run text, p_reg jsonb) returns jsonb language plpgsql as $$
declare
  v_t uuid[] := array(select jsonb_array_elements_text(p_reg->'tenants')::uuid);
  v_u uuid[] := array(select jsonb_array_elements_text(p_reg->'users')::uuid);
  v_e text[] := array(select jsonb_array_elements_text(p_reg->'eventos'));
begin
  return jsonb_build_object(
    'empresas', (select count(*) from public.empresas where id = (p_reg->>'empresa')::uuid),
    'tenants', (select count(*) from public.tenants where id = any (v_t)),
    'usuarios_auth', (select count(*) from auth.users where id = any (v_u)),
    'usuarios', (select count(*) from public.users where id = any (v_u)),
    'membresias', (select count(*) from public.user_tenants where tenant_id = any (v_t) or user_id = any (v_u)),
    'suscripciones', (select count(*) from public.suscripciones where tenant_id = any (v_t)),
    'unidades', (select count(*) from public.unidades where tenant_id = any (v_t)),
    'calles', (select count(*) from public.calles where tenant_id = any (v_t)),
    'checkouts', (select count(*) from public.billing_checkouts where tenant_id = any (v_t) or user_id = any (v_u)),
    'eventos', (select count(*) from public.billing_eventos where provider_event_id = any (v_e) or tenant_id = any (v_t)
                  or left(provider_event_id, length('evt_' || p_run)) = 'evt_' || p_run),
    'auditoria', (select count(*) from public.audit_log where tenant_id = any (v_t) or user_id = any (v_u))
  );
end $$;

-- Teardown SOLO por ids registrados. Aborta (excepción, sin borrar
-- nada) si un id no lleva la marca sintética del run o si cualquier
-- DELETE afecta un número de filas distinto del esperado.
create function pg_temp.gf_teardown(p_run text, p_reg jsonb) returns jsonb language plpgsql as $$
declare
  v_marca text := 'gf-autotest:' || p_run;
  v_pref_email text := 'zz_autotest+' || lower(p_run) || '-';
  v_t uuid[] := array(select jsonb_array_elements_text(p_reg->'tenants')::uuid);
  v_u uuid[] := array(select jsonb_array_elements_text(p_reg->'users')::uuid);
  v_e text[] := array(select jsonb_array_elements_text(p_reg->'eventos'));
  v_emp uuid := (p_reg->>'empresa')::uuid;
  v_esperadas int;
  v_n int;
  v_borradas jsonb := '{}'::jsonb;
begin
  if left(p_run, 12) <> 'ZZ_AUTOTEST_' or length(p_run) < 20 then
    raise exception 'GF_TEARDOWN_ABORTADO: run sin prefijo sintético';
  end if;
  if coalesce(array_length(v_t, 1), 0) = 0 or coalesce(array_length(v_u, 1), 0) = 0 or v_emp is null then
    raise exception 'GF_TEARDOWN_ABORTADO: registro vacío';
  end if;
  -- 1. Marcas inequívocas (todas o nada).
  if (select count(*) from public.tenants t where t.id = any (v_t) and t.observaciones = v_marca
        and left(t.nombre, length(p_run) + 1) = p_run || '_' and t.empresa_id = v_emp) <> array_length(v_t, 1) then
    raise exception 'GF_TEARDOWN_ABORTADO: tenant sin marca sintética';
  end if;
  if (select count(*) from auth.users u where u.id = any (v_u) and left(u.email, length(v_pref_email)) = v_pref_email
        and right(u.email, length('@gateflow.invalid')) = '@gateflow.invalid') <> array_length(v_u, 1) then
    raise exception 'GF_TEARDOWN_ABORTADO: usuario sin marca sintética';
  end if;
  if (select count(*) from public.empresas m where m.id = v_emp and m.nombre = p_run and m.observaciones = v_marca) <> 1 then
    raise exception 'GF_TEARDOWN_ABORTADO: empresa sin marca sintética';
  end if;
  if exists (select 1 from unnest(v_e) x where left(x, length('evt_' || p_run || '_')) <> 'evt_' || p_run || '_') then
    raise exception 'GF_TEARDOWN_ABORTADO: evento sin marca sintética';
  end if;
  -- Ningún usuario sintético pertenece a un tenant real.
  if exists (select 1 from public.user_tenants ut where ut.user_id = any (v_u) and ut.tenant_id <> all (v_t)) then
    raise exception 'GF_TEARDOWN_ABORTADO: usuario sintético con membresía en un tenant no registrado';
  end if;

  -- 2. Borrado por ids, contando.
  select count(*) into v_esperadas from public.billing_eventos e where e.provider = 'stripe' and e.provider_event_id = any (v_e);
  delete from public.billing_eventos e where e.provider = 'stripe' and e.provider_event_id = any (v_e);
  get diagnostics v_n = row_count;
  if v_n <> v_esperadas then raise exception 'GF_TEARDOWN_ABORTADO: billing_eventos % <> %', v_n, v_esperadas; end if;
  v_borradas := v_borradas || jsonb_build_object('eventos', v_n);

  select count(*) into v_esperadas from public.audit_log a where a.tenant_id = any (v_t) or a.user_id = any (v_u);
  delete from public.audit_log a where a.tenant_id = any (v_t) or a.user_id = any (v_u);
  get diagnostics v_n = row_count;
  if v_n <> v_esperadas then raise exception 'GF_TEARDOWN_ABORTADO: audit_log % <> %', v_n, v_esperadas; end if;
  v_borradas := v_borradas || jsonb_build_object('auditoria', v_n);

  select count(*) into v_esperadas from public.billing_checkouts c where c.tenant_id = any (v_t);
  delete from public.billing_checkouts c where c.tenant_id = any (v_t);
  get diagnostics v_n = row_count;
  if v_n <> v_esperadas then raise exception 'GF_TEARDOWN_ABORTADO: billing_checkouts % <> %', v_n, v_esperadas; end if;
  v_borradas := v_borradas || jsonb_build_object('checkouts', v_n);

  delete from public.tenants t where t.id = any (v_t) and t.observaciones = v_marca;
  get diagnostics v_n = row_count;
  if v_n <> array_length(v_t, 1) then raise exception 'GF_TEARDOWN_ABORTADO: tenants % <> %', v_n, array_length(v_t, 1); end if;
  v_borradas := v_borradas || jsonb_build_object('tenants', v_n);

  delete from auth.users u where u.id = any (v_u) and left(u.email, length(v_pref_email)) = v_pref_email;
  get diagnostics v_n = row_count;
  if v_n <> array_length(v_u, 1) then raise exception 'GF_TEARDOWN_ABORTADO: usuarios % <> %', v_n, array_length(v_u, 1); end if;
  v_borradas := v_borradas || jsonb_build_object('usuarios', v_n);

  delete from public.empresas m where m.id = v_emp and m.observaciones = v_marca;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'GF_TEARDOWN_ABORTADO: empresas % <> 1', v_n; end if;
  v_borradas := v_borradas || jsonb_build_object('empresas', v_n);

  return v_borradas;
end $$;
