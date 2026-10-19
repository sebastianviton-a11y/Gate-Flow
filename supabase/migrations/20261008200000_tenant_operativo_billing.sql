-- ============================================================
-- 20261008200000_tenant_operativo_billing.sql
--
-- tenant_operativo() con las dos reglas de billing aprobadas. Misma
-- firma, mismos grants (CREATE OR REPLACE conserva el ACL); solo cambia
-- la condición de la suscripción:
--
--   active     operativo, salvo cancel_at_period_end con el periodo
--              pagado ya terminado (now() >= current_period_end): se
--              bloquea aunque el webhook de cancelación no haya llegado
--              (igual que el trial con trial_ends_at).
--   trialing   igual que antes: now() < trial_ends_at.
--   past_due   gracia de 7 días: now() < current_period_end + 7 días.
--              Sin current_period_end → no operativo (falla cerrado).
--   canceled, expired → no operativo.
--
-- La regla TypeScript equivalente vive en packages/auth/src/acceso.ts
-- (estadoEfectivoSuscripcion); los tests de frontera cubren ambas.
-- Requiere 20261008100000_billing_base (columnas nuevas).
-- Rollback: supabase/rollback/20261008200000_tenant_operativo_billing.down.sql
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
          (s.estado = 'active'
            and (not s.cancel_at_period_end
                 or (s.current_period_end is not null and pg_catalog.now() < s.current_period_end)))
          or (s.estado = 'trialing' and s.trial_ends_at is not null and pg_catalog.now() < s.trial_ends_at)
          or (s.estado = 'past_due' and s.current_period_end is not null
              and pg_catalog.now() < s.current_period_end + interval '7 days')
        )
    )
  end;
$$;

comment on function public.tenant_operativo(uuid) is
  'true si quien llama puede operar el tenant: super_admin, o miembro activo de un tenant no suspendido con suscripción active (sin cancelación ya cumplida), trial vigente o past_due dentro de 7 días de gracia. Falla cerrado.';
