-- ============================================================
-- Rollback de 20261008200000_tenant_operativo_billing.sql
--
-- Restaura exactamente la tenant_operativo() de
-- 20261007000000_tenant_operativo.sql (active o trial vigente; sin
-- gracia ni cancelación al final del periodo). Mismos grants.
-- Verificado por los runners locales: catálogo idéntico al previo.
-- ============================================================

create or replace function public.tenant_operativo(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_tenant_id is null then false
    when public.is_super_admin() then true
    else exists (
      select 1
      from public.user_tenants ut
      join public.tenants t on t.id = ut.tenant_id
      join public.suscripciones s on s.tenant_id = t.id
      where ut.user_id = auth.uid()
        and ut.activo = true
        and ut.tenant_id = p_tenant_id
        and t.estado_servicio in ('piloto', 'activo', 'cancelado')
        and (
          s.estado = 'active'
          or (s.estado = 'trialing' and s.trial_ends_at is not null and pg_catalog.now() < s.trial_ends_at)
        )
    )
  end;
$$;

comment on function public.tenant_operativo(uuid) is
  'true si quien llama puede operar el tenant: super_admin, o miembro activo de un tenant no suspendido con suscripción active o trial vigente. Falla cerrado.';
