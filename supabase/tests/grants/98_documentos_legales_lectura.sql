-- ============================================================
-- Lectura pública de documentos legales (20261015000000, Fase 2) con
-- los grants de un proyecto Supabase nuevo como staging. Solo las tres
-- lecturas de documentos publicados quedan para anon/authenticated; las
-- tablas y el resto de las funciones legales siguen cerradas. Casos
-- completos en tests/security/91_documentos_legales_lectura.sql.
-- ============================================================

do $$
begin
  if to_regprocedure('public.documentos_legales_historial(text,text)') is null then
    raise notice 'INFO|98_documentos_legales_lectura (grants) omitido: migración no aplicada';
    return;
  end if;
  perform tests.igual('GLP-01', 'staging: EXECUTE de las 3 lecturas públicas solo para anon y authenticated (no service_role)',
    $q$select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text
         || has_function_privilege('authenticated', p.oid, 'execute')::text
         || has_function_privilege('service_role', p.oid, 'execute')::text, ',' order by p.proname)
       from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('documentos_legales_vigentes', 'documento_legal_publicado', 'documentos_legales_historial')$q$,
    'documento_legal_publicado:truetruefalse,documentos_legales_historial:truetruefalse,documentos_legales_vigentes:truetruefalse');
  perform tests.igual('GLP-02', 'staging: el resto de las funciones legales siguen sin EXECUTE para la API',
    $q$select coalesce(string_agg(p.proname || ':' || r, ',' order by p.proname, r), 'ninguna')
       from pg_proc p cross join unnest(array['anon', 'authenticated', 'service_role']) r
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('documentos_legales_catalogo_guardia', 'documentos_legales_versiones_guardia', 'documentos_legales_versiones_auditar',
                           'requisitos_legales_auditar', 'aceptaciones_legales_guardia', 'documentos_legales_impedir_truncate',
                           'documentos_pendientes', 'registrar_aceptaciones', 'descartar_aceptaciones_alta_fallida')
         and has_function_privilege(r, p.oid, 'EXECUTE')$q$,
    'ninguna');
  perform tests.igual('GLP-03', 'staging: las 4 tablas legales siguen sin ningún privilegio para la API',
    $q$select coalesce(string_agg(c.relname || ':' || r || ':' || p, ','), 'ninguno')
       from pg_class c
       cross join unnest(array['anon', 'authenticated', 'service_role']) r
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
       where c.oid in ('public.documentos_legales'::regclass, 'public.documentos_legales_versiones'::regclass,
                       'public.requisitos_legales'::regclass, 'public.aceptaciones_legales'::regclass)
         and has_table_privilege(r, c.oid, p)$q$,
    'ninguno');
end $$;

select to_regprocedure('public.documentos_legales_historial(text,text)') is not null as hay_lp \gset
\if :hay_lp
begin;
do $$
declare r text; rol text;
begin
  -- Con los grants de staging, anon (sin sesión, como las páginas) lee; nada publicado: 0 filas.
  foreach rol in array array['anon', 'authenticated'] loop
    begin
      perform tests.como(null);
      execute format('set local role %I', rol);
      r := (select count(*)::text from public.documentos_legales_vigentes('MX'))
           || '/' || (select count(*)::text from public.documentos_legales_historial('terminos', 'MX'))
           || '/' || (select count(*)::text from public.documento_legal_publicado(gen_random_uuid()));
      reset role;
    exception when others then
      r := sqlstate || ':' || sqlerrm;
    end;
    perform tests.igual('GLP-10', 'staging: ' || rol || ' lee las 3 funciones públicas (sin nada publicado: 0/0/0)', format('select %L', r), '0/0/0');
  end loop;
  begin
    perform tests.como(null);
    set local role service_role;
    perform count(*) from public.documentos_legales_vigentes('MX');
    reset role;
    r := 'ejecutó';
  exception when others then
    r := sqlstate;
  end;
  perform tests.igual('GLP-11', 'staging: service_role no lee (no recibió EXECUTE)', format('select %L', r), '42501');
end $$;
rollback;
\endif
