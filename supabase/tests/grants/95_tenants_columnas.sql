-- ============================================================
-- Columnas protegidas de tenants con los grants de staging. Los casos
-- completos están en tests/security/95_tenants_columnas.sql.
-- ============================================================

do $$
begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then
    raise notice 'INFO|95_tenants_columnas (grants) omitido: migración no aplicada';
    return;
  end if;
  perform tests.igual('GT-01', 'staging: authenticated actualiza solo 6 columnas de tenants',
    $q$select string_agg(attname, ',' order by attname) from pg_attribute
       where attrelid = 'public.tenants'::regclass and attnum > 0 and not attisdropped
         and has_column_privilege('authenticated', 'public.tenants', attname, 'UPDATE')$q$,
    'configuracion,correo,direccion,nombre,onboarding_completado,telefono');
  perform tests.igual('GT-02', 'staging: SELECT/INSERT/DELETE de authenticated, anon y service_role sobre tenants sin cambios',
    $q$select string_agg(r || ':' || concat_ws(',',
         case when has_table_privilege(r, 'public.tenants', 'SELECT') then 'S' end,
         case when has_table_privilege(r, 'public.tenants', 'INSERT') then 'I' end,
         case when has_table_privilege(r, 'public.tenants', 'UPDATE') then 'U' end,
         case when has_table_privilege(r, 'public.tenants', 'DELETE') then 'D' end), ' ' order by r)
       from unnest(array['anon','authenticated','service_role']) r$q$,
    'anon: authenticated:S,I,D service_role:S');
  perform tests.igual('GT-03', 'staging: anon y service_role sin UPDATE en ninguna columna de tenants',
    $q$select count(*)::text from pg_attribute a, unnest(array['anon','service_role']) r
       where a.attrelid = 'public.tenants'::regclass and a.attnum > 0 and not a.attisdropped
         and has_column_privilege(r, 'public.tenants', a.attname, 'UPDATE')$q$, '0');
end $$;

begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.filas('GT-10', 'staging: admin edita nombre y configuración (server action de /configuracion)',
    $q$update public.tenants set nombre = 'A', configuracion = '{}' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 1);
  perform tests.filas('GT-11', 'staging: onboarding (nombre, teléfono, correo, dirección, configuración) y fin del onboarding',
    $q$update public.tenants set nombre = 'A', telefono = '1', correo = 'a@a', direccion = 'd', configuracion = '{}', onboarding_completado = true
       where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 1);
  perform tests.debe_fallar('GT-12', 'staging: admin no cambia estado_servicio ni pais',
    $q$update public.tenants set estado_servicio = 'activo', pais = 'AR' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.debe_funcionar('GT-20', 'staging: super_admin cambia estado y plan de A por las funciones',
    $q$select public.superadmin_cambiar_estado_servicio('aaaaaaaa-0000-0000-0000-000000000000', 'suspendido'),
              public.superadmin_actualizar_plan_residencial('aaaaaaaa-0000-0000-0000-000000000000', 'pro', 49, null, null),
              public.superadmin_actualizar_residencial('aaaaaaaa-0000-0000-0000-000000000000', 'A', null, null, null, null, null, null)$q$);
end $$;
rollback;
