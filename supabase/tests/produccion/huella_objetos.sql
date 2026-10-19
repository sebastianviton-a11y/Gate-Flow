-- Huella por objeto del esquema public (+ triggers en auth/storage y
-- políticas de storage). Solo catálogo: ninguna fila de datos.
-- Misma consulta en producción (solo lectura) y en la base local:
-- comparar por tipo (agregado) y solo bajar al detalle donde difiera.
with
cols as (
  select 'tabla'::text as k, c.relname::text as n,
    md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' ||
        coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ':' || a.attidentity::text || a.attgenerated::text, ',' order by a.attname)) as h
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where s.nspname = 'public' and c.relkind in ('r','p')
  group by c.relname
),
rls as (
  select 'rls', c.relname, c.relrowsecurity::text || c.relforcerowsecurity::text
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind in ('r','p')
),
cons as (
  select 'constraint', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid) || convalidated::text)
  from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
),
idx as (
  select 'indice', i.relname, md5(regexp_replace(pg_get_indexdef(i.oid), ' ON (ONLY )?public\.', ' ON '))
  from pg_index x join pg_class i on i.oid = x.indexrelid join pg_namespace s on s.oid = i.relnamespace
  where s.nspname = 'public' and not exists (select 1 from pg_constraint c where c.conindid = x.indexrelid)
),
fns as (
  select 'funcion', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    md5(replace(p.prosrc, E'\r', '')) || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '-') || '|' ||
    p.provolatile::text || '|' || pg_get_function_result(p.oid) || '|x=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || ',' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || ',' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
  from pg_proc p where p.pronamespace = 'public'::regnamespace
),
fns_body as (
  select 'funcion_cuerpo_sin_comentarios', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
  from pg_proc p where p.pronamespace = 'public'::regnamespace
),
trg as (
  select 'trigger', t.tgrelid::regclass::text || '.' || t.tgname, md5(pg_get_triggerdef(t.oid) || t.tgenabled::text)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
  where not t.tgisinternal and s.nspname in ('public','auth','storage')
),
pol as (
  select 'politica', schemaname || '.' || tablename || '.' || policyname,
    md5(permissive || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-'))
  from pg_policies where schemaname in ('public','storage')
),
vw as (
  select case c.relkind when 'v' then 'vista' else 'vista_mat' end, c.relname, md5(pg_get_viewdef(c.oid))
  from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind in ('v','m')
),
acl as (
  select 'grant_rel', c.relname || '@' || r,
    case when c.relkind = 'S' then
      concat_ws(',', case when has_sequence_privilege(r, c.oid, 'USAGE') then 'USAGE' end,
                     case when has_sequence_privilege(r, c.oid, 'SELECT') then 'SELECT' end,
                     case when has_sequence_privilege(r, c.oid, 'UPDATE') then 'UPDATE' end)
    else (select coalesce(string_agg(p, ','), '') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege(r, c.oid, p)) end
  from pg_class c join pg_namespace s on s.oid = c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r
  where s.nspname = 'public' and c.relkind in ('r','p','v','m','S')
),
colacl as (
  select 'grant_col', c.relname || '.' || a.attname || '@' || r,
    (select coalesce(string_agg(p, ','), '') from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
     where has_column_privilege(r, c.oid, a.attnum, p) and not has_table_privilege(r, c.oid, p))
  from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  join pg_namespace s on s.oid = c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r
  where s.nspname = 'public'
),
defacl as (
  select 'default_acl', pg_get_userbyid(defaclrole) || '.' || coalesce(defaclnamespace::regnamespace::text, '*') || '.' || defaclobjtype::text,
    array_to_string(array(select regexp_replace(unnest(defaclacl)::text, '/.*$', '') order by 1), ',')
  from pg_default_acl where defaclnamespace = 'public'::regnamespace and pg_get_userbyid(defaclrole) = 'postgres'
),
tipos as (
  select 'tipo', t.typname, coalesce((select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e where e.enumtypid = t.oid), t.typtype::text)
  from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype in ('e','d','c') and t.typrelid = 0 or (t.typnamespace = 'public'::regnamespace and t.typtype = 'e')
),
seqs as (
  select 'secuencia', c.relname, s.seqtypid::regtype::text || '|' || s.seqincrement::text || '|' || s.seqcycle::text
  from pg_sequence s join pg_class c on c.oid = s.seqrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
),
buckets as (
  select 'bucket', id, public::text || '|' || coalesce(file_size_limit::text, '-') || '|' || coalesce(array_to_string(allowed_mime_types, ','), '-')
  from storage.buckets
),
esquema as (
  select 'schema_acl', n.nspname || '@' || r,
    has_schema_privilege(r, n.oid, 'USAGE')::text || ',' || has_schema_privilege(r, n.oid, 'CREATE')::text
  from pg_namespace n cross join unnest(array['anon','authenticated','service_role']) r where n.nspname in ('public','extensions')
)
select k, n, h from (
  select * from cols union all select * from rls union all select * from cons union all select * from idx union all
  select * from fns union all select * from fns_body union all select * from trg union all select * from pol union all select * from vw union all
  select * from acl union all select * from colacl union all select * from defacl union all select * from tipos union all
  select * from seqs union all select * from buckets union all select * from esquema
) x order by k, n;
