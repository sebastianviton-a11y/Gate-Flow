-- ============================================================
-- 20261017000000_aceptaciones_registro_invitacion.sql
--
-- Fase 3 legal: la evidencia de aceptación (aceptaciones_legales, Fase
-- 1) se escribe al registrarse y al aceptar una invitación.
--
-- REGISTRO (crear_cuenta_prueba, nueva firma de 8 argumentos)
--   * Recibe las versiones que el formulario MOSTRÓ (p_version_ids) y la
--     declaración de facultades para el Acuerdo de Tratamiento.
--   * Antes de crear nada: cada versión recibida debe seguir vigente en
--     el país (si no: documento_cambiado) y cada requisito de
--     admin_residencial del país debe tener versión vigente
--     (documento_no_disponible) y estar entre las recibidas
--     (aceptacion_faltante). El alcance de residencial exige la
--     declaración (falta_declaracion_facultades).
--   * La evidencia se escribe en la MISMA transacción que la cuenta: si
--     falta una aceptación obligatoria, no se crea nada. Versión, hash y
--     hora del servidor los fija el trigger de la Fase 1.
--   * La firma anterior (6 argumentos) se conserva y delega en la nueva
--     sin versiones: no sirve para saltarse requisitos (con requisitos
--     cargados falla con aceptacion_faltante). Sin requisitos (hoy) se
--     comporta igual que antes.
--   * revertir_cuenta_prueba descarta la evidencia del alta fallida
--     (descartar_aceptaciones_alta_fallida) antes de borrar; si no se
--     puede descartar, no revierte nada.
--
-- INVITACIÓN (aceptar_documentos_invitacion, nueva)
--   * Para auth.uid() en un residencial donde es miembro activo:
--     registra los documentos pendientes de alcance usuario (Términos,
--     Aviso de Privacidad) con origen 'invitacion' y fija
--     users.terminos_aceptados_en con la hora del SERVIDOR.
--   * Mismas comprobaciones de cambio de versión que el registro. El
--     Acuerdo de Tratamiento (alcance residencial) es el contrato del
--     residencial y se acepta en el registro; aquí no se pide.
--
-- users.terminos_aceptados_en: deja de poder escribirse desde la API
-- (trigger): solo el servidor la fija al registrar una aceptación.
--
-- Sin cambios en tablas ni políticas. Rollback:
-- supabase/rollback/20261017000000_aceptaciones_registro_invitacion.down.sql
-- ============================================================

-- ── 1. Alta con evidencia de aceptación ─────────────────────────────
create function public.crear_cuenta_prueba(
  p_user_id uuid,
  p_nombre_residencial text,
  p_pais text,
  p_viviendas integer,
  p_timezone text,
  p_acepta_terminos boolean,
  p_version_ids uuid[],
  p_declara_facultades boolean
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
  v_ids uuid[] := coalesce(p_version_ids, '{}'::uuid[]);
  v_req record;
  v_aceptaciones int := 0;
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

  -- Documentos aceptados: los que mostró el formulario, todavía vigentes.
  if cardinality(v_ids) > 10 or array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'crear_cuenta_prueba: lista de versiones no válida' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) x
    where x not in (select vig.version_id from public.documentos_legales_vigentes(p_pais) vig)
  ) then
    raise exception 'crear_cuenta_prueba: documento_cambiado' using errcode = '22023';
  end if;
  for v_req in
    select q.documento_clave, q.tipo, q.alcance, vig.version_id
    from public.requisitos_legales q
    left join public.documentos_legales_vigentes(p_pais) vig on vig.documento_clave = q.documento_clave
    where q.rol_clave = 'admin_residencial' and q.jurisdiccion = p_pais
    order by q.documento_clave
  loop
    if v_req.version_id is null then
      raise exception 'crear_cuenta_prueba: documento_no_disponible (%)', v_req.documento_clave using errcode = '22023';
    end if;
    if not (v_req.version_id = any (v_ids)) then
      raise exception 'crear_cuenta_prueba: aceptacion_faltante (%)', v_req.documento_clave using errcode = '22023';
    end if;
    if v_req.alcance = 'residencial' and p_declara_facultades is not true then
      raise exception 'crear_cuenta_prueba: falta_declaracion_facultades' using errcode = '22023';
    end if;
  end loop;

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

  -- Evidencia (Fase 1): el trigger valida versión vigente, país y
  -- membresía, y fija el hash de la versión y la hora del servidor.
  insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, declara_facultades, contenido_sha256)
  select p_user_id, v_tenant_id, vig.version_id, q.tipo, q.alcance, 'registro', q.alcance = 'residencial', repeat('0', 64)
  from public.requisitos_legales q
  join public.documentos_legales_vigentes(p_pais) vig on vig.documento_clave = q.documento_clave
  where q.rol_clave = 'admin_residencial' and q.jurisdiccion = p_pais;
  get diagnostics v_aceptaciones = row_count;

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
    'trial_ends_at', v_fin,
    'aceptaciones', v_aceptaciones
  );
end;
$$;

revoke execute on function public.crear_cuenta_prueba(uuid, text, text, integer, text, boolean, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.crear_cuenta_prueba(uuid, text, text, integer, text, boolean, uuid[], boolean) to service_role;

-- La firma anterior delega sin versiones: igual que antes mientras no
-- haya requisitos; con requisitos, no permite crear una cuenta sin la
-- evidencia.
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
begin
  return public.crear_cuenta_prueba(p_user_id, p_nombre_residencial, p_pais, p_viviendas, p_timezone, p_acepta_terminos,
                                    '{}'::uuid[], false);
end;
$$;


-- ── 2. Revertir un alta: también su evidencia ───────────────────────
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

  -- Evidencia del alta: se descarta solo si es de un alta fallida (cuenta
  -- nunca confirmada ni usada). Si no se puede, no se revierte nada.
  if exists (select 1 from public.aceptaciones_legales a where a.user_id = p_user_id or a.tenant_id = v_tenant_id) then
    begin
      perform public.descartar_aceptaciones_alta_fallida(p_user_id, v_tenant_id);
    exception when others then
      return jsonb_build_object('revertido', false, 'motivo', 'evidencia_conservada', 'tenant_id', v_tenant_id);
    end;
  end if;

  delete from public.audit_log where tenant_id = v_tenant_id;
  delete from public.suscripciones where tenant_id = v_tenant_id;
  delete from public.user_tenants where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.empresas where id = v_empresa_id;

  return jsonb_build_object('revertido', true, 'tenant_id', v_tenant_id, 'empresa_id', v_empresa_id);
end;
$$;


-- ── 3. Aceptación al aceptar una invitación ─────────────────────────
-- Para auth.uid() en p_tenant_id (miembro activo): registra los
-- pendientes de alcance usuario entre las versiones mostradas y fija
-- users.terminos_aceptados_en con now() del servidor. Sin requisitos ni
-- documentos (hoy) solo fija la fecha. Todo o nada.
create function public.aceptar_documentos_invitacion(p_tenant_id uuid, p_version_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pais text;
  v_ids uuid[] := coalesce(p_version_ids, '{}'::uuid[]);
  v_registrar uuid[];
  v_faltan text;
  v_resultado jsonb := '{}'::jsonb;
  v_ahora timestamptz := now();
begin
  if v_uid is null then
    raise exception 'aceptar_documentos_invitacion: requiere una sesión' using errcode = '42501';
  end if;
  if cardinality(v_ids) > 10 or array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'aceptar_documentos_invitacion: lista de versiones no válida' using errcode = '22023';
  end if;

  select t.pais into v_pais
  from public.user_tenants ut
  join public.tenants t on t.id = ut.tenant_id
  where ut.user_id = v_uid and ut.tenant_id = p_tenant_id and ut.activo;
  if not found then
    raise exception 'aceptar_documentos_invitacion: sin membresía activa en el residencial' using errcode = '42501';
  end if;

  if exists (
    select 1 from unnest(v_ids) x
    where x not in (select vig.version_id from public.documentos_legales_vigentes(v_pais) vig)
  ) then
    raise exception 'aceptar_documentos_invitacion: documento_cambiado' using errcode = '22023';
  end if;

  select array_agg(p.version_id order by p.documento_clave),
         string_agg(p.documento_clave, ',' order by p.documento_clave) filter (where not (p.version_id = any (v_ids)))
    into v_registrar, v_faltan
  from public.documentos_pendientes(p_tenant_id) p
  where p.alcance = 'usuario';
  if v_faltan is not null then
    raise exception 'aceptar_documentos_invitacion: aceptacion_faltante (%)', v_faltan using errcode = '22023';
  end if;

  if cardinality(v_registrar) > 0 then
    v_resultado := public.registrar_aceptaciones(p_tenant_id, v_registrar, 'invitacion', false);
  end if;

  update public.users set terminos_aceptados_en = v_ahora where id = v_uid;

  return jsonb_build_object(
    'registradas', coalesce((v_resultado->>'registradas')::int, 0),
    'ya_existentes', coalesce((v_resultado->>'ya_existentes')::int, 0),
    'terminos_aceptados_en', v_ahora
  );
end;
$$;

revoke execute on function public.aceptar_documentos_invitacion(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.aceptar_documentos_invitacion(uuid, uuid[]) to authenticated;


-- ── 4. users.terminos_aceptados_en solo la fija el servidor ─────────
-- authenticated tiene UPDATE de tabla sobre su propia fila (RLS): sin
-- esto, el navegador podía escribir la fecha que quisiera. Las funciones
-- SECURITY DEFINER (registro, invitación, registrar_aceptaciones) corren
-- como su dueño y sí pueden.
create function public.users_terminos_solo_servidor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.terminos_aceptados_en is distinct from old.terminos_aceptados_en and current_user in ('anon', 'authenticated') then
    raise exception 'users: terminos_aceptados_en la fija el servidor al registrar la aceptación' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.users_terminos_solo_servidor() from public, anon, authenticated, service_role;

create trigger users_terminos_solo_servidor
  before update of terminos_aceptados_en on public.users
  for each row execute function public.users_terminos_solo_servidor();
