-- ============================================================
-- 20260714010000_dashboard_promedio_entrega.sql
-- Sprint 03: el dashboard ejecutivo pide "promedio de entrega" como
-- métrica explícita — se agrega a la vista en vivo (no a la
-- materializada de 30 días), para que sea siempre fresca sin depender
-- de un refresh manual.
-- ============================================================

create or replace view public.v_dashboard_resumen
with (security_invoker = true) as
select
  p.tenant_id,
  count(*) filter (where p.estado_id in ('recibido', 'notificado')) as pendientes,
  count(*) filter (where p.estado_id = 'recibido' and p.fecha_recepcion::date = current_date) as recibidos_hoy,
  count(*) filter (where p.estado_id = 'entregado' and p.fecha_entrega::date = current_date) as entregados_hoy,
  count(*) filter (
    where p.estado_id in ('recibido', 'notificado') and p.fecha_recepcion < now() - interval '5 days'
  ) as olvidados,
  round(
    avg(extract(epoch from (p.fecha_entrega - p.fecha_recepcion)) / 3600.0)
      filter (where p.fecha_entrega is not null and p.fecha_entrega > now() - interval '30 days'),
    1
  ) as horas_promedio_entrega_30d
from public.paquetes p
group by p.tenant_id;

-- security_invoker = true se repite explícitamente (no se omite "porque
-- ya estaba" en la versión anterior) — regla D007 / SECURITY_ARCHITECTURE.md §3.
