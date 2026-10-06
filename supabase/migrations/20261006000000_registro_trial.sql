-- ============================================================
-- 20261006000000_registro_trial.sql
--
-- /registro: alta automática de cuenta + residencial con trial de
-- 30 días, sin tarjeta. Todo lo que decide el servidor vive aquí:
--
--   suscripciones            una fila por tenant (trialing/active/…).
--                            Backfill idempotente: los tenants que ya
--                            existen quedan active + alta_manual, sin
--                            fechas de trial y sin cambiar nada más.
--   registro_intentos        rate limit sin email ni IP en claro (solo
--                            HMAC-SHA256 calculado en el servidor).
--   registro_intento_permitido / registro_intento_resultado
--   crear_cuenta_prueba      alta atómica: empresa + tenant + primer
--                            usuario admin_residencial + suscripción
--                            trialing + auditoría. Rol fijo; no acepta
--                            tenant_id, empresa_id, plan, estado ni
--                            fechas.
--   revertir_cuenta_prueba   compensación restrictiva cuando el correo
--                            de confirmación no se pudo enviar.
--   crear_suscripcion_alta_manual
--                            alta manual desde Super Admin: active +
--                            alta_manual, sin trial; idempotente.
--
-- Las cinco funciones son SECURITY DEFINER con search_path vacío y
-- EXECUTE solo para service_role: el navegador nunca las llama. La
-- membresía nace en una tabla que el cliente no puede escribir (E2) y
-- sobre un tenant recién creado (E4); la metadata de Auth sigue
-- creando solo el perfil (E1).
-- Rollback: supabase/rollback/20261006000000_registro_trial.down.sql
-- ============================================================


-- ── 1. suscripciones ──────────────────────────────────────────
create table public.suscripciones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete cascade,
  estado text not null
    check (estado in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  viviendas_declaradas integer check (viviendas_declaradas is null or viviendas_declaradas >= 1),
  origen text not null check (origen in ('registro_publico', 'alta_manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suscripciones_trial_fechas_check check (
    (trial_started_at is null and trial_ends_at is null)
    or (trial_started_at is not null and trial_ends_at is not null and trial_ends_at > trial_started_at)
  ),
  constraint suscripciones_trialing_fechas_check check (estado <> 'trialing' or trial_started_at is not null)
);
create index idx_suscripciones_estado on public.suscripciones (estado);

create trigger trg_suscripciones_updated_at before update on public.suscripciones
  for each row execute function public.set_updated_at();
create trigger trg_suscripciones_tenant_id_inmutable before update of tenant_id on public.suscripciones
  for each row execute function public.fn_tenant_id_inmutable();

alter table public.suscripciones enable row level security;

-- Lectura: miembros del tenant y super_admin. Sin políticas de
-- escritura: ningún usuario authenticated puede insertar, actualizar
-- ni borrar; solo las funciones de abajo (service_role) escriben.
create policy suscripciones_select_member on public.suscripciones
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());

revoke all on public.suscripciones from public, anon, authenticated, service_role;
grant select on public.suscripciones to authenticated;

-- Backfill idempotente: los residenciales existentes siguen operando
-- igual (active, alta manual, sin trial). No se toca ninguna otra
-- columna ni tabla.
insert into public.suscripciones (tenant_id, estado, origen)
select t.id, 'active', 'alta_manual'
from public.tenants t
where not exists (select 1 from public.suscripciones s where s.tenant_id = t.id);


-- ── 2. registro_intentos ──────────────────────────────────────
-- Solo hashes (HMAC-SHA256 hex, 64 caracteres) calculados en el
-- servidor con REGISTRO_HASH_PEPPER. Nunca email ni IP en claro.
create table public.registro_intentos (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  estado text not null check (estado in ('iniciado', 'exito', 'fallo', 'bloqueado')),
  motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_registro_intentos_email on public.registro_intentos (email_hash, created_at);
create index idx_registro_intentos_ip on public.registro_intentos (ip_hash, created_at);

create trigger trg_registro_intentos_updated_at before update on public.registro_intentos
  for each row execute function public.set_updated_at();

-- RLS sin políticas y sin grants: inaccesible para la API salvo por
-- las dos funciones de abajo.
alter table public.registro_intentos enable row level security;
revoke all on public.registro_intentos from public, anon, authenticated, service_role;


-- ── 3. registro_intento_permitido ─────────────────────────────
-- Serializa con advisory locks (por correo y por IP, siempre en ese
-- orden) para que dos envíos simultáneos no pasen ambos el límite.
-- Límites: 3/h por correo, 5/h por IP, 20/24 h por IP. Siempre deja
-- registrado el intento (iniciado o bloqueado) y devuelve su id.
create function public.registro_intento_permitido(p_email_hash text, p_ip_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_motivo text;
  v_email_hora integer := 0;
  v_ip_hora integer := 0;
  v_ip_dia integer := 0;
begin
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'registro_intento_permitido: email_hash inválido' using errcode = '22023';
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'registro_intento_permitido: ip_hash inválido' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registro_email:' || p_email_hash, 0));
  if p_ip_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registro_ip:' || p_ip_hash, 0));
  end if;

  -- Ningún límite mira más atrás de 24 h: lo más viejo no sirve.
  delete from public.registro_intentos where created_at < now() - interval '7 days';

  select count(*) into v_email_hora
  from public.registro_intentos
  where email_hash = p_email_hash and created_at > now() - interval '1 hour';

  if p_ip_hash is not null then
    select count(*) filter (where created_at > now() - interval '1 hour'),
           count(*) filter (where created_at > now() - interval '24 hours')
    into v_ip_hora, v_ip_dia
    from public.registro_intentos
    where ip_hash = p_ip_hash;
  end if;

  v_motivo := case
    when v_email_hora >= 3 then 'limite_email_hora'
    when v_ip_hora >= 5 then 'limite_ip_hora'
    when v_ip_dia >= 20 then 'limite_ip_dia'
  end;

  insert into public.registro_intentos (email_hash, ip_hash, estado, motivo)
  values (p_email_hash, p_ip_hash, case when v_motivo is null then 'iniciado' else 'bloqueado' end, v_motivo)
  returning id into v_id;

  return jsonb_build_object('intento_id', v_id, 'permitido', v_motivo is null, 'motivo', v_motivo);
end;
$$;

revoke execute on function public.registro_intento_permitido(text, text) from public, anon, authenticated;
grant execute on function public.registro_intento_permitido(text, text) to service_role;


-- ── 4. registro_intento_resultado ─────────────────────────────
-- Cierra exactamente un intento (el id que devolvió la función
-- anterior) y solo si sigue en 'iniciado'.
create function public.registro_intento_resultado(p_intento_id uuid, p_estado text, p_motivo text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_intento_id is null or p_estado not in ('exito', 'fallo') then
    raise exception 'registro_intento_resultado: parámetros inválidos' using errcode = '22023';
  end if;

  update public.registro_intentos
  set estado = p_estado, motivo = p_motivo
  where id = p_intento_id and estado = 'iniciado';

  return found;
end;
$$;

revoke execute on function public.registro_intento_resultado(uuid, text, text) from public, anon, authenticated;
grant execute on function public.registro_intento_resultado(uuid, text, text) to service_role;


-- ── 5. crear_cuenta_prueba ────────────────────────────────────
-- El usuario de Auth ya existe (lo creó el servidor con la clave
-- secreta) y el trigger de alta ya creó su perfil en public.users.
-- El correo del residencial y de la empresa se toma de ese perfil
-- (lo escribió el trigger a partir de auth.users): es un dato de
-- servidor, no una autoridad de seguridad; la seguridad la dan el
-- EXECUTE solo para service_role y la exigencia de que el usuario no
-- tenga ninguna membresía.
create function public.crear_cuenta_prueba(
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

revoke execute on function public.crear_cuenta_prueba(uuid, text, text, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.crear_cuenta_prueba(uuid, text, text, integer, text, boolean) to service_role;


-- ── 6. revertir_cuenta_prueba ─────────────────────────────────
-- Deshace un alta cuyo correo de confirmación no se pudo enviar. Solo
-- borra si TODO se cumple: el usuario tiene exactamente una
-- membresía, es admin_residencial de un tenant con suscripción
-- registro_publico aún trialing, onboarding sin completar, plan trial
-- y sin pagar, es el único miembro, la empresa solo tiene ese
-- residencial, la auditoría lo señala como usuario inicial del alta y
-- no hay ninguna actividad operativa. Si algo no cumple, no toca nada
-- y devuelve el motivo. No borra el usuario de Auth (eso lo hace el
-- servidor después, con la API de administración).
create function public.revertir_cuenta_prueba(p_user_id uuid)
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

revoke execute on function public.revertir_cuenta_prueba(uuid) from public, anon, authenticated;
grant execute on function public.revertir_cuenta_prueba(uuid) to service_role;


-- ── 7. crear_suscripcion_alta_manual ──────────────────────────
-- Alta manual desde Super Admin (apps/admin/app/superadmin/
-- invitacion-actions.ts): el residencial recién creado recibe su
-- suscripción active + alta_manual, sin trial, igual que el backfill.
-- Server-side con la clave de servicio; no acepta estado, origen ni
-- fechas. Idempotente: si el tenant ya tiene suscripción (p. ej. la
-- trialing de crear_cuenta_prueba) no la toca y devuelve creada=false.
-- unique(tenant_id) garantiza una sola suscripción por residencial.
create function public.crear_suscripcion_alta_manual(p_tenant_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_tenant_id is null then
    raise exception 'crear_suscripcion_alta_manual: falta p_tenant_id' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'crear_suscripcion_alta_manual: el residencial % no existe', p_tenant_id using errcode = '22023';
  end if;

  insert into public.suscripciones (tenant_id, estado, origen)
  values (p_tenant_id, 'active', 'alta_manual')
  on conflict (tenant_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('creada', false,
      'suscripcion_id', (select s.id from public.suscripciones s where s.tenant_id = p_tenant_id));
  end if;
  return jsonb_build_object('creada', true, 'suscripcion_id', v_id);
end;
$$;

revoke execute on function public.crear_suscripcion_alta_manual(uuid) from public, anon, authenticated;
grant execute on function public.crear_suscripcion_alta_manual(uuid) to service_role;
