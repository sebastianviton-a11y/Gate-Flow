-- ============================================================
-- Evidencia de aceptación en el registro y en las invitaciones
-- (20261017000000, Fase 3) con los grants de un proyecto Supabase nuevo
-- como staging (default privileges que dan EXECUTE a todos). Documentos
-- y requisitos FICTICIOS dentro de cada transacción (ROLLBACK). Casos
-- completos en tests/security/97_aceptaciones_registro.sql.
-- ============================================================

do $$
declare
  f text;
begin
  if to_regprocedure('public.aceptar_documentos_invitacion(uuid,uuid[])') is null then
    raise notice 'INFO|99_aceptaciones_registro (grants) omitido: migración no aplicada';
    return;
  end if;
  foreach f in array array[
    'public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean,uuid[],boolean)',
    'public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)'
  ] loop
    perform tests.igual('GF3-01', 'staging: EXECUTE solo service_role: ' || f,
      format($q$select has_function_privilege('anon', %L, 'execute')::text || has_function_privilege('authenticated', %L, 'execute')::text || has_function_privilege('service_role', %L, 'execute')::text$q$, f, f, f),
      'falsefalsetrue');
  end loop;
  perform tests.igual('GF3-02', 'staging: aceptar_documentos_invitacion solo para authenticated',
    $q$select has_function_privilege('anon', 'public.aceptar_documentos_invitacion(uuid,uuid[])', 'execute')::text
         || has_function_privilege('authenticated', 'public.aceptar_documentos_invitacion(uuid,uuid[])', 'execute')::text
         || has_function_privilege('service_role', 'public.aceptar_documentos_invitacion(uuid,uuid[])', 'execute')::text$q$,
    'falsetruefalse');
  perform tests.igual('GF3-03', 'staging: la función del trigger de users no es ejecutable por la API',
    $q$select (has_function_privilege('anon', 'public.users_terminos_solo_servidor()', 'execute')
             or has_function_privilege('authenticated', 'public.users_terminos_solo_servidor()', 'execute')
             or has_function_privilege('service_role', 'public.users_terminos_solo_servidor()', 'execute'))::text$q$,
    'false');
end $$;

select to_regprocedure('public.aceptar_documentos_invitacion(uuid,uuid[])') is not null as hay_f3 \gset
\if :hay_f3

-- Documentos ficticios publicados (como postgres) y requisitos de México.
create or replace function tests.f3_documentos() returns uuid[] language plpgsql as $$
declare v_clave text; v_id uuid; v_ids uuid[] := '{}';
begin
  foreach v_clave in array array['terminos', 'privacidad', 'acuerdo_tratamiento'] loop
    insert into public.documentos_legales_versiones (documento_clave, version, jurisdiccion, contenido, contenido_sha256)
    values (v_clave, '1.0', 'MX', 'ZZ texto ficticio de prueba (' || v_clave || '). No es un documento legal.', repeat('0', 64))
    returning id into v_id;
    update public.documentos_legales_versiones set estado = 'aprobado', aprobado_por = 'ZZ referencia ficticia' where id = v_id;
    update public.documentos_legales_versiones set estado = 'publicado', vigente_desde = now() - interval '4 minutes' where id = v_id;
    v_ids := v_ids || v_id;
  end loop;
  insert into public.requisitos_legales (rol_clave, documento_clave, jurisdiccion, tipo, alcance) values
    ('admin_residencial', 'terminos', 'MX', 'aceptacion', 'usuario'),
    ('admin_residencial', 'privacidad', 'MX', 'acuse', 'usuario'),
    ('admin_residencial', 'acuerdo_tratamiento', 'MX', 'aceptacion', 'residencial'),
    ('guardia', 'privacidad', 'MX', 'acuse', 'usuario');
  return v_ids;
end $$;

-- Alta completa como service_role con los grants de staging.
begin;
set local role supabase_auth_admin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'zz_f3_grants@test.local');
reset role;
do $$
declare
  ids uuid[] := tests.f3_documentos();
  r jsonb;
  t uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-0000000000e1', 'Residencial ZZ Grants F3', 'MX', 12, 'America/Mexico_City', true, ids, true);
  execute 'reset role';
  t := (r->>'tenant_id')::uuid;
  perform tests.igual('GF3-10', 'staging: service_role completa el alta con 3 aceptaciones (versión, hash y hora del servidor)',
    format($q$select count(*)::text from public.aceptaciones_legales a join public.documentos_legales_versiones v on v.id = a.version_id
             where a.user_id = '00000000-0000-0000-0000-0000000000e1' and a.tenant_id = %L and a.origen = 'registro'
               and a.contenido_sha256 = v.contenido_sha256 and a.aceptado_en = now()$q$, t),
    '3');
end $$;
rollback;

-- Invitación como authenticated y escritura directa bloqueada.
begin;
do $$
declare
  ids uuid[] := tests.f3_documentos();
  r jsonb;
  estado text;
begin
  perform tests.como('00000000-0000-0000-0000-0000000000a9');
  execute 'set local role authenticated';
  r := public.aceptar_documentos_invitacion('aaaaaaaa-0000-0000-0000-000000000000', array[ids[2]]);
  begin
    update public.users set terminos_aceptados_en = '2030-01-01' where id = '00000000-0000-0000-0000-0000000000a9';
    estado := 'ejecutó';
  exception when others then
    estado := sqlstate;
  end;
  execute 'reset role';
  perform tests.igual('GF3-11', 'staging: el guardia invitado registra su acuse con la hora del servidor',
    format($q$select (%L::int = 1 and (select terminos_aceptados_en = now() from public.users where id = '00000000-0000-0000-0000-0000000000a9')
                      and (select count(*) from public.aceptaciones_legales where user_id = '00000000-0000-0000-0000-0000000000a9' and origen = 'invitacion') = 1)::text$q$,
           r->>'registradas'),
    'true');
  perform tests.igual('GF3-12', 'staging: authenticated no escribe terminos_aceptados_en directamente', format('select %L', estado), '42501');
end $$;
rollback;

\endif
