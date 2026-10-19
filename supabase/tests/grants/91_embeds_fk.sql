-- ============================================================
-- FKs que el código nombra en sus embeds de PostgREST
-- (packages/paquetes: queries.ts, incidencias.ts). Con la integridad
-- multitenant (20261007100000) cada uno de estos pares tiene DOS FKs
-- (la simple y la compuesta (x_id, tenant_id)) y un embed sin FK
-- nombrada responde 300 / PGRST201. El código usa las simples: deben
-- existir con esta definición en TODAS las fases (antes y después de
-- la integridad, igual que en producción y en staging).
-- ============================================================

do $$
begin
  perform tests.igual('GE-01', 'FKs simples usadas en los embeds: existen con su definición',
    $q$select string_agg(conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid), E'\n' order by conname)
       from pg_constraint
       where connamespace = 'public'::regnamespace
         and conname in ('incidencias_paquete_id_fkey', 'paquete_historial_paquete_id_fkey', 'paquetes_ubicacion_id_fkey',
                         'paquetes_unidad_id_fkey', 'residentes_unidades_unidad_id_fkey')$q$,
    'incidencias|incidencias_paquete_id_fkey|FOREIGN KEY (paquete_id) REFERENCES paquetes(id) ON DELETE CASCADE' || E'\n' ||
    'paquete_historial|paquete_historial_paquete_id_fkey|FOREIGN KEY (paquete_id) REFERENCES paquetes(id) ON DELETE CASCADE' || E'\n' ||
    'paquetes|paquetes_ubicacion_id_fkey|FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id)' || E'\n' ||
    'paquetes|paquetes_unidad_id_fkey|FOREIGN KEY (unidad_id) REFERENCES unidades(id)' || E'\n' ||
    'residentes_unidades|residentes_unidades_unidad_id_fkey|FOREIGN KEY (unidad_id) REFERENCES unidades(id) ON DELETE CASCADE');

  if to_regprocedure('public.fn_mt_casas()') is null then
    perform tests.igual('GE-02', 'sin integridad multitenant: una sola FK por par (embed sin FK no es ambiguo)',
      $q$select string_agg(n::text, ',' order by par) from (
           select conrelid::regclass::text || '>' || confrelid::regclass::text as par, count(*) as n
           from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace
             and (conrelid, confrelid) in (('public.paquete_historial'::regclass, 'public.paquetes'::regclass),
                                           ('public.paquetes'::regclass, 'public.unidades'::regclass),
                                           ('public.paquetes'::regclass, 'public.ubicaciones'::regclass),
                                           ('public.incidencias'::regclass, 'public.paquetes'::regclass),
                                           ('public.residentes_unidades'::regclass, 'public.unidades'::regclass))
           group by 1) x$q$, '1,1,1,1,1');
  else
    -- Documenta por qué el código nombra la FK: dos caminos por par.
    perform tests.igual('GE-02', 'con integridad multitenant: dos FKs por par (simple + compuesta) → el embed debe nombrar la FK',
      $q$select string_agg(n::text, ',' order by par) from (
           select conrelid::regclass::text || '>' || confrelid::regclass::text as par, count(*) as n
           from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace
             and (conrelid, confrelid) in (('public.paquete_historial'::regclass, 'public.paquetes'::regclass),
                                           ('public.paquetes'::regclass, 'public.unidades'::regclass),
                                           ('public.paquetes'::regclass, 'public.ubicaciones'::regclass),
                                           ('public.incidencias'::regclass, 'public.paquetes'::regclass),
                                           ('public.residentes_unidades'::regclass, 'public.unidades'::regclass))
           group by 1) x$q$, '2,2,2,2,2');
  end if;
end $$;
