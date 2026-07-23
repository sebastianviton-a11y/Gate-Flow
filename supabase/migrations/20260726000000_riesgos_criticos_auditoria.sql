-- ============================================================
-- 20260726000000_riesgos_criticos_auditoria.sql
--
-- Corrige los 3 riesgos criticos de PERMISSIONS.md, en orden de
-- prioridad. Cada bloque es independiente y documenta que riesgo
-- cierra.
-- ============================================================

-- ── RIESGO 1: Bodega/ubicaciones sin restriccion de rol ────────
-- Antes: una sola politica "for all" solo verificaba tenant_id, sin
-- verificar rol -- cualquier guardia podia escribir directo contra
-- Supabase. Se divide exactamente igual al patron ya usado en
-- unidades (migracion 20260722000000_editar_unidades.sql).
drop policy if exists ubicaciones_tenant_isolation on public.ubicaciones;

create policy ubicaciones_select on public.ubicaciones
  for select using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());

create policy ubicaciones_insert_admin on public.ubicaciones
  for insert with check (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

create policy ubicaciones_update_admin on public.ubicaciones
  for update using (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  )
  with check (tenant_id in (select public.current_tenant_ids()));

create policy ubicaciones_delete_admin on public.ubicaciones
  for delete using (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

-- ── RIESGO 2: Paquetes entregados sin proteccion ────────────────
-- Antes: "for all" en paquetes no distinguia estado -- un guardia
-- podia editar o eliminar un paquete ya entregado, indistinguible de
-- una edicion normal, sin ningun flujo de correccion auditado.
--
-- No se bloquea la edicion por completo (un admin_residencial debe
-- poder corregir errores reales) -- se bloquea especificamente que
-- GUARDIA edite o elimine un paquete cuyo estado_id ya sea
-- 'entregado'. admin_residencial/super_admin siempre pueden corregir,
-- y cada cambio de estado ya queda en paquete_historial (existe desde
-- el sprint de paquetes) -- ese es el "flujo de correccion auditado".
drop policy if exists paquetes_tenant_isolation on public.paquetes;

create policy paquetes_select on public.paquetes
  for select using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());

create policy paquetes_insert on public.paquetes
  for insert with check (tenant_id in (select public.current_tenant_ids()));

create policy paquetes_update on public.paquetes
  for update using (
    tenant_id in (select public.current_tenant_ids())
    and (
      public.has_role(array['admin_residencial', 'super_admin'])
      or estado_id <> 'entregado'
    )
  )
  with check (tenant_id in (select public.current_tenant_ids()));

create policy paquetes_delete_admin on public.paquetes
  for delete using (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

-- ── RIESGO 3: Tenant suspendido sin bloqueo real ────────────────
-- Antes: estado_servicio = 'suspendido' era solo informativo -- un
-- residencial suspendido por Super Admin seguia operando con
-- normalidad para su admin_residencial/guardia. Esta funcion es la
-- fuente de verdad que el middleware de la aplicacion (fuera de esta
-- migracion) usara para bloquear el acceso real.
create or replace function public.tenant_esta_suspendido(p_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select estado_servicio = 'suspendido' from public.tenants where id = p_tenant_id),
    false
  );
$$;
