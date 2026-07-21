-- ============================================================
-- 20260721000000_bodega_ubicaciones.sql
-- Extiende public.ubicaciones (existe desde la migración 3, ya con
-- jerarquía vía padre_id) — NO crea una tabla storage_locations nueva.
-- paquetes.ubicacion_id ya apunta aquí; crear una segunda tabla habría
-- significado dos sistemas de ubicación paralelos para lo mismo.
-- ============================================================

alter table public.ubicaciones
  add column codigo text,
  add column descripcion text,
  add column orden integer not null default 0,
  add column updated_at timestamptz not null default now(),
  add column created_by uuid references public.users (id);

-- Código único por tenant, pero NULL permitido (código es opcional) —
-- el índice parcial excluye NULL de la restricción de unicidad.
create unique index uq_ubicaciones_tenant_codigo on public.ubicaciones (tenant_id, codigo) where codigo is not null;

create trigger trg_ubicaciones_updated_at before update on public.ubicaciones
  for each row execute function public.set_updated_at();

comment on column public.ubicaciones.tipo_nodo is
  'Tipo de nodo: zona, sector, estante, rack, nivel, casillero, area_especial, otro. Ya existía desde la migración 3 pero nunca se usaba — nunca se le construyó una interfaz de administración hasta ahora.';

-- ── Historial de cambios de ubicación ──────────────────────────
-- No se reutiliza paquete_historial: su estado_nuevo_id exige un FK a
-- estados_paquete, no puede apuntar a una ubicación. Tabla dedicada,
-- mismo espíritu (quién, cuándo, de dónde a dónde).
create table public.paquete_ubicacion_historial (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  paquete_id uuid not null references public.paquetes (id) on delete cascade,
  ubicacion_anterior_id uuid references public.ubicaciones (id),
  ubicacion_nueva_id uuid references public.ubicaciones (id),
  user_id uuid not null references public.users (id),
  created_at timestamptz not null default now()
);
create index idx_paquete_ubicacion_historial_paquete on public.paquete_ubicacion_historial (paquete_id, created_at);

alter table public.paquete_ubicacion_historial enable row level security;
create policy paquete_ubicacion_historial_read on public.paquete_ubicacion_historial
  for select using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());

-- Trigger SECURITY DEFINER desde el principio — la migración 3 original
-- de paquete_historial NO lo tenía y eso rompió el primer registro real
-- de la app (RLS bloqueaba el INSERT del trigger). Aquí no se repite:
-- el trigger escribe con sus propios permisos, no los de quien registra
-- o edita el paquete, y el cliente nunca puede insertar directo aquí
-- (no hay policy de INSERT para authenticated).
create or replace function public.fn_registrar_historial_ubicacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE' and new.ubicacion_id is distinct from old.ubicacion_id) then
    insert into public.paquete_ubicacion_historial (tenant_id, paquete_id, ubicacion_anterior_id, ubicacion_nueva_id, user_id)
    values (new.tenant_id, new.id, old.ubicacion_id, new.ubicacion_id, coalesce(new.entregado_por, new.recibido_por));
  end if;
  return new;
end;
$$;

create trigger trg_paquetes_historial_ubicacion
  after update on public.paquetes
  for each row execute function public.fn_registrar_historial_ubicacion();

-- ── Backfill: orden inicial por nombre para ubicaciones existentes ──
-- No rompe nada — solo asegura que el orden por defecto no sea "0 para
-- todas", que se vería arbitrario en la nueva pantalla de administración.
with numeradas as (
  select id, row_number() over (partition by tenant_id order by nombre) as rn
  from public.ubicaciones
)
update public.ubicaciones u
set orden = numeradas.rn
from numeradas
where u.id = numeradas.id;
