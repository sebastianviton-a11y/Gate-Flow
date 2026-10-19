-- ============================================================
-- 20261008000000_tenants_columnas_protegidas.sql
--
-- Hasta aquí `authenticated` tenía UPDATE sobre TODAS las columnas
-- de public.tenants y la única barrera era la política
-- tenants_update_admin (admin_residencial o super_admin del propio
-- tenant). Un admin_residencial operativo podía cambiar desde el
-- navegador su estado_servicio, pais, empresa_id, plan, precio y
-- fechas comerciales, notas internas de Super Admin, etc.
--
--   1. UPDATE por columna: authenticated solo puede actualizar las
--      columnas que la UI del admin_residencial edita hoy:
--        nombre, direccion, telefono, correo   (configuración y onboarding)
--        configuracion                          (logo, horario, reglas)
--        onboarding_completado                  (fin del onboarding)
--      Todo lo demás (id, tipo, ciudad, estado_geografico, pais,
--      timezone, plan*, activo, estado_servicio, contacto y
--      observaciones de Super Admin, empresa_id, created_at,
--      updated_at) queda fuera del alcance de la API. updated_at lo
--      sigue escribiendo el trigger. Las políticas RLS no cambian.
--   2. Super Admin conserva sus operaciones legítimas mediante tres
--      funciones SECURITY DEFINER (search_path vacío, EXECUTE solo
--      para authenticated, is_super_admin() explícito, tenant_id
--      explícito, auditoría). Ya no dependen de tener membresía en el
--      residencial editado.
--
-- No toca INSERT/DELETE (sus políticas ya son solo de super_admin),
-- ni anon, ni service_role, ni datos.
-- Rollback: supabase/rollback/20261008000000_tenants_columnas_protegidas.down.sql
-- ============================================================

-- ── 1. UPDATE por columna ─────────────────────────────────────
revoke update on public.tenants from authenticated;
grant update (nombre, direccion, telefono, correo, configuracion, onboarding_completado)
  on public.tenants to authenticated;


-- ── 2. Operaciones de Super Admin ─────────────────────────────

-- Datos generales del residencial (pantalla de detalle de Super
-- Admin). La auditoría registra qué columnas cambiaron, no sus
-- valores: contacto y observaciones son datos internos.
create function public.superadmin_actualizar_residencial(
  p_tenant_id uuid,
  p_nombre text,
  p_ciudad text,
  p_estado_geografico text,
  p_admin_contacto_nombre text,
  p_admin_contacto_email text,
  p_admin_contacto_telefono text,
  p_observaciones text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_antes public.tenants;
  v_despues public.tenants;
  v_nombre text := nullif(btrim(p_nombre), '');
  v_cambios text[];
begin
  if not public.is_super_admin() then
    raise exception 'superadmin_actualizar_residencial: solo super_admin' using errcode = '42501';
  end if;
  if p_tenant_id is null then
    raise exception 'superadmin_actualizar_residencial: falta p_tenant_id' using errcode = '22023';
  end if;
  if v_nombre is null then
    raise exception 'superadmin_actualizar_residencial: el nombre es obligatorio' using errcode = '22023';
  end if;

  select * into v_antes from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'superadmin_actualizar_residencial: el residencial % no existe', p_tenant_id using errcode = '22023';
  end if;

  update public.tenants t set
    nombre = v_nombre,
    ciudad = nullif(btrim(p_ciudad), ''),
    estado_geografico = nullif(btrim(p_estado_geografico), ''),
    admin_contacto_nombre = nullif(btrim(p_admin_contacto_nombre), ''),
    admin_contacto_email = nullif(btrim(p_admin_contacto_email), ''),
    admin_contacto_telefono = nullif(btrim(p_admin_contacto_telefono), ''),
    observaciones = nullif(btrim(p_observaciones), '')
  where t.id = p_tenant_id
  returning * into v_despues;

  select coalesce(array_agg(n.key order by n.key), '{}') into v_cambios
  from jsonb_each(to_jsonb(v_despues)) n
  join jsonb_each(to_jsonb(v_antes)) a using (key)
  where n.key <> 'updated_at' and n.value is distinct from a.value;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_nuevos)
  values (p_tenant_id, auth.uid(), 'superadmin.residencial_editado', 'tenants', p_tenant_id,
          jsonb_build_object('columnas', to_jsonb(v_cambios)));
end;
$$;

-- Estado del servicio (piloto / activo / suspendido / cancelado). El
-- CHECK de la tabla valida el valor.
create function public.superadmin_cambiar_estado_servicio(p_tenant_id uuid, p_estado text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_anterior text;
begin
  if not public.is_super_admin() then
    raise exception 'superadmin_cambiar_estado_servicio: solo super_admin' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_estado is null then
    raise exception 'superadmin_cambiar_estado_servicio: faltan parámetros' using errcode = '22023';
  end if;

  select t.estado_servicio into v_anterior from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'superadmin_cambiar_estado_servicio: el residencial % no existe', p_tenant_id using errcode = '22023';
  end if;

  update public.tenants t set estado_servicio = p_estado where t.id = p_tenant_id;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
  values (p_tenant_id, auth.uid(), 'superadmin.estado_servicio_cambiado', 'tenants', p_tenant_id,
          jsonb_build_object('estado_servicio', v_anterior), jsonb_build_object('estado_servicio', p_estado));
end;
$$;

-- Plan comercial informativo de Super Admin (tenants.plan*). No es
-- la suscripción: la operación la decide public.suscripciones.
create function public.superadmin_actualizar_plan_residencial(
  p_tenant_id uuid,
  p_plan text,
  p_precio numeric,
  p_fecha_inicio date,
  p_fecha_renovacion date
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_antes jsonb;
  v_despues jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'superadmin_actualizar_plan_residencial: solo super_admin' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_plan is null then
    raise exception 'superadmin_actualizar_plan_residencial: faltan parámetros' using errcode = '22023';
  end if;
  if p_precio is not null and p_precio < 0 then
    raise exception 'superadmin_actualizar_plan_residencial: precio negativo' using errcode = '22023';
  end if;

  select jsonb_build_object('plan', t.plan, 'plan_precio', t.plan_precio,
                            'plan_fecha_inicio', t.plan_fecha_inicio, 'plan_fecha_renovacion', t.plan_fecha_renovacion)
    into v_antes
  from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'superadmin_actualizar_plan_residencial: el residencial % no existe', p_tenant_id using errcode = '22023';
  end if;

  update public.tenants t set
    plan = p_plan,
    plan_precio = p_precio,
    plan_fecha_inicio = p_fecha_inicio,
    plan_fecha_renovacion = p_fecha_renovacion
  where t.id = p_tenant_id
  returning jsonb_build_object('plan', t.plan, 'plan_precio', t.plan_precio,
                               'plan_fecha_inicio', t.plan_fecha_inicio, 'plan_fecha_renovacion', t.plan_fecha_renovacion)
    into v_despues;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
  values (p_tenant_id, auth.uid(), 'superadmin.plan_actualizado', 'tenants', p_tenant_id, v_antes, v_despues);
end;
$$;

revoke execute on function public.superadmin_actualizar_residencial(uuid, text, text, text, text, text, text, text) from public, anon, service_role;
revoke execute on function public.superadmin_cambiar_estado_servicio(uuid, text) from public, anon, service_role;
revoke execute on function public.superadmin_actualizar_plan_residencial(uuid, text, numeric, date, date) from public, anon, service_role;
grant execute on function public.superadmin_actualizar_residencial(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.superadmin_cambiar_estado_servicio(uuid, text) to authenticated;
grant execute on function public.superadmin_actualizar_plan_residencial(uuid, text, numeric, date, date) to authenticated;
