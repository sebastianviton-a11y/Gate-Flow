-- ============================================================
-- Rollback de 20261017000000_aceptaciones_registro_invitacion.sql
-- Restaura crear_cuenta_prueba (6 argumentos) y revertir_cuenta_prueba
-- tal como las dejó 20261006000000_registro_trial.sql y quita la firma
-- de 8 argumentos, aceptar_documentos_invitacion y el trigger de
-- users.terminos_aceptados_en. La evidencia ya registrada en
-- aceptaciones_legales NO se toca (es inmutable y sigue siendo válida).
-- ============================================================
begin;

drop trigger if exists users_terminos_solo_servidor on public.users;
drop function if exists public.users_terminos_solo_servidor();
drop function if exists public.aceptar_documentos_invitacion(uuid, uuid[]);
drop function if exists public.crear_cuenta_prueba(uuid, text, text, integer, text, boolean, uuid[], boolean);

create or replace function public.crear_cuenta_prueba(
  p_user_id uuid,
  p_nombre_residencial text,
  p_pais text,
  p_viviendas integer,
  p_timezone text,
  p_acepta_terminos boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_nombre text;
  v_tz text;
  v_tz_canonica text;
  v_rol_id uuid;
  v_empresa_id uuid;
  v_tenant_id uuid;
  v_membresia_id uuid;
  v_suscripcion_id uuid;
  v_inicio timestamptz;
  v_fin timestamptz;
begin
  if p_user_id is null or p_nombre_residencial is null or p_pais is null or p_viviendas is null then
    raise exception 'crear_cuenta_prueba: faltan parámetros' using errcode = '22023';
  end if;
  if p_acepta_terminos is distinct from true then
    raise exception 'crear_cuenta_prueba: hay que aceptar los términos y el aviso de privacidad' using errcode = '22023';
  end if;

  v_nombre := btrim(regexp_replace(p_nombre_residencial, '\s+', ' ', 'g'));
  if length(v_nombre) < 3 or length(v_nombre) > 80 then
    raise exception 'crear_cuenta_prueba: nombre del residencial inválido' using errcode = '22023';
  end if;
  if p_pais not in ('MX', 'AR') then
    raise exception 'crear_cuenta_prueba: país no permitido (%)', p_pais using errcode = '22023';
  end if;
  -- Autoservicio: hasta 150 viviendas. Más de eso se atiende a mano.
  if p_viviendas < 1 or p_viviendas > 150 then
    raise exception 'crear_cuenta_prueba: viviendas fuera de rango (1-150)' using errcode = '22023';
  end if;

  select u.email into v_email from public.users u where u.id = p_user_id;
  if not found then
    raise exception 'crear_cuenta_prueba: el usuario no tiene perfil' using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'crear_cuenta_prueba: el perfil no tiene un correo válido' using errcode = '22023';
  end if;

  -- Solo para cuentas nuevas: nunca sobre alguien que ya pertenece a
  -- un residencial (no es una vía para escalar privilegios).
  if exists (select 1 from public.user_tenants ut where ut.user_id = p_user_id) then
    raise exception 'crear_cuenta_prueba: el usuario ya tiene membresías' using errcode = '42501';
  end if;

  -- Zona horaria: la del navegador si es un nombre IANA conocido;
  -- si no, la del país.
  v_tz := case p_pais when 'MX' then 'America/Mexico_City' else 'America/Argentina/Buenos_Aires' end;
  if p_timezone is not null and length(p_timezone) <= 64 and p_timezone ~ '^[A-Za-z0-9_+/\-]+$' then
    select n.name into v_tz_canonica
    from pg_catalog.pg_timezone_names n
    where lower(n.name) = lower(p_timezone)
    limit 1;
    if v_tz_canonica is not null then
      v_tz := v_tz_canonica;
    end if;
  end if;

  select r.id into v_rol_id from public.roles r where r.clave = 'admin_residencial';
  if v_rol_id is null then
    raise exception 'crear_cuenta_prueba: falta el rol admin_residencial';
  end if;

  v_inicio := now();
  v_fin := v_inicio + interval '30 days';

  insert into public.empresas (nombre, pais, correo_principal, plan, estado_servicio)
  values (v_nombre, p_pais, v_email, 'trial', 'activo')
  returning id into v_empresa_id;

  insert into public.tenants (nombre, tipo, pais, timezone, plan, estado_servicio, onboarding_completado, empresa_id, correo)
  values (v_nombre, 'residencial', p_pais, v_tz, 'trial', 'activo', false, v_empresa_id, v_email)
  returning id into v_tenant_id;

  insert into public.user_tenants (user_id, tenant_id, rol_id, activo)
  values (p_user_id, v_tenant_id, v_rol_id, true)
  returning id into v_membresia_id;

  insert into public.suscripciones (tenant_id, estado, origen, trial_started_at, trial_ends_at, viviendas_declaradas)
  values (v_tenant_id, 'trialing', 'registro_publico', v_inicio, v_fin, p_viviendas)
  returning id into v_suscripcion_id;

  update public.users set terminos_aceptados_en = now() where id = p_user_id;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_nuevos)
  values
    (v_tenant_id, p_user_id, 'registro.cuenta_creada', 'tenants', v_tenant_id,
     jsonb_build_object('empresa_id', v_empresa_id, 'suscripcion_id', v_suscripcion_id, 'pais', p_pais,
                        'timezone', v_tz, 'viviendas', p_viviendas, 'trial_ends_at', v_fin)),
    (v_tenant_id, p_user_id, 'membresia.otorgada', 'user_tenants', v_membresia_id,
     jsonb_build_object('user_id', p_user_id, 'rol_clave', 'admin_residencial', 'origen', 'registro_publico'));

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'empresa_id', v_empresa_id,
    'suscripcion_id', v_suscripcion_id,
    'timezone', v_tz,
    'trial_started_at', v_inicio,
    'trial_ends_at', v_fin
  );
end;
$$;

create or replace function public.revertir_cuenta_prueba(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_empresa_id uuid;
  v_tabla text;
  v_hay_filas boolean;
begin
  if p_user_id is null then
    raise exception 'revertir_cuenta_prueba: falta p_user_id' using errcode = '22023';
  end if;

  if (select count(*) from public.user_tenants ut where ut.user_id = p_user_id) <> 1 then
    return jsonb_build_object('revertido', false, 'motivo', 'usuario_sin_membresia_unica');
  end if;

  select ut.tenant_id into v_tenant_id
  from public.user_tenants ut
  join public.roles r on r.id = ut.rol_id
  where ut.user_id = p_user_id and r.clave = 'admin_residencial';
  if v_tenant_id is null then
    return jsonb_build_object('revertido', false, 'motivo', 'membresia_no_admin');
  end if;

  if not exists (
    select 1 from public.suscripciones s
    where s.tenant_id = v_tenant_id and s.origen = 'registro_publico' and s.estado = 'trialing'
  ) then
    return jsonb_build_object('revertido', false, 'motivo', 'suscripcion_no_revertible', 'tenant_id', v_tenant_id);
  end if;

  select t.empresa_id into v_empresa_id
  from public.tenants t
  where t.id = v_tenant_id
    and t.onboarding_completado = false
    and t.plan = 'trial'
    and t.estado_servicio = 'activo';
  if v_empresa_id is null then
    return jsonb_build_object('revertido', false, 'motivo', 'tenant_no_revertible', 'tenant_id', v_tenant_id);
  end if;

  if (select count(*) from public.user_tenants ut where ut.tenant_id = v_tenant_id) <> 1 then
    return jsonb_build_object('revertido', false, 'motivo', 'tenant_con_mas_miembros', 'tenant_id', v_tenant_id);
  end if;

  if (select count(*) from public.tenants t where t.empresa_id = v_empresa_id) <> 1 then
    return jsonb_build_object('revertido', false, 'motivo', 'empresa_con_mas_residenciales', 'tenant_id', v_tenant_id);
  end if;

  if not exists (
    select 1 from public.audit_log a
    where a.tenant_id = v_tenant_id and a.accion = 'registro.cuenta_creada'
      and a.user_id = p_user_id and a.entidad_id = v_tenant_id
  ) then
    return jsonb_build_object('revertido', false, 'motivo', 'no_es_usuario_inicial', 'tenant_id', v_tenant_id);
  end if;

  -- Cualquier fila operativa del tenant lo vuelve irreversible.
  foreach v_tabla in array array[
    'paquetes', 'unidades', 'ubicaciones', 'incidencias', 'notificaciones', 'paquete_grupos_entrega',
    'residentes_unidades', 'calles', 'manzanas', 'edificios', 'empresas_paqueteria', 'tamanos_paquete',
    'prioridades_paquete', 'plantillas_notificacion'
  ]
  loop
    if pg_catalog.to_regclass('public.' || v_tabla) is null then
      continue;
    end if;
    execute format('select exists (select 1 from public.%I where tenant_id = $1)', v_tabla)
      into v_hay_filas using v_tenant_id;
    if v_hay_filas then
      return jsonb_build_object('revertido', false, 'motivo', 'actividad:' || v_tabla, 'tenant_id', v_tenant_id);
    end if;
  end loop;

  if exists (
    select 1 from public.audit_log a
    where a.tenant_id = v_tenant_id and a.accion not in ('registro.cuenta_creada', 'membresia.otorgada')
  ) then
    return jsonb_build_object('revertido', false, 'motivo', 'actividad:audit_log', 'tenant_id', v_tenant_id);
  end if;

  delete from public.audit_log where tenant_id = v_tenant_id;
  delete from public.suscripciones where tenant_id = v_tenant_id;
  delete from public.user_tenants where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.empresas where id = v_empresa_id;

  return jsonb_build_object('revertido', true, 'tenant_id', v_tenant_id, 'empresa_id', v_empresa_id);
end;
$$;

commit;
