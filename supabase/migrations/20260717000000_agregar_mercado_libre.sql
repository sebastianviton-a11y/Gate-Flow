-- ============================================================
-- 20260717000000_agregar_mercado_libre.sql
-- El catálogo global de empresas_paqueteria (seed.sql, Sprint 01) nunca
-- incluyó "Mercado Libre" — un courier real y frecuente en México que
-- se pidió explícitamente en el flujo de registro. Se agrega como
-- catálogo global (tenant_id null), mismo patrón que el resto.
-- ============================================================

insert into public.empresas_paqueteria (tenant_id, nombre)
values (null, 'Mercado Libre')
on conflict do nothing;
