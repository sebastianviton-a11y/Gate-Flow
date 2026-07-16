-- ============================================================
-- 20260713230200_packages_module.sql
-- Módulo Paquetes — específico de este dominio (02-ARCHITECTURE.md §2).
-- Ningún módulo futuro debe depender directamente de estas tablas;
-- solo de las del núcleo de plataforma (unidades, users).
-- ============================================================

-- ── 1. UBICACIONES (jerarquía auto-referenciada por tenant) ──
create table public.ubicaciones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  padre_id uuid references public.ubicaciones (id) on delete set null,
  nombre text not null,
  tipo_nodo text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_ubicaciones_tenant on public.ubicaciones (tenant_id);
create index idx_ubicaciones_tenant_padre on public.ubicaciones (tenant_id, padre_id);

-- ── 2. TAMANOS_PAQUETE (catálogo global + override por tenant) ─
create table public.tamanos_paquete (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  clave text not null,
  nombre text not null,
  color_hex text,
  orden smallint not null default 0,
  activo boolean not null default true
);
create unique index uq_tamanos_paquete_global on public.tamanos_paquete (clave) where tenant_id is null;
create unique index uq_tamanos_paquete_tenant on public.tamanos_paquete (tenant_id, clave) where tenant_id is not null;

-- ── 3. PRIORIDADES_PAQUETE (catálogo global + override por tenant) ─
create table public.prioridades_paquete (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  clave text not null,
  nombre text not null,
  color_hex text,
  orden smallint not null default 0,
  activo boolean not null default true
);
create unique index uq_prioridades_paquete_global on public.prioridades_paquete (clave) where tenant_id is null;
create unique index uq_prioridades_paquete_tenant on public.prioridades_paquete (tenant_id, clave) where tenant_id is not null;

-- ── 4. EMPRESAS_PAQUETERIA (catálogo global + propias del tenant) ─
create table public.empresas_paqueteria (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  nombre text not null,
  logo_url text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index uq_empresas_paqueteria_global on public.empresas_paqueteria (nombre) where tenant_id is null;
create unique index uq_empresas_paqueteria_tenant on public.empresas_paqueteria (tenant_id, nombre) where tenant_id is not null;

-- ── 5. ESTADOS_PAQUETE (catálogo fijo, no varía por tenant) ──
create table public.estados_paquete (
  id text primary key,
  nombre text not null,
  orden smallint not null,
  color_hex text
);

-- ── 6. RESERVAS_CODIGO_GATEFLOW (generación offline sin colisión) ─
create table public.reservas_codigo_gateflow (
  id uuid primary key default gen_random_uuid(),
  dispositivo_id text not null,
  anio integer not null,
  rango_inicio bigint not null,
  rango_fin bigint not null,
  consumido_hasta bigint not null default 0,
  asignado_en timestamptz not null default now(),
  constraint chk_rango check (rango_fin > rango_inicio),
  constraint chk_consumido check (consumido_hasta >= rango_inicio - 1 and consumido_hasta <= rango_fin)
);
create index idx_reservas_codigo_dispositivo on public.reservas_codigo_gateflow (dispositivo_id, anio);

-- ── 7. PAQUETES (tabla central) ──────────────────────────────
create table public.paquetes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  unidad_id uuid not null references public.unidades (id),
  codigo_gateflow text not null unique,
  empresa_paqueteria_id uuid references public.empresas_paqueteria (id),
  estado_id text not null default 'pendiente' references public.estados_paquete (id),
  ubicacion_id uuid references public.ubicaciones (id),
  tamano_id uuid references public.tamanos_paquete (id),
  prioridad_id uuid references public.prioridades_paquete (id),
  numero_guia text,
  descripcion text,
  cantidad integer not null default 1,
  recibido_por uuid not null references public.users (id),
  entregado_a_nombre text,
  entregado_por uuid references public.users (id),
  fecha_recepcion timestamptz not null default now(),
  fecha_entrega timestamptz,
  notas text,
  dispositivo_id text,
  creado_en_dispositivo timestamptz,
  sincronizado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_fecha_entrega check (fecha_entrega is null or fecha_entrega >= fecha_recepcion),
  -- BR-17: un paquete "recibido" (o posterior en el flujo) debe tener ubicación asignada.
  constraint chk_ubicacion_si_recibido check (
    estado_id = 'pendiente' or ubicacion_id is not null
  )
);
create index idx_paquetes_tenant_unidad on public.paquetes (tenant_id, unidad_id);
create index idx_paquetes_tenant_estado on public.paquetes (tenant_id, estado_id);
create index idx_paquetes_tenant_fecha on public.paquetes (tenant_id, fecha_recepcion desc);
create index idx_paquetes_codigo_gateflow on public.paquetes (codigo_gateflow);
create trigger trg_paquetes_updated_at before update on public.paquetes
  for each row execute function public.set_updated_at();

-- ── 8. PAQUETE_FOTOGRAFIAS ────────────────────────────────────
create table public.paquete_fotografias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  paquete_id uuid not null references public.paquetes (id) on delete cascade,
  tipo text not null check (tipo in ('recepcion', 'entrega', 'evidencia_dano')),
  storage_path text not null,
  tomada_por uuid references public.users (id),
  ocr_procesado boolean not null default false,
  ocr_datos_extraidos jsonb,
  dispositivo_id text,
  creado_en_dispositivo timestamptz,
  sincronizado_en timestamptz,
  created_at timestamptz not null default now()
);
create index idx_paquete_fotografias_paquete on public.paquete_fotografias (paquete_id);

-- ── 9. PAQUETE_FIRMAS ─────────────────────────────────────────
create table public.paquete_firmas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  paquete_id uuid not null references public.paquetes (id) on delete cascade,
  tipo text not null check (tipo in ('recepcion_guardia', 'entrega_residente')),
  firma_data text not null,
  firmante_nombre text not null,
  firmante_user_id uuid references public.users (id),
  dispositivo_id text,
  creado_en_dispositivo timestamptz,
  sincronizado_en timestamptz,
  created_at timestamptz not null default now()
);
create index idx_paquete_firmas_paquete on public.paquete_firmas (paquete_id);

-- ── 10. INCIDENCIAS ───────────────────────────────────────────
create table public.incidencias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  paquete_id uuid not null references public.paquetes (id) on delete cascade,
  tipo text not null check (
    tipo in ('danado', 'abierto', 'mojado', 'etiqueta_ilegible', 'destinatario_desconocido', 'rechazado', 'devuelto', 'extraviado')
  ),
  estado text not null default 'abierta' check (estado in ('abierta', 'en_seguimiento', 'resuelta')),
  descripcion text,
  reportada_por uuid not null references public.users (id),
  resuelta_por uuid references public.users (id),
  created_at timestamptz not null default now(),
  resuelta_en timestamptz
);
create index idx_incidencias_tenant_paquete on public.incidencias (tenant_id, paquete_id);
create index idx_incidencias_tenant_estado on public.incidencias (tenant_id, estado);

-- ── 11. INCIDENCIA_FOTOGRAFIAS ────────────────────────────────
create table public.incidencia_fotografias (
  id uuid primary key default gen_random_uuid(),
  incidencia_id uuid not null references public.incidencias (id) on delete cascade,
  storage_path text not null,
  tomada_por uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index idx_incidencia_fotografias_incidencia on public.incidencia_fotografias (incidencia_id);

-- ── 12. PAQUETE_HISTORIAL ─────────────────────────────────────
create table public.paquete_historial (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  paquete_id uuid not null references public.paquetes (id) on delete cascade,
  estado_anterior_id text references public.estados_paquete (id),
  estado_nuevo_id text not null references public.estados_paquete (id),
  user_id uuid not null references public.users (id),
  notas text,
  created_at timestamptz not null default now()
);
create index idx_paquete_historial_paquete on public.paquete_historial (paquete_id, created_at);

-- ── 13. NOTIFICACIONES ────────────────────────────────────────
create table public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  paquete_id uuid references public.paquetes (id) on delete set null,
  destinatario_user_id uuid not null references public.users (id),
  canal text not null check (canal in ('whatsapp', 'email', 'push', 'sms')),
  plantilla text,
  contenido text,
  estado_envio text not null default 'pendiente' check (
    estado_envio in ('pendiente', 'enviado', 'entregado', 'fallido', 'leido')
  ),
  proveedor_mensaje_id text,
  error_detalle text,
  created_at timestamptz not null default now(),
  enviado_at timestamptz
);
create index idx_notificaciones_tenant_destinatario on public.notificaciones (tenant_id, destinatario_user_id);
create index idx_notificaciones_paquete on public.notificaciones (paquete_id);
create index idx_notificaciones_pendientes on public.notificaciones (estado_envio) where estado_envio = 'pendiente';

-- ── 14. Trigger: registrar automáticamente en paquete_historial
--       cada vez que cambia el estado de un paquete (BR-50).
create or replace function public.fn_registrar_historial_paquete()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'UPDATE' and new.estado_id is distinct from old.estado_id) then
    insert into public.paquete_historial (tenant_id, paquete_id, estado_anterior_id, estado_nuevo_id, user_id)
    values (new.tenant_id, new.id, old.estado_id, new.estado_id, coalesce(new.entregado_por, new.recibido_por));
  elsif (tg_op = 'INSERT') then
    insert into public.paquete_historial (tenant_id, paquete_id, estado_anterior_id, estado_nuevo_id, user_id)
    values (new.tenant_id, new.id, null, new.estado_id, new.recibido_por);
  end if;
  return new;
end;
$$;

create trigger trg_paquetes_historial
  after insert or update on public.paquetes
  for each row execute function public.fn_registrar_historial_paquete();
