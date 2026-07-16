-- ============================================================
-- 20260714000000_paquetes_sprint02.sql
-- Completa el modelo de `paquetes` para el flujo end-to-end de Sprint 02.
-- No renombra ninguna columna ya aprobada (fecha_recepcion, recibido_por,
-- fecha_entrega, entregado_por, tamano_id, prioridad_id, estado_id) —
-- ver SPRINT_02_DELIVERY.md para el mapeo explícito contra los nombres
-- solicitados (received_at, delivered_by, etc.) y la razón de no renombrar.
-- ============================================================

-- ── 1. Campos nuevos en PAQUETES ─────────────────────────────
alter table public.paquetes
  add column residente_id uuid references public.users (id),
  add column remitente text;

create index idx_paquetes_residente on public.paquetes (residente_id);

comment on column public.paquetes.residente_id is
  'Residente específico destinatario del paquete (opcional). Distinto de unidad_id: una unidad puede tener varios residentes; esto permite precisar a cuál va dirigido cuando se conoce.';
comment on column public.paquetes.remitente is
  'Nombre de quien envía el paquete (persona), distinto de empresa_paqueteria_id (el courier que lo transporta).';

-- Defensa en profundidad: si se asigna residente_id, debe pertenecer al
-- mismo tenant que el paquete (vía residentes_unidades). No sustituye a
-- RLS, la complementa a nivel de integridad de datos.
create or replace function public.fn_validar_residente_mismo_tenant()
returns trigger
language plpgsql
as $$
begin
  if new.residente_id is not null then
    if not exists (
      select 1 from public.residentes_unidades ru
      where ru.user_id = new.residente_id and ru.tenant_id = new.tenant_id
    ) then
      raise exception 'residente_id % no pertenece al tenant % del paquete', new.residente_id, new.tenant_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_paquetes_validar_residente
  before insert or update of residente_id on public.paquetes
  for each row execute function public.fn_validar_residente_mismo_tenant();

-- ── 2. Generación de código GateFlow segura frente a concurrencia ──
-- Sustituye, para esta fase (guard todavía no escribe offline — ver
-- Sprint 1.5 §6), el mecanismo de bloques reservados por dispositivo
-- (reservas_codigo_gateflow, migración 20260713230200) por uno más
-- simple: una secuencia de Postgres, atómica por diseño bajo concurrencia,
-- sin necesitar que el frontend calcule ni reserve nada. La tabla de
-- reservas NO se elimina — sigue siendo el mecanismo correcto para cuando
-- exista escritura offline real (Sprint 03+); ambos pueden coexistir.
create sequence if not exists public.codigo_gateflow_seq start 1;

create or replace function public.generar_codigo_gateflow()
returns text
language sql
as $$
  select 'GF-' || extract(year from now())::text || '-' || lpad(nextval('public.codigo_gateflow_seq')::text, 7, '0');
$$;

alter table public.paquetes
  alter column codigo_gateflow set default public.generar_codigo_gateflow();

-- ── 3. Entrega atómica — impide entregar dos veces (BR-14) a nivel de BD ──
-- No confía en que el frontend verifique el estado antes de actualizar:
-- usa SELECT ... FOR UPDATE para serializar intentos concurrentes sobre
-- el mismo paquete, y falla explícitamente si ya estaba entregado.
create or replace function public.entregar_paquete(
  p_paquete_id uuid,
  p_entregado_por uuid,
  p_entregado_a_nombre text
)
returns public.paquetes
language plpgsql
security invoker
as $$
declare
  v_paquete public.paquetes;
begin
  select * into v_paquete from public.paquetes where id = p_paquete_id for update;

  if not found then
    raise exception 'Paquete % no existe', p_paquete_id;
  end if;

  if v_paquete.estado_id = 'entregado' then
    raise exception 'El paquete % ya fue entregado el %', v_paquete.codigo_gateflow, v_paquete.fecha_entrega
      using errcode = 'P0001';
  end if;

  -- Autoriza, solo dentro de esta transacción, el UPDATE de los campos
  -- de entrega que fn_proteger_campos_paquete() bloquea por defecto.
  perform set_config('app.allow_delivery_update', 'true', true);

  update public.paquetes
  set
    estado_id = 'entregado',
    entregado_por = p_entregado_por,
    entregado_a_nombre = p_entregado_a_nombre,
    fecha_entrega = now()
  where id = p_paquete_id
  returning * into v_paquete;

  return v_paquete;
end;
$$;

-- security invoker (no definer): se ejecuta con los permisos del usuario
-- que llama, así que sigue pasando por RLS de `paquetes` — un guardia no
-- puede entregar un paquete de otro tenant llamando a esta función.

-- ── 4. Vista de dashboard EN VIVO (no materializada) ──────────
-- Las vistas materializadas de la migración 20260713230300 siguen siendo
-- correctas para el histórico de 30 días (donde un poco de staleness es
-- aceptable), pero requieren refrescar manualmente. Para las tarjetas de
-- "hoy" del dashboard, una vista normal (siempre fresca, sin
-- infraestructura de refresco) es la opción correcta a esta escala —
-- evita depender de que alguien programe el refresh antes de que el
-- dashboard tenga datos correctos.
-- ADVERTENCIA DE SEGURIDAD CORREGIDA EN ESTA MISMA MIGRACIÓN: una vista de
-- Postgres NO hereda RLS del usuario que consulta por defecto — se ejecuta
-- con los permisos de su DUEÑO (en Supabase, típicamente el rol `postgres`,
-- que tiene BYPASSRLS). Sin `security_invoker = true` (Postgres 15+,
-- disponible en Supabase), estas tres vistas habrían expuesto datos de
-- TODOS los tenants a cualquier usuario autenticado — el error más grave
-- posible en un sistema multi-tenant. Se declara explícitamente en las
-- tres vistas siguientes.
create or replace view public.v_dashboard_resumen
with (security_invoker = true) as
select
  p.tenant_id,
  count(*) filter (where p.estado_id in ('recibido', 'notificado')) as pendientes,
  count(*) filter (where p.estado_id = 'recibido' and p.fecha_recepcion::date = current_date) as recibidos_hoy,
  count(*) filter (where p.estado_id = 'entregado' and p.fecha_entrega::date = current_date) as entregados_hoy,
  count(*) filter (
    where p.estado_id in ('recibido', 'notificado') and p.fecha_recepcion < now() - interval '5 days'
  ) as olvidados
from public.paquetes p
group by p.tenant_id;

create or replace view public.v_dashboard_por_prioridad
with (security_invoker = true) as
select p.tenant_id, pr.nombre as prioridad, pr.color_hex, count(*) as total
from public.paquetes p
join public.prioridades_paquete pr on pr.id = p.prioridad_id
where p.estado_id in ('recibido', 'notificado')
group by p.tenant_id, pr.nombre, pr.color_hex;

create or replace view public.v_dashboard_por_ubicacion
with (security_invoker = true) as
select p.tenant_id, u.nombre as ubicacion, count(*) as total
from public.paquetes p
join public.ubicaciones u on u.id = p.ubicacion_id
where p.estado_id in ('recibido', 'notificado')
group by p.tenant_id, u.nombre;

-- ── 5. Protección de campos no editables ──────────────────────
-- tenant_id, codigo_gateflow y fecha_recepcion nunca cambian, por
-- ningún camino, una vez creado el paquete. entregado_por/fecha_entrega/
-- entregado_a_nombre solo cambian a través de entregar_paquete() — un
-- UPDATE directo del cliente sobre esos campos también se rechaza.
create or replace function public.fn_proteger_campos_paquete()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id no puede modificarse';
  end if;
  if new.codigo_gateflow is distinct from old.codigo_gateflow then
    raise exception 'codigo_gateflow no puede modificarse';
  end if;
  if new.fecha_recepcion is distinct from old.fecha_recepcion then
    raise exception 'fecha_recepcion no puede modificarse';
  end if;

  -- Excepción controlada: entregar_paquete() marca esta variable de
  -- sesión antes de su propio UPDATE. Cualquier otro camino que intente
  -- tocar estos tres campos se rechaza.
  if coalesce(current_setting('app.allow_delivery_update', true), 'false') <> 'true' then
    if new.entregado_por is distinct from old.entregado_por
      or new.fecha_entrega is distinct from old.fecha_entrega
      or new.entregado_a_nombre is distinct from old.entregado_a_nombre then
      raise exception 'entregado_por/fecha_entrega/entregado_a_nombre solo pueden cambiar vía entregar_paquete()';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_paquetes_proteger_campos
  before update on public.paquetes
  for each row execute function public.fn_proteger_campos_paquete();

-- ── 6. Registro de auditoría desde el cliente autenticado ────
-- audit_log deliberadamente no tiene policy de INSERT para `authenticated`
-- (BR-51: la escritura de auditoría no debe depender de que el cliente
-- "decida" auditarse a sí mismo sin control). Esta función SECURITY
-- DEFINER es la única puerta: solo permite registrar una acción atribuida
-- al usuario que la invoca (auth.uid()), sobre un tenant al que
-- efectivamente pertenece — no se puede falsificar el autor ni el tenant.
create or replace function public.registrar_auditoria(
  p_tenant_id uuid,
  p_accion text,
  p_entidad text,
  p_entidad_id uuid,
  p_datos_anteriores jsonb,
  p_datos_nuevos jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.user_tenants
    where user_id = auth.uid() and tenant_id = p_tenant_id and activo = true
  ) then
    raise exception 'El usuario no pertenece al tenant % — no se puede registrar la auditoría', p_tenant_id;
  end if;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
  values (p_tenant_id, auth.uid(), p_accion, p_entidad, p_entidad_id, p_datos_anteriores, p_datos_nuevos);
end;
$$;
