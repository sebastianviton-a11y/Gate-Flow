-- ============================================================
-- Rollback de 20261007000000_tenant_operativo.sql
--
-- Quita las políticas restrictivas de escritura y tenant_operativo(),
-- y restaura entregar_paquete exactamente como la dejó
-- 20260715000000_notificaciones_whatsapp. No toca datos ni las
-- políticas existentes. Verificado por los runners locales: el
-- catálogo queda idéntico al previo (mismo md5 de cada función).
-- ============================================================

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array[
    'paquetes', 'paquete_fotografias', 'paquete_firmas', 'paquete_grupos_entrega',
    'notificaciones', 'incidencias', 'unidades', 'residentes_unidades',
    'calles', 'manzanas', 'edificios', 'ubicaciones', 'empresas_paqueteria',
    'plantillas_notificacion', 'prioridades_paquete', 'tamanos_paquete',
    'casas', 'departamentos', 'incidencia_fotografias'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_tabla || '_operativo_insert', v_tabla);
    execute format('drop policy if exists %I on public.%I', v_tabla || '_operativo_update', v_tabla);
    execute format('drop policy if exists %I on public.%I', v_tabla || '_operativo_delete', v_tabla);
  end loop;
end $$;

drop policy if exists tenants_operativo_update on public.tenants;
drop policy if exists objects_operativo_insert on storage.objects;
drop policy if exists objects_operativo_update on storage.objects;
drop policy if exists objects_operativo_delete on storage.objects;

create or replace function public.entregar_paquete(p_paquete_id uuid, p_entregado_por uuid, p_entregado_a_nombre text)
 RETURNS paquetes
 LANGUAGE plpgsql
AS $function$
declare
  v_paquete public.paquetes;
  v_destinatario_nombre text;
  v_destinatario_user_id uuid;
begin
  select * into v_paquete from public.paquetes where id = p_paquete_id for update;

  if not found then
    raise exception 'Paquete % no existe', p_paquete_id;
  end if;

  if v_paquete.estado_id = 'entregado' then
    raise exception 'El paquete % ya fue entregado el %', v_paquete.codigo_gateflow, v_paquete.fecha_entrega
      using errcode = 'P0001';
  end if;

  perform set_config('app.allow_delivery_update', 'true', true);

  update public.paquetes
  set
    estado_id = 'entregado',
    entregado_por = p_entregado_por,
    entregado_a_nombre = p_entregado_a_nombre,
    fecha_entrega = now()
  where id = p_paquete_id
  returning * into v_paquete;

  -- Resolver a quién notificar: residente formal si existe, si no, el
  -- contacto informal de la unidad (mismo criterio que registrarPaquete
  -- en TypeScript, packages/paquetes/src/mutations.ts).
  select u.nombre_completo, u.id into v_destinatario_nombre, v_destinatario_user_id
  from public.users u where u.id = v_paquete.residente_id;

  if v_destinatario_nombre is null then
    select un.contacto_nombre into v_destinatario_nombre
    from public.unidades un where un.id = v_paquete.unidad_id;
    v_destinatario_user_id := null;
  end if;

  if v_destinatario_nombre is not null then
    insert into public.notificaciones (
      tenant_id, paquete_id, destinatario_user_id, destinatario_nombre, canal, plantilla, contenido, estado_envio
    ) values (
      v_paquete.tenant_id, v_paquete.id, v_destinatario_user_id, v_destinatario_nombre, 'whatsapp',
      'paquete_entregado',
      format('Confirmamos: tu paquete %s fue entregado el %s.', v_paquete.codigo_gateflow, to_char(now(), 'DD/MM/YYYY HH24:MI')),
      'pendiente'
    );
  end if;

  return v_paquete;
end;
$function$;


drop function if exists public.tenant_operativo(uuid);
