-- ============================================================
-- Rollback de 20260729200000_reconciliacion_paridad_produccion.sql
--
-- Devuelve el esquema al de las migraciones anteriores (staging antes
-- de la reconciliación). SOLO para entornos creados desde el repo:
-- en producción borraría objetos que existían antes de la migración.
-- Falla a propósito si hay incidencias con tipos o niveles nuevos.
-- ============================================================

-- 5. Grupos de entrega: versiones de 20260728000000 (gen_random_bytes,
--    search_path = public, EXECUTE para PUBLIC).
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

grant execute on function public.obtener_o_crear_grupo_entrega(uuid, uuid, uuid) to public;
grant execute on function public.crear_grupo_entrega_separado(uuid, uuid, uuid) to public;

-- 4. Historial: vuelve a SECURITY INVOKER sin search_path fijo.
create or replace function public.fn_registrar_historial_paquete()
returns trigger
language plpgsql
security invoker
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
grant execute on function public.fn_registrar_historial_paquete() to public;

-- 3. registrar_paquete_con_incidencia no existía en el repo.
drop function public.registrar_paquete_con_incidencia(
  uuid, uuid, uuid, text, uuid, text, uuid, uuid, uuid, text, uuid, text, text, text
);

-- 2. Tipos originales (8).
alter table public.incidencias drop constraint incidencias_tipo_check;
alter table public.incidencias add constraint incidencias_tipo_check
  check (tipo in ('danado', 'abierto', 'mojado', 'etiqueta_ilegible', 'destinatario_desconocido',
                  'rechazado', 'devuelto', 'extraviado'));

-- 1. nivel_danio no existía en el repo.
alter table public.incidencias drop constraint incidencias_nivel_danio_check;
alter table public.incidencias drop column nivel_danio;
