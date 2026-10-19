-- ============================================================
-- Rollback de 20261008100000_billing_base.sql
--
-- Requiere revertir antes 20261008200000_tenant_operativo_billing
-- (usa current_period_end y cancel_at_period_end).
--
-- ATENCIÓN: borra billing_checkouts, billing_eventos y las columnas de
-- proveedor de suscripciones. Con suscripciones pagadas reales eso
-- pierde la asociación con el proveedor: no ejecutar en un entorno con
-- cobros sin exportar antes esos datos (docs/operations/BILLING.md).
-- Verificado por los runners locales: el catálogo queda idéntico al
-- previo a la migración.
-- ============================================================

drop function if exists public.billing_aplicar_evento(text, text, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text, bigint, text);
drop function if exists public.billing_registrar_checkout_proveedor(uuid, text);
drop function if exists public.billing_crear_checkout(uuid, uuid, text, text, text, bigint, timestamptz);
drop function if exists public.billing_viviendas_requeridas(uuid);
drop function if exists public.billing_limite_plan(text);

drop table if exists public.billing_eventos;
drop table if exists public.billing_checkouts;

drop index if exists public.uq_suscripciones_provider_subscription;
alter table public.suscripciones
  drop constraint if exists suscripciones_cancelacion_periodo_check,
  drop constraint if exists suscripciones_proveedor_completo_check,
  drop constraint if exists suscripciones_provider_check,
  drop constraint if exists suscripciones_plan_check,
  drop column if exists provider_version_at,
  drop column if exists cancel_at_period_end,
  drop column if exists current_period_end,
  drop column if exists provider_subscription_id,
  drop column if exists provider_customer_id,
  drop column if exists provider,
  drop column if exists plan;
