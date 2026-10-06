-- ============================================================
-- Rollback de 20261007100000_integridad_multitenant.sql
--
-- Quita los triggers y funciones de integridad, las FK compuestas y
-- los UNIQUE (id, tenant_id). No toca datos ni las FK originales.
-- Verificado por los runners locales: el catálogo queda idéntico al
-- previo a la migración.
-- ============================================================

drop trigger if exists trg_mt_paquetes_catalogos on public.paquetes;
drop trigger if exists trg_mt_casas on public.casas;
drop trigger if exists trg_mt_departamentos on public.departamentos;
drop function if exists public.fn_mt_catalogos_paquete();
drop function if exists public.fn_mt_casas();
drop function if exists public.fn_mt_departamentos();

alter table public.ubicaciones drop constraint if exists fk_mt_ubicaciones_padre;
alter table public.manzanas drop constraint if exists fk_mt_manzanas_calle;
alter table public.paquete_ubicacion_historial
  drop constraint if exists fk_mt_ubicacion_historial_nueva,
  drop constraint if exists fk_mt_ubicacion_historial_anterior,
  drop constraint if exists fk_mt_ubicacion_historial_paquete;
alter table public.paquete_historial drop constraint if exists fk_mt_paquete_historial_paquete;
alter table public.paquete_fotografias drop constraint if exists fk_mt_paquete_fotografias_paquete;
alter table public.paquete_firmas drop constraint if exists fk_mt_paquete_firmas_paquete;
alter table public.notificaciones drop constraint if exists fk_mt_notificaciones_paquete;
alter table public.incidencias drop constraint if exists fk_mt_incidencias_paquete;
alter table public.residentes_unidades drop constraint if exists fk_mt_residentes_unidades_unidad;
alter table public.paquete_grupos_entrega drop constraint if exists fk_mt_grupos_entrega_unidad;
alter table public.paquetes
  drop constraint if exists fk_mt_paquetes_grupo_entrega,
  drop constraint if exists fk_mt_paquetes_ubicacion,
  drop constraint if exists fk_mt_paquetes_unidad;

alter table public.calles drop constraint if exists uq_mt_calles_id_tenant;
alter table public.paquetes drop constraint if exists uq_mt_paquetes_id_tenant;
alter table public.paquete_grupos_entrega drop constraint if exists uq_mt_grupos_entrega_id_tenant;
alter table public.ubicaciones drop constraint if exists uq_mt_ubicaciones_id_tenant;
alter table public.unidades drop constraint if exists uq_mt_unidades_id_tenant;
