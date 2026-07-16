-- ============================================================
-- 20260713230100_core_platform.sql
-- Núcleo de plataforma — compartido por todos los módulos presentes
-- y futuros (02-ARCHITECTURE.md §2). Fuente: 03-DATABASE.md.
-- ============================================================

-- ── 1. TENANTS ────────────────────────────────────────────────
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null check (tipo in ('residencial', 'condominio', 'urbanizacion')),
  direccion text,
  ciudad text,
  estado_geografico text,
  pais text not null default 'MX',
  timezone text not null default 'America/Cancun',
  plan text not null default 'trial' check (plan in ('trial', 'basico', 'pro', 'enterprise')),
  activo boolean not null default true,
  configuracion jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_tenants_activo on public.tenants (activo);
create trigger trg_tenants_updated_at before update on public.tenants
  for each row execute function public.set_updated_at();

-- ── 2. ROLES ──────────────────────────────────────────────────
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique check (clave in ('super_admin', 'admin_residencial', 'guardia', 'residente')),
  nombre text not null,
  descripcion text
);

-- ── 3. PERMISOS ───────────────────────────────────────────────
create table public.permisos (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  modulo text not null,
  descripcion text
);

-- ── 4. ROL_PERMISOS ───────────────────────────────────────────
create table public.rol_permisos (
  rol_id uuid not null references public.roles (id) on delete cascade,
  permiso_id uuid not null references public.permisos (id) on delete cascade,
  primary key (rol_id, permiso_id)
);

-- ── 5. USERS (perfil extendido de auth.users) ────────────────
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre_completo text not null,
  telefono text unique,
  email text unique,
  avatar_url text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- ── 6. USER_TENANTS (pertenencia + rol por tenant) ───────────
create table public.user_tenants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  rol_id uuid not null references public.roles (id),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id)
);
create index idx_user_tenants_tenant on public.user_tenants (tenant_id);
create index idx_user_tenants_user on public.user_tenants (user_id);

-- ── 7. CALLES ─────────────────────────────────────────────────
create table public.calles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, nombre)
);
create index idx_calles_tenant on public.calles (tenant_id);

-- ── 8. MANZANAS ───────────────────────────────────────────────
create table public.manzanas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  calle_id uuid references public.calles (id) on delete set null,
  numero text not null,
  created_at timestamptz not null default now()
);
create index idx_manzanas_tenant on public.manzanas (tenant_id);

-- ── 9. EDIFICIOS ──────────────────────────────────────────────
create table public.edificios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  nombre text not null,
  direccion_referencia text,
  created_at timestamptz not null default now(),
  unique (tenant_id, nombre)
);
create index idx_edificios_tenant on public.edificios (tenant_id);

-- ── 10. UNIDADES (tabla padre de casas/departamentos) ────────
create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  tipo text not null check (tipo in ('casa', 'departamento')),
  identificador text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, identificador)
);
create index idx_unidades_tenant_tipo on public.unidades (tenant_id, tipo);
create trigger trg_unidades_updated_at before update on public.unidades
  for each row execute function public.set_updated_at();

-- ── 11. CASAS ─────────────────────────────────────────────────
create table public.casas (
  unidad_id uuid primary key references public.unidades (id) on delete cascade,
  calle_id uuid references public.calles (id) on delete set null,
  manzana_id uuid references public.manzanas (id) on delete set null,
  numero text not null,
  lote text,
  metros_terreno numeric,
  constraint chk_casa_ubicada check (calle_id is not null or manzana_id is not null)
);

-- ── 12. DEPARTAMENTOS ─────────────────────────────────────────
create table public.departamentos (
  unidad_id uuid primary key references public.unidades (id) on delete cascade,
  edificio_id uuid not null references public.edificios (id) on delete cascade,
  piso integer,
  numero text not null,
  unique (edificio_id, numero)
);

-- ── 13. RESIDENTES_UNIDADES ───────────────────────────────────
create table public.residentes_unidades (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  unidad_id uuid not null references public.unidades (id) on delete cascade,
  tipo_relacion text not null check (tipo_relacion in ('propietario', 'inquilino', 'familiar', 'autorizado')),
  fecha_inicio date not null default current_date,
  fecha_fin date,
  created_at timestamptz not null default now(),
  constraint chk_vigencia check (fecha_fin is null or fecha_fin >= fecha_inicio)
);
create index idx_residentes_unidades_tenant_unidad on public.residentes_unidades (tenant_id, unidad_id);
create index idx_residentes_unidades_user on public.residentes_unidades (user_id);

-- ── 14. AUDIT_LOG ─────────────────────────────────────────────
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  user_id uuid references public.users (id),
  accion text not null,
  entidad text not null,
  entidad_id uuid,
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index idx_audit_log_tenant_fecha on public.audit_log (tenant_id, created_at desc);
create index idx_audit_log_entidad on public.audit_log (entidad, entidad_id);
