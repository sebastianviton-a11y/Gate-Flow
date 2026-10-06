-- ============================================================
-- Rollback de 20261008000000_tenants_columnas_protegidas.sql
--
-- Quita las tres funciones de Super Admin y devuelve a authenticated
-- el UPDATE a nivel de tabla sobre public.tenants (sin grants por
-- columna). No toca datos ni políticas. Verificado por los runners
-- locales: el catálogo queda idéntico al previo a la migración.
-- ============================================================

drop function if exists public.superadmin_actualizar_residencial(uuid, text, text, text, text, text, text, text);
drop function if exists public.superadmin_cambiar_estado_servicio(uuid, text);
drop function if exists public.superadmin_actualizar_plan_residencial(uuid, text, numeric, date, date);

revoke update (nombre, direccion, telefono, correo, configuracion, onboarding_completado)
  on public.tenants from authenticated;
grant update on public.tenants to authenticated;
