-- ============================================================
-- Rollback de 20261013000000_superadmin_suscripcion_manual.sql
--
-- Quita las tres funciones de Super Admin y la auxiliar. No toca datos:
-- las suscripciones extendidas o activadas siguen como quedaron (el
-- acceso lo sigue decidiendo tenant_operativo con esos mismos campos) y
-- la auditoría se conserva.
-- ============================================================

drop function if exists public.superadmin_extender_suscripcion_manual(uuid, date);
drop function if exists public.superadmin_activar_suscripcion_manual(uuid, date, text);
drop function if exists public.superadmin_extender_trial(uuid, date);
drop function if exists public.suscripcion_fin_dia_local(date, text);
