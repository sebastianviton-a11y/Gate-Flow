-- ============================================================
-- Documentos legales (20261014000000, Fase 1 inactiva) con los grants
-- de un proyecto Supabase nuevo como staging: default privileges que dan
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN en cada tabla nueva y EXECUTE a
-- PUBLIC en cada función nueva. La migración debe quitarlos TODOS: en
-- esta fase ningún rol de la API toca las tablas ni las funciones. Los
-- casos completos están en tests/security/92_documentos_legales.sql.
-- ============================================================

do $$
begin
  if to_regclass('public.aceptaciones_legales') is null then
    raise notice 'INFO|97_documentos_legales (grants) omitido: migración no aplicada';
    return;
  end if;
  perform tests.igual('GLG-01', 'staging: las 4 tablas legales sin ningún privilegio (ni los Dxtm por defecto) para anon, authenticated y service_role',
    $q$select coalesce(string_agg(c.relname || ':' || r || ':' || p, ',' order by c.relname, r, p), 'ninguno')
       from pg_class c
       cross join unnest(array['anon', 'authenticated', 'service_role']) r
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
       where c.oid in ('public.documentos_legales'::regclass, 'public.documentos_legales_versiones'::regclass,
                       'public.requisitos_legales'::regclass, 'public.aceptaciones_legales'::regclass)
         and has_table_privilege(r, c.oid, p)$q$,
    'ninguno');
  perform tests.igual('GLG-02', 'staging: sin privilegios de columna para la API',
    $q$select count(*)::text from pg_attribute a
       cross join unnest(array['anon', 'authenticated', 'service_role']) r
       where a.attrelid in ('public.documentos_legales'::regclass, 'public.documentos_legales_versiones'::regclass,
                            'public.requisitos_legales'::regclass, 'public.aceptaciones_legales'::regclass)
         and a.attnum > 0 and not a.attisdropped
         and (has_column_privilege(r, a.attrelid, a.attnum, 'SELECT') or has_column_privilege(r, a.attrelid, a.attnum, 'INSERT')
              or has_column_privilege(r, a.attrelid, a.attnum, 'UPDATE') or has_column_privilege(r, a.attrelid, a.attnum, 'REFERENCES'))$q$,
    '0');
  perform tests.igual('GLG-03', 'staging: ninguna de las 11 funciones legales es ejecutable por anon, authenticated ni service_role (pese al EXECUTE a PUBLIC por defecto)',
    $q$select coalesce(string_agg(p.proname || ':' || r, ',' order by p.proname, r), 'ninguna')
       from pg_proc p cross join unnest(array['anon', 'authenticated', 'service_role']) r
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('documentos_legales_catalogo_guardia', 'documentos_legales_versiones_guardia', 'documentos_legales_versiones_auditar',
                           'requisitos_legales_auditar', 'aceptaciones_legales_guardia', 'documentos_legales_impedir_truncate',
                           'documentos_legales_vigentes', 'documento_legal_publicado', 'documentos_pendientes',
                           'registrar_aceptaciones', 'descartar_aceptaciones_alta_fallida')
         and has_function_privilege(r, p.oid, 'EXECUTE')$q$,
    'ninguna');
  perform tests.igual('GLG-04', 'staging: son exactamente 11 funciones legales (nada sin revisar)',
    $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
         and (p.proname like '%legal%' or p.proname in ('documentos_pendientes', 'registrar_aceptaciones', 'descartar_aceptaciones_alta_fallida'))$q$,
    '11');
  perform tests.igual('GLG-05', 'staging: RLS activo en las 4 tablas y sin políticas',
    $q$select string_agg(c.relname || ':' || c.relrowsecurity::text || ':' ||
         (select count(*) from pg_policies x where x.schemaname = 'public' and x.tablename = c.relname)::text, ',' order by c.relname)
       from pg_class c
       where c.oid in ('public.documentos_legales'::regclass, 'public.documentos_legales_versiones'::regclass,
                       'public.requisitos_legales'::regclass, 'public.aceptaciones_legales'::regclass)$q$,
    'aceptaciones_legales:true:0,documentos_legales:true:0,documentos_legales_versiones:true:0,requisitos_legales:true:0');
end $$;

-- Con los grants de staging: ni el admin de A ni service_role llegan a
-- nada legal (inactiva).
select to_regclass('public.aceptaciones_legales') is not null as hay_lg \gset
\if :hay_lg
begin;
do $$
declare r text; q text; rol text;
begin
  foreach rol in array array['authenticated', 'service_role', 'anon'] loop
    foreach q in array array[
      'select count(*) from public.aceptaciones_legales',
      'select count(*) from public.documentos_legales',
      'select count(*) from public.documentos_pendientes(''aaaaaaaa-0000-0000-0000-000000000000'')',
      'select count(*) from public.documentos_legales_vigentes(''MX'')',
      'select public.registrar_aceptaciones(''aaaaaaaa-0000-0000-0000-000000000000'', array[gen_random_uuid()], ''aceptacion_posterior'', true)',
      'truncate public.aceptaciones_legales'] loop
      begin
        perform tests.como('00000000-0000-0000-0000-00000000000a');
        execute format('set local role %I', rol);
        execute q;
        reset role;
        r := 'ejecutó';
      exception when others then
        r := sqlstate;
      end;
      perform tests.igual('GLG-10', 'staging: ' || rol || ' rechazado en: ' || left(q, 70), format('select %L', r), '42501');
    end loop;
  end loop;
end $$;
rollback;
\endif
