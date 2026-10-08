-- ============================================================
-- SOLO PARA EL ENSAYO LOCAL. Lleva la base local (stub + migraciones
-- del repo hasta 20260729000000) a la forma de PRODUCCIÓN
-- (xlozkpygubyiuxopmdxw), leída del catálogo en solo lectura el
-- 2026-10-08. Sin filas de datos.
-- ============================================================
begin;

-- incidencias: columna y checks de producción
alter table public.incidencias add column nivel_danio text;
alter table public.incidencias add constraint incidencias_nivel_danio_check
  check (((nivel_danio is null) or (nivel_danio = any (array['leve'::text, 'moderado'::text, 'grave'::text]))));
alter table public.incidencias drop constraint incidencias_tipo_check;
alter table public.incidencias add constraint incidencias_tipo_check
  check ((tipo = any (array['danado'::text, 'abierto'::text, 'mojado'::text, 'etiqueta_ilegible'::text, 'destinatario_desconocido'::text, 'rechazado'::text, 'devuelto'::text, 'extraviado'::text, 'golpeado'::text, 'roto'::text, 'empaque_deteriorado'::text, 'contenido_incompleto'::text, 'otro'::text])));

-- Funciones tal como están en producción
CREATE OR REPLACE FUNCTION public.crear_grupo_entrega_separado(p_tenant_id uuid, p_unidad_id uuid, p_residente_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_grupo_id uuid;
begin
  insert into public.paquete_grupos_entrega (tenant_id, unidad_id, residente_id, token)
  values (
    p_tenant_id, p_unidad_id, p_residente_id,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  )
  returning id into v_grupo_id;

  return v_grupo_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.entregar_paquete(p_paquete_id uuid, p_entregado_por uuid, p_entregado_a_nombre text)
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

CREATE OR REPLACE FUNCTION public.fn_proteger_campos_paquete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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

  if coalesce(current_setting('app.allow_delivery_update', true), 'false') <> 'true' then
    if new.entregado_por is distinct from old.entregado_por
      or new.fecha_entrega is distinct from old.fecha_entrega
      or new.entregado_a_nombre is distinct from old.entregado_a_nombre then
      raise exception 'entregado_por/fecha_entrega/entregado_a_nombre solo pueden cambiar vía entregar_paquete()';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_registrar_historial_paquete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.has_role_in_tenant(p_tenant_id uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.user_tenants ut
    join public.roles r on r.id = ut.rol_id
    where ut.user_id = auth.uid()
      and ut.activo = true
      and ut.tenant_id = p_tenant_id
      and r.clave = any(p_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.obtener_o_crear_grupo_entrega(p_tenant_id uuid, p_unidad_id uuid, p_residente_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  values (
    p_tenant_id, p_unidad_id, p_residente_id,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  )
  returning id into v_grupo_id;

  return v_grupo_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.refrescar_search_vectors(p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  update public.paquetes
  set updated_at = updated_at
  where (p_tenant_id is null or tenant_id = p_tenant_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_paquete_con_incidencia(p_tenant_id uuid, p_unidad_id uuid, p_residente_id uuid, p_remitente text, p_empresa_paqueteria_id uuid, p_numero_guia text, p_tamano_id uuid, p_prioridad_id uuid, p_ubicacion_id uuid, p_notas text, p_recibido_por uuid, p_tipo_incidencia text, p_descripcion_incidencia text, p_nivel_danio text)
 RETURNS TABLE(paquete_id uuid, incidencia_id uuid)
 LANGUAGE plpgsql
AS $function$
declare
  v_paquete_id uuid;
  v_incidencia_id uuid;
begin
  insert into public.paquetes (
    tenant_id, unidad_id, residente_id, remitente, empresa_paqueteria_id,
    numero_guia, tamano_id, prioridad_id, ubicacion_id, notas, recibido_por, estado_id
  ) values (
    p_tenant_id, p_unidad_id, p_residente_id, p_remitente, p_empresa_paqueteria_id,
    p_numero_guia, p_tamano_id, p_prioridad_id, p_ubicacion_id, p_notas, p_recibido_por, 'recibido'
  ) returning id into v_paquete_id;

  insert into public.incidencias (tenant_id, paquete_id, tipo, descripcion, nivel_danio, reportada_por)
  values (p_tenant_id, v_paquete_id, p_tipo_incidencia, p_descripcion_incidencia, p_nivel_danio, p_recibido_por)
  returning id into v_incidencia_id;

  return query select v_paquete_id, v_incidencia_id;
end;
$function$;

-- Políticas de producción (has_role_in_tenant en vez de has_role)
alter policy audit_log_read_admin on public.audit_log
  using (((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text])) or is_super_admin());
alter policy empresas_paqueteria_write_admin on public.empresas_paqueteria
  with check ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy grupos_entrega_delete_admin on public.paquete_grupos_entrega
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy grupos_entrega_update on public.paquete_grupos_entrega
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and (has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]) or (estado <> 'completado'::text)))
  with check (tenant_id in (select current_tenant_ids() as current_tenant_ids));
alter policy paquetes_delete_admin on public.paquetes
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy paquetes_update on public.paquetes
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and (has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]) or (estado_id <> 'entregado'::text)))
  with check (tenant_id in (select current_tenant_ids() as current_tenant_ids));
alter policy plantillas_notificacion_update_admin on public.plantillas_notificacion
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy plantillas_notificacion_write_admin on public.plantillas_notificacion
  with check ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy prioridades_paquete_update_admin on public.prioridades_paquete
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy prioridades_paquete_write_admin on public.prioridades_paquete
  with check ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy tamanos_paquete_update_admin on public.tamanos_paquete
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy tamanos_paquete_write_admin on public.tamanos_paquete
  with check ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy tenants_update_admin on public.tenants
  using ((id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy ubicaciones_delete_admin on public.ubicaciones
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy ubicaciones_insert_admin on public.ubicaciones
  with check ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy ubicaciones_update_admin on public.ubicaciones
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]))
  with check (tenant_id in (select current_tenant_ids() as current_tenant_ids));
alter policy unidades_delete_admin on public.unidades
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy unidades_insert_admin on public.unidades
  with check ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]));
alter policy unidades_update_admin on public.unidades
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]))
  with check (tenant_id in (select current_tenant_ids() as current_tenant_ids));
alter policy user_tenants_write_admin on public.user_tenants
  using ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]))
  with check ((tenant_id in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(tenant_id, array['admin_residencial'::text, 'super_admin'::text]) and (rol_id <> (select roles.id from roles where (roles.clave = 'super_admin'::text))));
alter policy logos_delete_admin_propio_tenant on storage.objects
  using ((bucket_id = 'logos'::text) and (((storage.foldername(name))[1])::uuid in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(((storage.foldername(name))[1])::uuid, array['admin_residencial'::text, 'super_admin'::text]));
alter policy logos_insert_admin_propio_tenant on storage.objects
  with check ((bucket_id = 'logos'::text) and (((storage.foldername(name))[1])::uuid in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(((storage.foldername(name))[1])::uuid, array['admin_residencial'::text, 'super_admin'::text]));
alter policy logos_update_admin_propio_tenant on storage.objects
  using ((bucket_id = 'logos'::text) and (((storage.foldername(name))[1])::uuid in (select current_tenant_ids() as current_tenant_ids)) and has_role_in_tenant(((storage.foldername(name))[1])::uuid, array['admin_residencial'::text, 'super_admin'::text]));

-- Privilegios por defecto de producción en public (incluyen al dueño)
alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to postgres, anon, authenticated, service_role;

commit;
