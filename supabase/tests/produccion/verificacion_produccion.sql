-- ============================================================
-- Verificación de PRODUCCIÓN antes y después de las migraciones.
-- SOLO LECTURA (solo SELECT) y solo conteos: ningún dato personal.
-- Correr idéntica antes y después de la ventana y comparar:
--   · conteos por tabla iguales (las tablas nuevas solo existen después)
--   · 0 violaciones de las FK compuestas de integridad multitenant
--   · después: 1 suscripción active/alta_manual por residencial existente
-- ============================================================
select 'filas' as tipo, t as clave, n::text as valor from (
  select 'tenants' t, count(*) n from public.tenants union all
  select 'empresas', count(*) from public.empresas union all
  select 'users', count(*) from public.users union all
  select 'user_tenants', count(*) from public.user_tenants union all
  select 'unidades', count(*) from public.unidades union all
  select 'residentes_unidades', count(*) from public.residentes_unidades union all
  select 'ubicaciones', count(*) from public.ubicaciones union all
  select 'paquetes', count(*) from public.paquetes union all
  select 'paquete_historial', count(*) from public.paquete_historial union all
  select 'paquete_grupos_entrega', count(*) from public.paquete_grupos_entrega union all
  select 'paquete_fotografias', count(*) from public.paquete_fotografias union all
  select 'paquete_firmas', count(*) from public.paquete_firmas union all
  select 'incidencias', count(*) from public.incidencias union all
  select 'notificaciones', count(*) from public.notificaciones union all
  select 'audit_log', count(*) from public.audit_log union all
  select 'auth.users', count(*) from auth.users union all
  select 'storage.objects', count(*) from storage.objects
) x
union all
select 'fk_violaciones', fk, n::text from (
  select 'incidencias.paquete' fk, count(*) n from public.incidencias c where c.paquete_id is not null and not exists (select 1 from public.paquetes p where p.id = c.paquete_id and p.tenant_id = c.tenant_id)
  union all select 'manzanas.calle', count(*) from public.manzanas c where c.calle_id is not null and not exists (select 1 from public.calles p where p.id = c.calle_id and p.tenant_id = c.tenant_id)
  union all select 'notificaciones.paquete', count(*) from public.notificaciones c where c.paquete_id is not null and not exists (select 1 from public.paquetes p where p.id = c.paquete_id and p.tenant_id = c.tenant_id)
  union all select 'paquete_firmas.paquete', count(*) from public.paquete_firmas c where c.paquete_id is not null and not exists (select 1 from public.paquetes p where p.id = c.paquete_id and p.tenant_id = c.tenant_id)
  union all select 'paquete_fotografias.paquete', count(*) from public.paquete_fotografias c where c.paquete_id is not null and not exists (select 1 from public.paquetes p where p.id = c.paquete_id and p.tenant_id = c.tenant_id)
  union all select 'grupos_entrega.unidad', count(*) from public.paquete_grupos_entrega c where c.unidad_id is not null and not exists (select 1 from public.unidades p where p.id = c.unidad_id and p.tenant_id = c.tenant_id)
  union all select 'paquete_historial.paquete', count(*) from public.paquete_historial c where c.paquete_id is not null and not exists (select 1 from public.paquetes p where p.id = c.paquete_id and p.tenant_id = c.tenant_id)
  union all select 'ubicacion_historial.anterior', count(*) from public.paquete_ubicacion_historial c where c.ubicacion_anterior_id is not null and not exists (select 1 from public.ubicaciones p where p.id = c.ubicacion_anterior_id and p.tenant_id = c.tenant_id)
  union all select 'ubicacion_historial.nueva', count(*) from public.paquete_ubicacion_historial c where c.ubicacion_nueva_id is not null and not exists (select 1 from public.ubicaciones p where p.id = c.ubicacion_nueva_id and p.tenant_id = c.tenant_id)
  union all select 'ubicacion_historial.paquete', count(*) from public.paquete_ubicacion_historial c where c.paquete_id is not null and not exists (select 1 from public.paquetes p where p.id = c.paquete_id and p.tenant_id = c.tenant_id)
  union all select 'paquetes.grupo_entrega', count(*) from public.paquetes c where c.grupo_entrega_id is not null and not exists (select 1 from public.paquete_grupos_entrega p where p.id = c.grupo_entrega_id and p.tenant_id = c.tenant_id)
  union all select 'paquetes.ubicacion', count(*) from public.paquetes c where c.ubicacion_id is not null and not exists (select 1 from public.ubicaciones p where p.id = c.ubicacion_id and p.tenant_id = c.tenant_id)
  union all select 'paquetes.unidad', count(*) from public.paquetes c where c.unidad_id is not null and not exists (select 1 from public.unidades p where p.id = c.unidad_id and p.tenant_id = c.tenant_id)
  union all select 'residentes_unidades.unidad', count(*) from public.residentes_unidades c where c.unidad_id is not null and not exists (select 1 from public.unidades p where p.id = c.unidad_id and p.tenant_id = c.tenant_id)
  union all select 'ubicaciones.padre', count(*) from public.ubicaciones c where c.padre_id is not null and not exists (select 1 from public.ubicaciones p where p.id = c.padre_id and p.tenant_id = c.tenant_id)
) f
union all
select 'tenants_por', coalesce(pais, '-') || '|activo=' || activo || '|plan=' || coalesce(plan, '-'), count(*)::text from public.tenants group by 2
union all
-- Solo después de la ventana (antes la tabla no existe): descomentar.
-- select 'suscripciones', estado || '/' || origen || '|proveedor=' || coalesce(provider, '-'), count(*)::text from public.suscripciones group by 2 union all
select 'migraciones_registradas', 'supabase_migrations', count(*)::text from supabase_migrations.schema_migrations
order by 1, 2;
