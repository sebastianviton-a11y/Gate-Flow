-- ============================================================
-- 20260713230300_search_and_dashboard.sql
-- Búsqueda universal (03-DATABASE.md §5) y capa de agregación
-- pre-calculada para el dashboard ejecutivo (03-DATABASE.md §7).
-- ============================================================

-- ── 1. BÚSQUEDA UNIVERSAL ─────────────────────────────────────
-- Columna de vector de búsqueda sobre paquetes, mantenida por trigger
-- (no generated column, porque combina datos de tablas relacionadas:
-- unidad y residentes de esa unidad).
alter table public.paquetes add column search_vector tsvector;

create index idx_paquetes_search on public.paquetes using gin (search_vector);

create or replace function public.fn_actualizar_search_vector_paquete()
returns trigger
language plpgsql
as $$
declare
  v_identificador_unidad text;
  v_residentes text;
begin
  select u.identificador into v_identificador_unidad
  from public.unidades u
  where u.id = new.unidad_id;

  select string_agg(coalesce(usr.nombre_completo, '') || ' ' || coalesce(usr.telefono, ''), ' ')
  into v_residentes
  from public.residentes_unidades ru
  join public.users usr on usr.id = ru.user_id
  where ru.unidad_id = new.unidad_id
    and (ru.fecha_fin is null or ru.fecha_fin >= current_date);

  new.search_vector :=
    setweight(to_tsvector('spanish', coalesce(new.codigo_gateflow, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(new.numero_guia, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(v_identificador_unidad, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(new.entregado_a_nombre, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(v_residentes, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(new.descripcion, '')), 'C');

  return new;
end;
$$;

create trigger trg_paquetes_search_vector
  before insert or update on public.paquetes
  for each row execute function public.fn_actualizar_search_vector_paquete();

-- Limitación documentada: si cambia el nombre/teléfono de un residente
-- DESPUÉS de que un paquete ya fue indexado, ese paquete no se reindexa
-- automáticamente (evita triggers en cascada sobre residentes_unidades/
-- users, que serían sobre-ingeniería para el volumen esperado de un
-- residencial). Esta función permite reindexar manualmente cuando haga
-- falta (ej. tras una importación masiva de residentes).
create or replace function public.refrescar_search_vectors(p_tenant_id uuid default null)
returns void
language plpgsql
as $$
begin
  update public.paquetes
  set updated_at = updated_at -- fuerza el trigger sin cambiar datos visibles
  where (p_tenant_id is null or tenant_id = p_tenant_id);
end;
$$;

-- ── 2. DASHBOARD — agregación pre-calculada ──────────────────
-- Se lee desde aquí en el dashboard, nunca desde `paquetes` directamente
-- (03-DATABASE.md §7): evita que el historial de un tenant grande
-- vuelva lento el dashboard de otro.
create materialized view public.mv_dashboard_diario as
select
  p.tenant_id,
  date_trunc('day', p.fecha_recepcion)::date as fecha,
  count(*) filter (where p.estado_id = 'recibido' or p.estado_id = 'notificado') as pendientes,
  count(*) filter (where p.estado_id = 'entregado') as entregados,
  count(*) as recibidos_total,
  avg(extract(epoch from (p.fecha_entrega - p.fecha_recepcion)) / 3600.0)
    filter (where p.fecha_entrega is not null) as horas_promedio_entrega,
  count(*) filter (
    where p.estado_id in ('recibido', 'notificado')
      and p.fecha_recepcion < now() - interval '5 days'
  ) as olvidados
from public.paquetes p
group by p.tenant_id, date_trunc('day', p.fecha_recepcion);

create unique index uq_mv_dashboard_diario on public.mv_dashboard_diario (tenant_id, fecha);

create materialized view public.mv_dashboard_top_empresas as
select
  p.tenant_id,
  ep.nombre as empresa,
  count(*) as total_paquetes
from public.paquetes p
join public.empresas_paqueteria ep on ep.id = p.empresa_paqueteria_id
group by p.tenant_id, ep.nombre;

create index idx_mv_dashboard_top_empresas_tenant on public.mv_dashboard_top_empresas (tenant_id);
-- REFRESH ... CONCURRENTLY exige un índice único sobre la vista materializada.
create unique index uq_mv_dashboard_top_empresas on public.mv_dashboard_top_empresas (tenant_id, empresa);

-- Refresco manual/programado (invocar desde una Edge Function con cron,
-- ej. cada 5 minutos — 02-ARCHITECTURE.md §10). No se agenda pg_cron
-- aquí porque su disponibilidad depende del plan de Supabase del
-- proyecto; se deja como paso de configuración manual documentado en
-- supabase/README.md.
create or replace function public.refrescar_dashboard()
returns void
language plpgsql
security definer
as $$
begin
  refresh materialized view concurrently public.mv_dashboard_diario;
  refresh materialized view concurrently public.mv_dashboard_top_empresas;
end;
$$;
