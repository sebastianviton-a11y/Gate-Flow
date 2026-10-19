-- ============================================================
-- 20261013000000_superadmin_suscripcion_manual.sql
--
-- Administración manual de la suscripción desde Super Admin, sin
-- proveedor de cobro (Argentina antes de Mercado Pago). Sin columnas
-- nuevas y sin cambiar tenant_operativo ni billing_*: se usan los campos
-- que ya existen y las reglas que ya aplican.
--
--   superadmin_extender_trial(tenant, hasta)
--       trialing → trialing; trial_ends_at = fin del día local `hasta`.
--   superadmin_activar_suscripcion_manual(tenant, hasta, plan)
--       trialing / expired / canceled / past_due (sin proveedor) → active,
--       origen alta_manual, current_period_end = fin del día local
--       `hasta`, cancel_at_period_end = true (no se renueva sola).
--   superadmin_extender_suscripcion_manual(tenant, hasta)
--       active manual con vencimiento → current_period_end más adelante.
--
-- Por qué así funciona sin tocar el acceso:
--   tenant_operativo (20261009000000) ya da "active + cancel_at_period_end"
--   como operativo solo mientras now() < current_period_end, y la regla TS
--   equivalente (estadoEfectivoSuscripcion) es la misma: la activación
--   manual vence sola en ese instante, sin cron ni webhook. Y
--   billing_crear_checkout ya permite contratar cuando ese periodo
--   terminó: un residencial de México puede pasar a Stripe al vencer.
--
-- "Hasta el 30/11" = acceso durante todo el 30/11 en la zona del
-- residencial (tenants.timezone): el fin es la medianoche local del 01/12.
--
-- Reglas comunes (las tres funciones):
--   * solo super_admin (is_super_admin(), 42501); EXECUTE solo para
--     authenticated: anon y service_role no pueden llamarlas;
--   * tenant explícito y existente; su ÚNICA suscripción (unique
--     tenant_id) se bloquea con FOR UPDATE y se actualiza por id + tenant
--     + estado leído: exactamente 1 fila o error;
--   * nunca tocan una suscripción con proveedor (provider,
--     provider_subscription_id o provider_customer_id): la gestiona el
--     proveedor (Stripe; más adelante Mercado Pago). No cambian
--     provider*, no crean suscripciones, checkouts ni eventos;
--   * fecha: desde hoy (local) y como mucho 180 días (prueba) o 2 años
--     (activación) adelante; extender nunca acorta;
--   * misma fecha que la vigente → "sin_cambios", sin auditoría (doble
--     envío o reintento);
--   * auditoría en audit_log (actor, estado y fechas antes/después), sin
--     datos personales.
--
-- Desactivar: no hay acción nueva. La vía existente es
-- superadmin_cambiar_estado_servicio(…, 'suspendido'), y una activación
-- manual vence sola en su fecha.
-- Rollback: supabase/rollback/20261013000000_superadmin_suscripcion_manual.down.sql
-- ============================================================

-- ── Interno: fin (exclusivo) del día local ────────────────────
create function public.suscripcion_fin_dia_local(p_fecha date, p_zona text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((p_fecha + 1)::timestamp at time zone p_zona);
$$;

comment on function public.suscripcion_fin_dia_local(date, text) is
  'Instante en que termina el día p_fecha en la zona p_zona (medianoche local del día siguiente). Interna de las funciones superadmin_*_suscripcion.';

revoke execute on function public.suscripcion_fin_dia_local(date, text) from public, anon, authenticated, service_role;


-- ── 1. Extender la prueba ─────────────────────────────────────
create function public.superadmin_extender_trial(p_tenant_id uuid, p_hasta date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.suscripciones;
  v_zona text;
  v_hoy date;
  v_fin timestamptz;
  v_n integer;
begin
  if not public.is_super_admin() then
    raise exception 'suscripcion_manual:no_autorizado' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_hasta is null then
    raise exception 'suscripcion_manual:parametros' using errcode = '22023';
  end if;

  select t.timezone into v_zona from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'suscripcion_manual:tenant_inexistente' using errcode = '22023';
  end if;
  select * into v_s from public.suscripciones s where s.tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'suscripcion_manual:sin_suscripcion' using errcode = '22023';
  end if;
  if v_s.provider is not null or v_s.provider_subscription_id is not null or v_s.provider_customer_id is not null then
    raise exception 'suscripcion_manual:gestionada_por_proveedor' using errcode = '22023',
      detail = coalesce(v_s.provider, 'proveedor');
  end if;
  if v_s.estado <> 'trialing' then
    raise exception 'suscripcion_manual:estado_no_permite' using errcode = '22023', detail = v_s.estado;
  end if;

  v_fin := public.suscripcion_fin_dia_local(p_hasta, v_zona);
  if v_s.trial_ends_at = v_fin then
    return jsonb_build_object('resultado', 'sin_cambios', 'suscripcion_id', v_s.id, 'estado', v_s.estado,
                              'trial_ends_at', v_s.trial_ends_at);
  end if;
  v_hoy := (pg_catalog.now() at time zone v_zona)::date;
  if p_hasta < v_hoy then
    raise exception 'suscripcion_manual:fecha_pasada' using errcode = '22023';
  end if;
  if p_hasta > v_hoy + 180 then
    raise exception 'suscripcion_manual:fecha_lejana' using errcode = '22023';
  end if;
  if v_s.trial_ends_at is not null and v_fin < v_s.trial_ends_at then
    raise exception 'suscripcion_manual:fecha_anterior' using errcode = '22023';
  end if;

  update public.suscripciones s set trial_ends_at = v_fin
  where s.id = v_s.id and s.tenant_id = p_tenant_id and s.estado = 'trialing';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'suscripcion_manual:conflicto' using errcode = '40001';
  end if;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
  values (p_tenant_id, auth.uid(), 'superadmin.trial_extendido', 'suscripciones', v_s.id,
          jsonb_build_object('estado', v_s.estado, 'origen', v_s.origen, 'trial_ends_at', v_s.trial_ends_at),
          jsonb_build_object('estado', 'trialing', 'origen', v_s.origen, 'trial_ends_at', v_fin,
                             'hasta', p_hasta, 'zona_horaria', v_zona));

  return jsonb_build_object('resultado', 'aplicado', 'suscripcion_id', v_s.id, 'estado', 'trialing', 'trial_ends_at', v_fin);
end;
$$;


-- ── 2. Activar manualmente ────────────────────────────────────
create function public.superadmin_activar_suscripcion_manual(p_tenant_id uuid, p_hasta date, p_plan text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.suscripciones;
  v_zona text;
  v_hoy date;
  v_fin timestamptz;
  v_n integer;
begin
  if not public.is_super_admin() then
    raise exception 'suscripcion_manual:no_autorizado' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_hasta is null then
    raise exception 'suscripcion_manual:parametros' using errcode = '22023';
  end if;
  if p_plan is not null and p_plan not in ('hasta-50', 'hasta-150') then
    raise exception 'suscripcion_manual:plan_invalido' using errcode = '22023';
  end if;

  select t.timezone into v_zona from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'suscripcion_manual:tenant_inexistente' using errcode = '22023';
  end if;
  select * into v_s from public.suscripciones s where s.tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'suscripcion_manual:sin_suscripcion' using errcode = '22023';
  end if;
  if v_s.provider is not null or v_s.provider_subscription_id is not null or v_s.provider_customer_id is not null then
    raise exception 'suscripcion_manual:gestionada_por_proveedor' using errcode = '22023',
      detail = coalesce(v_s.provider, 'proveedor');
  end if;

  v_fin := public.suscripcion_fin_dia_local(p_hasta, v_zona);
  if v_s.estado = 'active' then
    if v_s.cancel_at_period_end and v_s.current_period_end = v_fin and v_s.plan is not distinct from p_plan then
      return jsonb_build_object('resultado', 'sin_cambios', 'suscripcion_id', v_s.id, 'estado', v_s.estado,
                                'current_period_end', v_s.current_period_end);
    end if;
    if v_s.cancel_at_period_end and v_s.current_period_end is not null then
      -- Ya es una activación manual: se mueve con superadmin_extender_suscripcion_manual.
      raise exception 'suscripcion_manual:ya_activa_manual' using errcode = '22023';
    end if;
    -- Alta manual sin vencimiento (residenciales anteriores al trial): no se toca.
    raise exception 'suscripcion_manual:activa_sin_vencimiento' using errcode = '22023';
  end if;
  if v_s.estado not in ('trialing', 'expired', 'canceled', 'past_due') then
    raise exception 'suscripcion_manual:estado_no_permite' using errcode = '22023', detail = v_s.estado;
  end if;

  v_hoy := (pg_catalog.now() at time zone v_zona)::date;
  if p_hasta < v_hoy then
    raise exception 'suscripcion_manual:fecha_pasada' using errcode = '22023';
  end if;
  if p_hasta > (v_hoy + interval '2 years')::date then
    raise exception 'suscripcion_manual:fecha_lejana' using errcode = '22023';
  end if;
  -- Activar durante una prueba vigente nunca acorta el acceso que ya tiene.
  if v_s.estado = 'trialing' and v_s.trial_ends_at > pg_catalog.now() and v_fin < v_s.trial_ends_at then
    raise exception 'suscripcion_manual:fecha_anterior' using errcode = '22023';
  end if;
  -- Un pago en curso con el proveedor no se pisa con una activación manual.
  if exists (select 1 from public.billing_checkouts c
             where c.tenant_id = p_tenant_id and c.estado = 'created' and c.expires_at > pg_catalog.now()) then
    raise exception 'suscripcion_manual:checkout_abierto' using errcode = '22023';
  end if;
  if p_plan is not null and public.billing_viviendas_requeridas(p_tenant_id) > public.billing_limite_plan(p_plan) then
    raise exception 'suscripcion_manual:plan_insuficiente' using errcode = '22023';
  end if;

  update public.suscripciones s set
    estado = 'active',
    origen = 'alta_manual',
    plan = p_plan,
    current_period_end = v_fin,
    cancel_at_period_end = true,
    impago_desde = null
  where s.id = v_s.id and s.tenant_id = p_tenant_id and s.estado = v_s.estado
    and s.provider is null and s.provider_subscription_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'suscripcion_manual:conflicto' using errcode = '40001';
  end if;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
  values (p_tenant_id, auth.uid(), 'superadmin.suscripcion_activada_manual', 'suscripciones', v_s.id,
          jsonb_build_object('estado', v_s.estado, 'origen', v_s.origen, 'plan', v_s.plan,
                             'trial_ends_at', v_s.trial_ends_at, 'current_period_end', v_s.current_period_end,
                             'cancel_at_period_end', v_s.cancel_at_period_end),
          jsonb_build_object('estado', 'active', 'origen', 'alta_manual', 'plan', p_plan,
                             'current_period_end', v_fin, 'cancel_at_period_end', true,
                             'hasta', p_hasta, 'zona_horaria', v_zona, 'cobro', 'ninguno'));

  return jsonb_build_object('resultado', 'aplicado', 'suscripcion_id', v_s.id, 'estado', 'active', 'current_period_end', v_fin);
end;
$$;


-- ── 3. Extender una activación manual ─────────────────────────
create function public.superadmin_extender_suscripcion_manual(p_tenant_id uuid, p_hasta date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.suscripciones;
  v_zona text;
  v_hoy date;
  v_fin timestamptz;
  v_n integer;
begin
  if not public.is_super_admin() then
    raise exception 'suscripcion_manual:no_autorizado' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_hasta is null then
    raise exception 'suscripcion_manual:parametros' using errcode = '22023';
  end if;

  select t.timezone into v_zona from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'suscripcion_manual:tenant_inexistente' using errcode = '22023';
  end if;
  select * into v_s from public.suscripciones s where s.tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'suscripcion_manual:sin_suscripcion' using errcode = '22023';
  end if;
  if v_s.provider is not null or v_s.provider_subscription_id is not null or v_s.provider_customer_id is not null then
    raise exception 'suscripcion_manual:gestionada_por_proveedor' using errcode = '22023',
      detail = coalesce(v_s.provider, 'proveedor');
  end if;
  if v_s.estado <> 'active' then
    raise exception 'suscripcion_manual:estado_no_permite' using errcode = '22023', detail = v_s.estado;
  end if;
  if not v_s.cancel_at_period_end or v_s.current_period_end is null then
    raise exception 'suscripcion_manual:activa_sin_vencimiento' using errcode = '22023';
  end if;

  v_fin := public.suscripcion_fin_dia_local(p_hasta, v_zona);
  if v_s.current_period_end = v_fin then
    return jsonb_build_object('resultado', 'sin_cambios', 'suscripcion_id', v_s.id, 'estado', v_s.estado,
                              'current_period_end', v_s.current_period_end);
  end if;
  v_hoy := (pg_catalog.now() at time zone v_zona)::date;
  if p_hasta < v_hoy then
    raise exception 'suscripcion_manual:fecha_pasada' using errcode = '22023';
  end if;
  if p_hasta > (v_hoy + interval '2 years')::date then
    raise exception 'suscripcion_manual:fecha_lejana' using errcode = '22023';
  end if;
  if v_fin < v_s.current_period_end then
    raise exception 'suscripcion_manual:fecha_anterior' using errcode = '22023';
  end if;

  update public.suscripciones s set current_period_end = v_fin
  where s.id = v_s.id and s.tenant_id = p_tenant_id and s.estado = 'active' and s.cancel_at_period_end
    and s.provider is null and s.provider_subscription_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'suscripcion_manual:conflicto' using errcode = '40001';
  end if;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
  values (p_tenant_id, auth.uid(), 'superadmin.suscripcion_vigencia_extendida', 'suscripciones', v_s.id,
          jsonb_build_object('estado', v_s.estado, 'origen', v_s.origen, 'current_period_end', v_s.current_period_end),
          jsonb_build_object('estado', 'active', 'origen', v_s.origen, 'current_period_end', v_fin,
                             'hasta', p_hasta, 'zona_horaria', v_zona, 'cobro', 'ninguno'));

  return jsonb_build_object('resultado', 'aplicado', 'suscripcion_id', v_s.id, 'estado', 'active', 'current_period_end', v_fin);
end;
$$;

comment on function public.superadmin_extender_trial(uuid, date) is
  'Super Admin: extiende la prueba (trialing, sin proveedor) hasta el fin del día local p_hasta. Auditada; misma fecha = sin_cambios.';
comment on function public.superadmin_activar_suscripcion_manual(uuid, date, text) is
  'Super Admin: activación administrativa sin cobro (active, alta_manual, vence al fin del día local p_hasta vía cancel_at_period_end). Nunca sobre una suscripción con proveedor. Auditada.';
comment on function public.superadmin_extender_suscripcion_manual(uuid, date) is
  'Super Admin: mueve hacia adelante el vencimiento de una activación manual (sin proveedor). Auditada; misma fecha = sin_cambios.';

revoke execute on function public.superadmin_extender_trial(uuid, date) from public, anon, service_role;
revoke execute on function public.superadmin_activar_suscripcion_manual(uuid, date, text) from public, anon, service_role;
revoke execute on function public.superadmin_extender_suscripcion_manual(uuid, date) from public, anon, service_role;
grant execute on function public.superadmin_extender_trial(uuid, date) to authenticated;
grant execute on function public.superadmin_activar_suscripcion_manual(uuid, date, text) to authenticated;
grant execute on function public.superadmin_extender_suscripcion_manual(uuid, date) to authenticated;
