-- ============================================================
-- Eliminación manual asistida (20261018000000) con los grants de un
-- proyecto Supabase nuevo como staging (default privileges que dan
-- EXECUTE y acceso a tablas a todos). Residencial SINTÉTICO dentro de la
-- transacción (ROLLBACK). Casos completos en
-- tests/security/99_eliminacion_residencial.sql.
-- ============================================================

do $$
declare
  f text;
begin
  if to_regprocedure('public.eliminacion_residencial_simular(uuid,text)') is null then
    raise notice 'INFO|99_eliminacion_residencial (grants) omitido: migración no aplicada';
    return;
  end if;
  foreach f in array array[
    'public.eliminacion_residencial_simular(uuid,text)',
    'public.eliminacion_residencial_ejecutar(uuid,text,text)',
    'public.eliminacion_residencial_completar(uuid)',
    'public.eliminacion_residencial_pendientes()'
  ] loop
    perform tests.igual('GER-01', 'staging: EXECUTE solo service_role: ' || f,
      format($q$select has_function_privilege('anon', %L, 'execute')::text || has_function_privilege('authenticated', %L, 'execute')::text || has_function_privilege('service_role', %L, 'execute')::text$q$, f, f, f),
      'falsefalsetrue');
  end loop;
  foreach f in array array[
    'public.eliminacion_residencial_servicio(uuid)', 'public.eliminacion_residencial_conteo(uuid)',
    'public.eliminacion_residencial_cuentas(uuid)', 'public.eliminacion_residencial_cuenta_referenciada(uuid)',
    'public.eliminacion_residencial_archivos(uuid)'
  ] loop
    perform tests.igual('GER-02', 'staging: ayudante sin EXECUTE para la API: ' || f,
      format($q$select (has_function_privilege('anon', %L, 'execute') or has_function_privilege('authenticated', %L, 'execute') or has_function_privilege('service_role', %L, 'execute'))::text$q$, f, f, f),
      'false');
  end loop;
  perform tests.igual('GER-02b', 'staging: la verificación de residencial vacío solo la ejecuta authenticated',
    $q$select has_function_privilege('anon', 'public.eliminacion_residencial_vacio(uuid)', 'execute')::text
           || has_function_privilege('authenticated', 'public.eliminacion_residencial_vacio(uuid)', 'execute')::text
           || has_function_privilege('service_role', 'public.eliminacion_residencial_vacio(uuid)', 'execute')::text$q$,
    'falsetruefalse');
  perform tests.igual('GER-03', 'staging: el registro de eliminaciones no es accesible desde la API',
    $q$select (has_table_privilege('anon', 'public.eliminaciones_residencial', 'select,insert,update,delete,truncate')
            or has_table_privilege('authenticated', 'public.eliminaciones_residencial', 'select,insert,update,delete,truncate')
            or has_table_privilege('service_role', 'public.eliminaciones_residencial', 'select,insert,update,delete,truncate'))::text$q$,
    'false');
end $$;

select to_regprocedure('public.eliminacion_residencial_simular(uuid,text)') is not null as hay_er \gset
\if :hay_er

-- Recorrido completo como service_role (lo que hace el script por PostgREST).
begin;
insert into public.empresas (id, nombre) values ('e0000000-0000-0000-0000-0000000000e9', 'ZZ Empresa Grants ER');
insert into public.tenants (id, nombre, tipo, empresa_id, pais) values ('e9000000-0000-0000-0000-000000000000', 'ZZ Residencial Grants ER', 'residencial', 'e0000000-0000-0000-0000-0000000000e9', 'MX');
insert into public.suscripciones (tenant_id, estado, trial_started_at, trial_ends_at, origen)
values ('e9000000-0000-0000-0000-000000000000', 'trialing', now() - interval '80 days', now() - interval '50 days', 'registro_publico');
set local role supabase_auth_admin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e9', 'zz_er_grants@test.local');
reset role;
insert into public.user_tenants (user_id, tenant_id, rol_id)
select '00000000-0000-0000-0000-0000000000e9', 'e9000000-0000-0000-0000-000000000000', id from public.roles where clave = 'admin_residencial';
insert into storage.objects (bucket_id, name) values ('evidencia', 'e9000000-0000-0000-0000-000000000000/p/foto.jpg');
do $$
declare
  s jsonb;
  e jsonb;
  c1 jsonb;
  c2 jsonb;
  denegado text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  s := public.eliminacion_residencial_simular('e9000000-0000-0000-0000-000000000000', 'ticket-grants');
  e := public.eliminacion_residencial_ejecutar((s->>'eliminacion_id')::uuid, s->>'codigo', 'ZZ Residencial Grants ER');
  c1 := public.eliminacion_residencial_completar((s->>'eliminacion_id')::uuid);
  begin
    perform count(*) from public.eliminaciones_residencial;
    denegado := 'leyó';
  exception when others then
    denegado := sqlstate;
  end;
  execute 'reset role';
  -- Lo que harían las API de Storage y Auth.
  delete from storage.objects where name like 'e9000000-0000-0000-0000-000000000000/%';
  delete from auth.users where id = '00000000-0000-0000-0000-0000000000e9';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  c2 := public.eliminacion_residencial_completar((s->>'eliminacion_id')::uuid);
  execute 'reset role';
  perform tests.igual('GER-10', 'staging: service_role simula, ejecuta y la base pide borrar 1 archivo y 1 cuenta',
    format('select %L', concat_ws('|', s->>'elegible', e->>'estado', c1->>'estado', c1->>'archivos_pendientes', jsonb_array_length(c1->'cuentas_pendientes'))),
    'true|en_curso|en_curso|1|1');
  perform tests.igual('GER-11', 'staging: con Storage y Auth vacíos queda completada y sin restos',
    format('select %L || ''|'' || (public.eliminacion_residencial_conteo(%L) = ''{}''::jsonb)::text', c2->>'estado', 'e9000000-0000-0000-0000-000000000000'),
    'completada|true');
  perform tests.igual('GER-12', 'staging: service_role no lee el registro directamente', format('select %L', denegado), '42501');
end $$;
rollback;

begin;
do $$
begin
  perform tests.como('00000000-0000-0000-0000-00000000000a');
  execute 'set local role authenticated';
  perform tests.debe_fallar('GER-13', 'staging: authenticated no simula', 'select public.eliminacion_residencial_simular(''aaaaaaaa-0000-0000-0000-000000000000'', ''x-1'')', '42501');
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  perform tests.debe_fallar('GER-14', 'staging: anon no completa', format('select public.eliminacion_residencial_completar(%L)', gen_random_uuid()), '42501');
  execute 'reset role';
end $$;
rollback;

-- Super Admin con los grants de staging: solo borra residenciales vacíos.
begin;
insert into public.tenants (id, nombre, tipo, empresa_id) values
  ('e9100000-0000-0000-0000-000000000000', 'ZZ Recién creado', 'residencial', 'e0000000-0000-0000-0000-000000000001');
insert into public.unidades (tenant_id, tipo, identificador) values ('aaaaaaaa-0000-0000-0000-000000000000', 'casa', 'ZZ Casa grants');
do $$
begin
  perform tests.como('00000000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';
  perform tests.filas('GER-15', 'staging: Super Admin no borra un residencial con datos por la API', 'delete from public.tenants where id = ''aaaaaaaa-0000-0000-0000-000000000000''', 0);
  perform tests.filas('GER-16', 'staging: Super Admin sí borra uno vacío (reversión de un alta)', 'delete from public.tenants where id = ''e9100000-0000-0000-0000-000000000000''', 1);
  execute 'reset role';
end $$;
rollback;

\endif
