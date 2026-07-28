-- ============================================================
-- 20260728000000_grupos_entrega.sql
--
-- Sistema de agrupacion de paquetes por unidad/residente (Fase 1):
-- tabla nueva, columna en paquetes, RLS, y las funciones de
-- servidor que la Fase 1 del frontend necesita (obtener-o-crear
-- grupo, crear grupo separado, entrega parcial agrupada).
--
-- Diseno clave, verificado contra el esquema real antes de escribir
-- esto (no supuesto):
-- - paquetes.residente_id ya existe y apunta a auth.users (no a
--   residentes_unidades) - un paquete puede estar ligado a la cuenta
--   real de un residente, cuando existe.
-- - residentes_unidades ya existe (user_id + unidad_id + tipo_relacion
--   + fecha_inicio/fecha_fin) pero paquetes NO se relaciona con ella
--   directamente.
-- - La clave de agrupacion PRINCIPAL es unidad_id (siempre presente
--   en todo paquete) - residente_id se guarda en el grupo solo como
--   dato adicional cuando se conoce, nunca como clave excluyente,
--   porque en la practica muchos paquetes se registran sin residente
--   ligado (BR-17 solo exige ubicacion, no residente).
-- ============================================================

create table public.paquete_grupos_entrega (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  unidad_id uuid not null references public.unidades (id) on delete cascade,
  residente_id uuid references auth.users (id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'parcial', 'completado', 'cancelado')),
  codigo_grupo text unique,
  token text not null unique,
  token_created_at timestamptz not null default now(),
  cantidad_total integer not null default 0,
  cantidad_entregada integer not null default 0,
  whatsapp_enviado boolean not null default false,
  whatsapp_enviado_en timestamptz,
  entregado_por uuid references auth.users (id),
  firmante_nombre text,
  fecha_entrega timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_grupos_entrega_tenant_unidad_estado on public.paquete_grupos_entrega (tenant_id, unidad_id, estado);
create index idx_grupos_entrega_token on public.paquete_grupos_entrega (token);

alter table public.paquetes add column grupo_entrega_id uuid references public.paquete_grupos_entrega (id) on delete set null;
create index idx_paquetes_grupo_entrega on public.paquetes (grupo_entrega_id);

-- codigo legible del grupo (distinto del token seguro del QR). El
-- token va en el QR/URL (aleatorio, no adivinable). codigo_grupo es
-- solo el texto human-friendly que se le muestra al residente en el
-- WhatsApp ("Codigo de retiro: RETIRO-000123") - nunca se usa para
-- autenticar nada, por eso puede ser secuencial sin ningun riesgo.
create sequence if not exists public.paquete_grupos_entrega_codigo_seq;

create or replace function public.fn_asignar_codigo_grupo()
returns trigger
language plpgsql
as $$
begin
  if new.codigo_grupo is null then
    new.codigo_grupo := 'RETIRO-' || lpad(nextval('public.paquete_grupos_entrega_codigo_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger trg_asignar_codigo_grupo
  before insert on public.paquete_grupos_entrega
  for each row execute function public.fn_asignar_codigo_grupo();

-- RLS: mismo patron exacto ya usado en paquetes/ubicaciones.
alter table public.paquete_grupos_entrega enable row level security;

create policy grupos_entrega_select on public.paquete_grupos_entrega
  for select using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());

create policy grupos_entrega_insert on public.paquete_grupos_entrega
  for insert with check (tenant_id in (select public.current_tenant_ids()));

create policy grupos_entrega_update on public.paquete_grupos_entrega
  for update using (
    tenant_id in (select public.current_tenant_ids())
    and (public.has_role(array['admin_residencial', 'super_admin']) or estado <> 'completado')
  )
  with check (tenant_id in (select public.current_tenant_ids()));

create policy grupos_entrega_delete_admin on public.paquete_grupos_entrega
  for delete using (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

-- Buscar un grupo abierto (pendiente/parcial) para una unidad.
create or replace function public.buscar_grupo_abierto(p_tenant_id uuid, p_unidad_id uuid)
returns uuid
language sql
security invoker
stable
set search_path = public
as $$
  select id from public.paquete_grupos_entrega
  where tenant_id = p_tenant_id and unidad_id = p_unidad_id and estado in ('pendiente', 'parcial')
  order by created_at desc
  limit 1;
$$;

-- Obtener el grupo abierto de una unidad, o crear uno nuevo. Usada
-- cuando el guardia elige "Agregar al grupo existente".
create or replace function public.obtener_o_crear_grupo_entrega(
  p_tenant_id uuid,
  p_unidad_id uuid,
  p_residente_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_grupo_id uuid;
begin
  v_grupo_id := public.buscar_grupo_abierto(p_tenant_id, p_unidad_id);

  if v_grupo_id is not null then
    if p_residente_id is not null then
      update public.paquete_grupos_entrega
      set residente_id = p_residente_id
      where id = v_grupo_id and residente_id is null;
    end if;
    return v_grupo_id;
  end if;

  insert into public.paquete_grupos_entrega (tenant_id, unidad_id, residente_id, token)
  values (p_tenant_id, p_unidad_id, p_residente_id, encode(gen_random_bytes(24), 'hex'))
  returning id into v_grupo_id;

  return v_grupo_id;
end;
$$;

-- Crear un grupo NUEVO a proposito, aunque ya exista uno abierto.
-- Usada cuando el guardia elige "Crear un grupo separado".
create or replace function public.crear_grupo_entrega_separado(
  p_tenant_id uuid,
  p_unidad_id uuid,
  p_residente_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_grupo_id uuid;
begin
  insert into public.paquete_grupos_entrega (tenant_id, unidad_id, residente_id, token)
  values (p_tenant_id, p_unidad_id, p_residente_id, encode(gen_random_bytes(24), 'hex'))
  returning id into v_grupo_id;

  return v_grupo_id;
end;
$$;

-- Recalcular cantidad_total/cantidad_entregada de un grupo.
create or replace function public.recalcular_grupo_entrega(p_grupo_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total integer;
  v_entregados integer;
begin
  select count(*), count(*) filter (where estado_id = 'entregado')
  into v_total, v_entregados
  from public.paquetes
  where grupo_entrega_id = p_grupo_id;

  update public.paquete_grupos_entrega
  set
    cantidad_total = v_total,
    cantidad_entregada = v_entregados,
    estado = case
      when v_total = 0 then estado
      when v_entregados = 0 then 'pendiente'
      when v_entregados < v_total then 'parcial'
      else 'completado'
    end,
    fecha_entrega = case when v_total > 0 and v_entregados = v_total then now() else fecha_entrega end,
    updated_at = now()
  where id = p_grupo_id;
end;
$$;

-- Entrega agrupada (total o parcial) - reutiliza entregar_paquete().
-- No reimplementa la logica de entrega individual (proteccion de
-- campos, historial, etc.) - llama a la funcion que YA existe para
-- cada paquete_id, uno por uno, y al final recalcula el estado del
-- grupo. Los paquetes no incluidos en p_paquete_ids permanecen
-- pendientes, sin tocarse.
create or replace function public.entregar_grupo_paquetes(
  p_grupo_id uuid,
  p_paquete_ids uuid[],
  p_entregado_por uuid,
  p_entregado_a_nombre text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_paquete_id uuid;
  v_existe boolean;
begin
  select true into v_existe from public.paquete_grupos_entrega where id = p_grupo_id;
  if v_existe is null then
    raise exception 'Grupo de entrega no encontrado.';
  end if;

  foreach v_paquete_id in array p_paquete_ids loop
    perform public.entregar_paquete(v_paquete_id, p_entregado_por, p_entregado_a_nombre);
  end loop;

  update public.paquete_grupos_entrega
  set entregado_por = p_entregado_por, firmante_nombre = p_entregado_a_nombre
  where id = p_grupo_id;

  perform public.recalcular_grupo_entrega(p_grupo_id);
end;
$$;
