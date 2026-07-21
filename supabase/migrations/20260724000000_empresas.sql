-- ============================================================
-- 20260724000000_empresas.sql
--
-- Agrega una capa de "Empresa" por ENCIMA de tenants (residenciales),
-- sin renombrar ni reestructurar tenants — decisión deliberada, no un
-- atajo. Renombrar tenants habría tocado decenas de archivos (cada
-- .from("tenants"), cada tenant_id, current_tenant_ids(), cada policy
-- de RLS) por un cambio que la propia especificación pide sin impacto
-- visible. Agregar una tabla nueva arriba, con una columna nueva en
-- tenants, deja cero líneas de código existente rotas.
--
-- Jerarquía resultante:
--   empresas
--     -- tenants (residenciales) -- vía tenants.empresa_id
--         -- user_tenants / paquetes / unidades / ... (sin cambios)
-- ============================================================

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  razon_social text,
  rfc text,
  correo_principal text,
  telefono text,
  direccion text,
  ciudad text,
  estado_geografico text,
  pais text not null default 'MX',
  configuracion jsonb not null default '{}',
  plan text not null default 'piloto',
  estado_servicio text not null default 'piloto'
    check (estado_servicio in ('piloto', 'activo', 'suspendido', 'cancelado')),
  plan_fecha_renovacion date,
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_empresas_estado on public.empresas (estado_servicio);

create trigger trg_empresas_updated_at before update on public.empresas
  for each row execute function public.set_updated_at();

-- ── Vincular tenants a empresas ──────────────────────────────
alter table public.tenants add column empresa_id uuid references public.empresas (id);

-- ── Backfill: una empresa nueva por cada residencial existente, ──
-- mismo nombre, sin perder ningún dato.
do $$
declare
  v_tenant record;
  v_nueva_empresa_id uuid;
begin
  for v_tenant in select id, nombre, direccion, ciudad, estado_geografico, pais from public.tenants where empresa_id is null loop
    insert into public.empresas (nombre, direccion, ciudad, estado_geografico, pais, estado_servicio)
    values (v_tenant.nombre, v_tenant.direccion, v_tenant.ciudad, v_tenant.estado_geografico, v_tenant.pais, 'activo')
    returning id into v_nueva_empresa_id;

    update public.tenants set empresa_id = v_nueva_empresa_id where id = v_tenant.id;
  end loop;
end $$;

alter table public.tenants alter column empresa_id set not null;

create index idx_tenants_empresa on public.tenants (empresa_id);

-- ── RLS de empresas ───────────────────────────────────────────
alter table public.empresas enable row level security;

create policy empresas_select on public.empresas
  for select using (
    id in (select t.empresa_id from public.tenants t where t.id in (select public.current_tenant_ids()))
    or public.is_super_admin()
  );

create policy empresas_insert_super_admin on public.empresas
  for insert with check (public.is_super_admin());

create policy empresas_update_super_admin on public.empresas
  for update using (public.is_super_admin());

create policy empresas_delete_super_admin on public.empresas
  for delete using (public.is_super_admin());

-- ── Helper simétrico a current_tenant_ids() ──────────────────
create or replace function public.current_empresa_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select distinct t.empresa_id
  from public.user_tenants ut
  join public.tenants t on t.id = ut.tenant_id
  where ut.user_id = auth.uid() and ut.activo = true;
$$;

-- ── Catálogo de roles futuros ─────────────────────────────────
do $$
declare
  v_nombre_restriccion text;
begin
  select con.conname into v_nombre_restriccion
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'roles' and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%clave%';

  if v_nombre_restriccion is not null then
    execute format('alter table public.roles drop constraint %I', v_nombre_restriccion);
  end if;

  alter table public.roles add constraint roles_clave_check
    check (clave in ('super_admin', 'admin_empresa', 'admin_residencial', 'supervisor', 'guardia', 'recepcion', 'residente'));
end $$;

insert into public.roles (clave, nombre, descripcion) values
  ('admin_empresa', 'Administrador de Empresa', 'Ve y administra todos los residenciales de su empresa - rol preparado, sin pantallas propias todavia'),
  ('supervisor', 'Supervisor', 'Rol preparado para supervision operativa entre varios residenciales - sin pantallas propias todavia'),
  ('recepcion', 'Recepcion', 'Rol preparado, funcionalmente equivalente a guardia hasta definir diferencias - sin pantallas propias todavia')
on conflict (clave) do nothing;
