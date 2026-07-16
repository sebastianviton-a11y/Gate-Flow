-- ============================================================
-- 20260713230400_rls_policies.sql
-- Aislamiento multi-tenant real (BR-01 a BR-04, CLAUDE.md §11:
-- "RLS es la autoridad principal de aislamiento, no el código de
-- aplicación").
--
-- DECISIÓN DE IMPLEMENTACIÓN (documentada, no silenciosa):
-- 02-ARCHITECTURE.md §12 describe claims custom (tenant_id, role) en el
-- JWT vía Auth Hook. Ese Auth Hook requiere configuración manual en el
-- dashboard de Supabase (Authentication → Hooks) que no puedo ejecutar
-- de forma remota. Para que estas políticas funcionen desde el primer
-- `db push`, sin configuración adicional, se implementan aquí contra
-- `auth.uid()` (disponible siempre, sin configuración) consultando
-- `user_tenants` directamente vía funciones SECURITY DEFINER. Es
-- funcionalmente equivalente y más lento por fila que un claim en el
-- JWT — se documenta como optimización futura, no como pendiente
-- bloqueante.
-- ============================================================

-- ── Funciones helper de autorización ─────────────────────────
-- SECURITY DEFINER: evita recursión de RLS al consultar user_tenants
-- (que también tiene RLS) desde dentro de una política de otra tabla.
create or replace function public.current_tenant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id
  from public.user_tenants
  where user_id = auth.uid() and activo = true;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_tenants ut
    join public.roles r on r.id = ut.rol_id
    where ut.user_id = auth.uid() and ut.activo = true and r.clave = 'super_admin'
  );
$$;

create or replace function public.has_role(p_roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_tenants ut
    join public.roles r on r.id = ut.rol_id
    where ut.user_id = auth.uid() and ut.activo = true and r.clave = any(p_roles)
  );
$$;

-- ── USERS ─────────────────────────────────────────────────────
alter table public.users enable row level security;

create policy users_select_self_or_same_tenant on public.users
  for select using (
    id = auth.uid()
    or id in (
      select ut.user_id from public.user_tenants ut where ut.tenant_id in (select public.current_tenant_ids())
    )
    or public.is_super_admin()
  );

create policy users_update_self on public.users
  for update using (id = auth.uid());

-- ── USER_TENANTS ──────────────────────────────────────────────
alter table public.user_tenants enable row level security;

create policy user_tenants_select on public.user_tenants
  for select using (
    user_id = auth.uid()
    or tenant_id in (select public.current_tenant_ids())
    or public.is_super_admin()
  );

create policy user_tenants_write_admin on public.user_tenants
  for all using (
    public.has_role(array['admin_residencial', 'super_admin']) and tenant_id in (select public.current_tenant_ids())
  )
  with check (
    public.has_role(array['admin_residencial', 'super_admin']) and tenant_id in (select public.current_tenant_ids())
  );

-- ── TENANTS ───────────────────────────────────────────────────
alter table public.tenants enable row level security;

create policy tenants_select_member on public.tenants
  for select using (id in (select public.current_tenant_ids()) or public.is_super_admin());

create policy tenants_update_admin on public.tenants
  for update using (
    id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

-- ── Tablas con tenant_id directo: patrón estándar ────────────
-- (calles, manzanas, edificios, unidades, residentes_unidades,
--  ubicaciones, tamanos_paquete/prioridades_paquete/empresas_paqueteria
--  con tenant_id nullable para catálogo global, paquetes,
--  paquete_fotografias, paquete_firmas, paquete_historial, incidencias,
--  notificaciones, audit_log).

alter table public.calles enable row level security;
create policy calles_tenant_isolation on public.calles
  for all using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin())
  with check (tenant_id in (select public.current_tenant_ids()));

alter table public.manzanas enable row level security;
create policy manzanas_tenant_isolation on public.manzanas
  for all using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin())
  with check (tenant_id in (select public.current_tenant_ids()));

alter table public.edificios enable row level security;
create policy edificios_tenant_isolation on public.edificios
  for all using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin())
  with check (tenant_id in (select public.current_tenant_ids()));

alter table public.unidades enable row level security;
create policy unidades_tenant_isolation on public.unidades
  for all using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin())
  with check (tenant_id in (select public.current_tenant_ids()));

-- casas/departamentos no tienen tenant_id propio (extienden unidades
-- 1:1) — el aislamiento se resuelve vía join a unidades.tenant_id.
alter table public.casas enable row level security;
create policy casas_tenant_isolation on public.casas
  for all using (
    unidad_id in (select u.id from public.unidades u where u.tenant_id in (select public.current_tenant_ids()))
    or public.is_super_admin()
  )
  with check (
    unidad_id in (select u.id from public.unidades u where u.tenant_id in (select public.current_tenant_ids()))
  );

alter table public.departamentos enable row level security;
create policy departamentos_tenant_isolation on public.departamentos
  for all using (
    unidad_id in (select u.id from public.unidades u where u.tenant_id in (select public.current_tenant_ids()))
    or public.is_super_admin()
  )
  with check (
    unidad_id in (select u.id from public.unidades u where u.tenant_id in (select public.current_tenant_ids()))
  );

alter table public.residentes_unidades enable row level security;
create policy residentes_unidades_tenant_isolation on public.residentes_unidades
  for all using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin())
  with check (tenant_id in (select public.current_tenant_ids()));

alter table public.ubicaciones enable row level security;
create policy ubicaciones_tenant_isolation on public.ubicaciones
  for all using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin())
  with check (tenant_id in (select public.current_tenant_ids()));

-- Catálogos con tenant_id NULLABLE: NULL = global, visible para todos;
-- no-NULL = propio del tenant, visible solo para ese tenant.
alter table public.tamanos_paquete enable row level security;
create policy tamanos_paquete_read on public.tamanos_paquete
  for select using (tenant_id is null or tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());
create policy tamanos_paquete_write_admin on public.tamanos_paquete
  for insert with check (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );
create policy tamanos_paquete_update_admin on public.tamanos_paquete
  for update using (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

alter table public.prioridades_paquete enable row level security;
create policy prioridades_paquete_read on public.prioridades_paquete
  for select using (tenant_id is null or tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());
create policy prioridades_paquete_write_admin on public.prioridades_paquete
  for insert with check (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );
create policy prioridades_paquete_update_admin on public.prioridades_paquete
  for update using (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

alter table public.empresas_paqueteria enable row level security;
create policy empresas_paqueteria_read on public.empresas_paqueteria
  for select using (tenant_id is null or tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());
create policy empresas_paqueteria_write_admin on public.empresas_paqueteria
  for insert with check (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

-- Catálogo global fijo, sin tenant_id: legible por cualquier usuario autenticado.
alter table public.estados_paquete enable row level security;
create policy estados_paquete_read_authenticated on public.estados_paquete
  for select using (auth.role() = 'authenticated');

-- ── PAQUETES y tablas dependientes ────────────────────────────
alter table public.paquetes enable row level security;
create policy paquetes_tenant_isolation on public.paquetes
  for all using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin())
  with check (tenant_id in (select public.current_tenant_ids()));

alter table public.paquete_fotografias enable row level security;
create policy paquete_fotografias_tenant_isolation on public.paquete_fotografias
  for all using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin())
  with check (tenant_id in (select public.current_tenant_ids()));

alter table public.paquete_firmas enable row level security;
create policy paquete_firmas_tenant_isolation on public.paquete_firmas
  for all using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin())
  with check (tenant_id in (select public.current_tenant_ids()));

alter table public.paquete_historial enable row level security;
create policy paquete_historial_tenant_isolation on public.paquete_historial
  for select using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());
-- BR-51: el historial/auditoría es de solo lectura para todos los roles
-- vía API — la escritura ocurre únicamente por el trigger (security
-- definer implícito del owner de la tabla), nunca por el cliente.

alter table public.incidencias enable row level security;
create policy incidencias_tenant_isolation on public.incidencias
  for all using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin())
  with check (tenant_id in (select public.current_tenant_ids()));

alter table public.incidencia_fotografias enable row level security;
create policy incidencia_fotografias_via_incidencia on public.incidencia_fotografias
  for all using (
    incidencia_id in (
      select i.id from public.incidencias i where i.tenant_id in (select public.current_tenant_ids())
    )
    or public.is_super_admin()
  );

alter table public.notificaciones enable row level security;
create policy notificaciones_tenant_isolation on public.notificaciones
  for select using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());

-- ── AUDIT_LOG: solo lectura, nunca escritura ni edición vía API ──
alter table public.audit_log enable row level security;
create policy audit_log_read_admin on public.audit_log
  for select using (
    (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']))
    or public.is_super_admin()
  );
-- Deliberadamente sin policy de insert/update/delete para el rol
-- `authenticated`: la escritura de auditoría ocurre solo vía funciones
-- SECURITY DEFINER invocadas desde Edge Functions con la service_role,
-- nunca directo desde el cliente (BR-51).

-- ── ROLES y PERMISOS: catálogos globales, solo lectura para todos ──
alter table public.roles enable row level security;
create policy roles_read_authenticated on public.roles
  for select using (auth.role() = 'authenticated');

alter table public.permisos enable row level security;
create policy permisos_read_authenticated on public.permisos
  for select using (auth.role() = 'authenticated');

alter table public.rol_permisos enable row level security;
create policy rol_permisos_read_authenticated on public.rol_permisos
  for select using (auth.role() = 'authenticated');

-- ── RESERVAS_CODIGO_GATEFLOW: sin acceso directo de cliente ──
-- RLS habilitado sin ninguna policy para `authenticated`/`anon` = acceso
-- denegado por defecto para cualquier usuario normal. Solo `service_role`
-- (que en Supabase bypassa RLS) puede leer/escribir esta tabla, y eso
-- ocurre exclusivamente desde la Edge Function que asigna bloques de
-- código al iniciar turno (02-ARCHITECTURE.md §8) — nunca desde el
-- cliente directamente.
alter table public.reservas_codigo_gateflow enable row level security;
