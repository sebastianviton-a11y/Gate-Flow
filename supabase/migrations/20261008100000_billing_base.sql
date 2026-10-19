-- ============================================================
-- 20261008100000_billing_base.sql
--
-- Base de billing (V1: Stripe, México). public.suscripciones sigue
-- siendo la ÚNICA fuente de operación: el proveedor solo la cambia a
-- través de billing_aplicar_evento, llamado por el webhook verificado.
--
--   suscripciones (+7 columnas, todas nulas o con default para las
--                  filas existentes: trialing y active/alta_manual no
--                  cambian):
--     plan                      plan pagado (hasta-50 / hasta-150)
--     provider                  quién cobra (stripe)
--     provider_customer_id      cliente en el proveedor (portal de gestión)
--     provider_subscription_id  asocia los eventos de renovación/fallo/
--                               cancelación con el residencial
--     current_period_end        fin del periodo pagado: acceso hasta ahí
--                               si se canceló, y base de la gracia
--     cancel_at_period_end      cancelación pedida, efectiva al final
--     provider_version_at       instante del último estado aplicado:
--                               descarta snapshots más viejos
--   billing_checkouts   intento de pago creado por NUESTRO servidor. Su
--                       id viaja al proveedor (client_reference_id);
--                       la autoridad del tenant es esta fila, no la
--                       metadata del proveedor. monto en centavos.
--   billing_eventos     idempotencia (unique provider + event id) y
--                       rastro de cada evento verificado, sin payload ni
--                       datos personales.
--   billing_crear_checkout / billing_registrar_checkout_proveedor /
--   billing_aplicar_evento
--                       SECURITY DEFINER, search_path vacío, EXECUTE
--                       solo para service_role (las llama el servidor
--                       de Admin; el navegador nunca).
--
-- Sin grants para anon ni authenticated en las tablas nuevas.
-- No cambia tenant_operativo (eso es 20261008200000) ni tenants.
-- Rollback: supabase/rollback/20261008100000_billing_base.down.sql
-- ============================================================

-- ── 1. suscripciones ──────────────────────────────────────────
alter table public.suscripciones
  add column plan text,
  add column provider text,
  add column provider_customer_id text,
  add column provider_subscription_id text,
  add column current_period_end timestamptz,
  add column cancel_at_period_end boolean not null default false,
  add column provider_version_at timestamptz;

alter table public.suscripciones
  add constraint suscripciones_plan_check check (plan is null or plan in ('hasta-50', 'hasta-150')),
  add constraint suscripciones_provider_check check (provider is null or provider in ('stripe')),
  -- Una suscripción del proveedor siempre tiene proveedor y plan.
  add constraint suscripciones_proveedor_completo_check
    check (provider_subscription_id is null or (provider is not null and plan is not null)),
  -- "Cancelar al final" exige saber cuándo termina el periodo.
  add constraint suscripciones_cancelacion_periodo_check
    check (not cancel_at_period_end or current_period_end is not null);

-- Una suscripción del proveedor pertenece a un solo residencial.
create unique index uq_suscripciones_provider_subscription
  on public.suscripciones (provider, provider_subscription_id)
  where provider_subscription_id is not null;


-- ── 2. billing_checkouts ──────────────────────────────────────
create table public.billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.users (id),
  plan text not null check (plan in ('hasta-50', 'hasta-150')),
  provider text not null check (provider in ('stripe')),
  moneda text not null check (moneda ~ '^[A-Z]{3}$'),
  monto bigint not null check (monto > 0),
  provider_checkout_id text unique,
  provider_subscription_id text,
  estado text not null default 'created' check (estado in ('created', 'completed', 'expired', 'canceled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index idx_billing_checkouts_tenant on public.billing_checkouts (tenant_id, created_at desc);

alter table public.billing_checkouts enable row level security;
revoke all on public.billing_checkouts from public, anon, authenticated, service_role;


-- ── 3. billing_eventos ────────────────────────────────────────
create table public.billing_eventos (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe')),
  provider_event_id text not null,
  tipo text not null,
  tenant_id uuid references public.tenants (id) on delete set null,
  resultado text not null default 'recibido'
    check (resultado in ('recibido', 'aplicado', 'obsoleto', 'ignorado', 'sin_asociacion', 'rechazado', 'suscripcion_duplicada')),
  recibido_at timestamptz not null default now(),
  procesado_at timestamptz,
  detalle jsonb not null default '{}'::jsonb,
  constraint uq_billing_eventos_provider_event unique (provider, provider_event_id)
);
create index idx_billing_eventos_tenant on public.billing_eventos (tenant_id, recibido_at desc);

alter table public.billing_eventos enable row level security;
revoke all on public.billing_eventos from public, anon, authenticated, service_role;


-- ── 4. Reglas de plan (internas) ──────────────────────────────

-- Límite de viviendas de cada plan de autoservicio. La misma regla
-- vive en apps/admin/lib/billing/catalogo.ts (un test compara ambas).
create function public.billing_limite_plan(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan when 'hasta-50' then 50 when 'hasta-150' then 150 end;
$$;

-- Viviendas que cuenta el plan: max(declaradas en el registro,
-- unidades activas cargadas). Ninguna de las dos basta sola.
create function public.billing_viviendas_requeridas(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((select s.viviendas_declaradas from public.suscripciones s where s.tenant_id = p_tenant_id), 0),
    (select count(*)::integer from public.unidades u where u.tenant_id = p_tenant_id and u.activo)
  );
$$;

revoke execute on function public.billing_limite_plan(text) from public, anon, authenticated, service_role;
revoke execute on function public.billing_viviendas_requeridas(uuid) from public, anon, authenticated, service_role;


-- ── 5. billing_crear_checkout ─────────────────────────────────
-- La llama el servidor de Admin (service_role) con el usuario ya
-- autenticado y el tenant ya resuelto por gf_tenant; la base vuelve a
-- verificar todo. monto/moneda salen del catálogo del servidor (el
-- navegador solo elige plan). Errores con mensaje "billing:<código>".
create function public.billing_crear_checkout(
  p_user_id uuid,
  p_tenant_id uuid,
  p_plan text,
  p_provider text,
  p_moneda text,
  p_monto bigint,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.suscripciones;
  v_estado_servicio text;
  v_limite integer := public.billing_limite_plan(p_plan);
  v_requeridas integer;
  v_recientes integer;
  v_anteriores text[];
  v_id uuid;
begin
  if p_user_id is null or p_tenant_id is null or p_provider is null or p_moneda is null or p_monto is null or p_expires_at is null then
    raise exception 'billing:parametros' using errcode = '22023';
  end if;
  if v_limite is null then
    raise exception 'billing:plan' using errcode = '22023';
  end if;
  if p_expires_at < now() + interval '29 minutes' or p_expires_at > now() + interval '24 hours' then
    raise exception 'billing:parametros' using errcode = '22023';
  end if;

  -- Solo el admin_residencial (membresía activa) de ESTE residencial.
  if not exists (
    select 1 from public.user_tenants ut join public.roles r on r.id = ut.rol_id
    where ut.user_id = p_user_id and ut.tenant_id = p_tenant_id and ut.activo and r.clave = 'admin_residencial'
  ) then
    raise exception 'billing:rol' using errcode = '42501';
  end if;

  -- La fila de la suscripción serializa los checkouts del residencial.
  select * into v_s from public.suscripciones s where s.tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'billing:sin_suscripcion';
  end if;

  select t.estado_servicio into v_estado_servicio from public.tenants t where t.id = p_tenant_id;
  if v_estado_servicio is null or v_estado_servicio not in ('piloto', 'activo', 'cancelado') then
    raise exception 'billing:suspendido';
  end if;

  -- Se cobra solo cuando no hay nada vigente: trial vencido, expired,
  -- canceled, o "cancelar al final" ya cumplido. Durante el trial no
  -- se cobra; active/past_due se gestionan en el portal.
  if not (
       (v_s.estado = 'trialing' and v_s.trial_ends_at is not null and v_s.trial_ends_at <= now())
    or v_s.estado in ('expired', 'canceled')
    or (v_s.estado = 'active' and v_s.cancel_at_period_end and v_s.current_period_end <= now())
  ) then
    raise exception 'billing:estado_no_permite';
  end if;

  v_requeridas := public.billing_viviendas_requeridas(p_tenant_id);
  if v_requeridas > v_limite then
    raise exception 'billing:viviendas';
  end if;

  select count(*) into v_recientes from public.billing_checkouts c
  where c.tenant_id = p_tenant_id and c.created_at > now() - interval '1 hour';
  if v_recientes >= 10 then
    raise exception 'billing:limite_intentos';
  end if;

  -- Un solo checkout abierto por residencial: los vencidos pasan a
  -- expired y los demás abiertos se cancelan (el servidor los expira
  -- también en el proveedor).
  update public.billing_checkouts c set estado = 'expired'
  where c.tenant_id = p_tenant_id and c.estado = 'created' and c.expires_at <= now();
  with cancelados as (
    update public.billing_checkouts c set estado = 'canceled'
    where c.tenant_id = p_tenant_id and c.estado = 'created'
    returning c.provider_checkout_id
  )
  select coalesce(array_agg(provider_checkout_id) filter (where provider_checkout_id is not null), '{}') into v_anteriores from cancelados;

  insert into public.billing_checkouts (tenant_id, user_id, plan, provider, moneda, monto, expires_at)
  values (p_tenant_id, p_user_id, p_plan, p_provider, p_moneda, p_monto, p_expires_at)
  returning id into v_id;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_nuevos)
  values (p_tenant_id, p_user_id, 'billing.checkout_iniciado', 'billing_checkouts', v_id,
          jsonb_build_object('plan', p_plan, 'provider', p_provider, 'moneda', p_moneda, 'monto', p_monto,
                             'viviendas_requeridas', v_requeridas));

  return jsonb_build_object('checkout_id', v_id, 'anteriores', to_jsonb(v_anteriores), 'viviendas_requeridas', v_requeridas);
end;
$$;


-- ── 6. billing_registrar_checkout_proveedor ───────────────────
create function public.billing_registrar_checkout_proveedor(p_checkout_id uuid, p_provider_checkout_id text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_checkout_id is null or nullif(btrim(p_provider_checkout_id), '') is null then
    raise exception 'billing:parametros' using errcode = '22023';
  end if;
  update public.billing_checkouts c set provider_checkout_id = p_provider_checkout_id
  where c.id = p_checkout_id and c.provider_checkout_id is null and c.estado = 'created';
  if not found then
    raise exception 'billing:checkout_no_registrable';
  end if;
end;
$$;


-- ── 7. billing_aplicar_evento ─────────────────────────────────
-- Una transacción por evento verificado:
--   registrar evento (si ya existía → duplicado, sin efectos)
--   → asociar: checkout NUESTRO (provider_checkout_id) o
--     provider_subscription_id ya guardado → tenant
--   → SELECT suscripción FOR UPDATE (serializa eventos concurrentes)
--   → identidad de la suscripción, versión, monto
--   → transición + auditoría → resultado del evento.
-- p_estado es el estado YA normalizado por el servidor a partir del
-- recurso consultado de nuevo al proveedor:
--   active | past_due | canceled | checkout_expirado | ignorar
-- p_monto en centavos; p_version_at = instante de esa consulta.
create function public.billing_aplicar_evento(
  p_provider text,
  p_event_id text,
  p_tipo text,
  p_estado text,
  p_provider_checkout_id text,
  p_client_reference_id text,
  p_subscription_id text,
  p_customer_id text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_version_at timestamptz,
  p_moneda text,
  p_monto bigint,
  p_intervalo text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid;
  v_checkout public.billing_checkouts;
  v_s public.suscripciones;
  v_tenant uuid;
  v_resultado text;
  v_detalle jsonb := '{}'::jsonb;
  v_nuevo text;
  v_accion text;
  v_exceso boolean := false;
  v_vigente boolean;
begin
  if p_provider is null or nullif(btrim(p_event_id), '') is null or p_tipo is null or p_version_at is null
     or p_estado is null or p_estado not in ('active', 'past_due', 'canceled', 'checkout_expirado', 'ignorar') then
    raise exception 'billing:parametros' using errcode = '22023';
  end if;

  insert into public.billing_eventos (provider, provider_event_id, tipo)
  values (p_provider, p_event_id, p_tipo)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_evento;
  if v_evento is null then
    -- Sin efectos. Devuelve el resultado original para que el servidor
    -- pueda reintentar lo que quedó pendiente fuera de la base (p. ej.
    -- cancelar en el proveedor una suscripción duplicada).
    return jsonb_build_object('resultado', 'duplicado', 'resultado_original',
      (select e.resultado from public.billing_eventos e where e.provider = p_provider and e.provider_event_id = p_event_id));
  end if;

  <<proceso>>
  begin
    if p_estado = 'ignorar' then
      v_resultado := 'ignorado';
      exit proceso;
    end if;

    -- Asociación: primero el checkout que creó NUESTRO servidor.
    if p_provider_checkout_id is not null then
      select * into v_checkout from public.billing_checkouts c
      where c.provider = p_provider and c.provider_checkout_id = p_provider_checkout_id
      for update;
      if not found then
        v_resultado := 'sin_asociacion';
        v_detalle := jsonb_build_object('motivo', 'checkout_desconocido');
        exit proceso;
      end if;
      if p_client_reference_id is not null and p_client_reference_id <> v_checkout.id::text then
        v_resultado := 'rechazado';
        v_detalle := jsonb_build_object('motivo', 'referencia_no_coincide');
        exit proceso;
      end if;
      v_tenant := v_checkout.tenant_id;
    end if;

    if p_estado = 'checkout_expirado' then
      if v_checkout.id is null then
        v_resultado := 'sin_asociacion';
        exit proceso;
      end if;
      update public.billing_checkouts c set estado = 'expired' where c.id = v_checkout.id and c.estado = 'created';
      v_resultado := 'aplicado';
      v_detalle := jsonb_build_object('checkout', 'expirado');
      exit proceso;
    end if;

    if nullif(btrim(p_subscription_id), '') is null then
      v_resultado := 'rechazado';
      v_detalle := jsonb_build_object('motivo', 'sin_suscripcion_proveedor');
      exit proceso;
    end if;

    if v_tenant is not null then
      select * into v_s from public.suscripciones s where s.tenant_id = v_tenant for update;
    else
      select * into v_s from public.suscripciones s
      where s.provider = p_provider and s.provider_subscription_id = p_subscription_id
      for update;
    end if;
    if v_s.id is null then
      v_resultado := 'sin_asociacion';
      v_detalle := jsonb_build_object('motivo', 'suscripcion_desconocida');
      exit proceso;
    end if;
    v_tenant := v_s.tenant_id;

    -- ¿El residencial ya tiene OTRA suscripción del proveedor?
    if v_s.provider_subscription_id is not null and v_s.provider_subscription_id <> p_subscription_id then
      v_vigente := v_s.estado = 'past_due'
                   or (v_s.estado = 'active' and not (v_s.cancel_at_period_end and v_s.current_period_end <= now()));
      if v_vigente then
        -- Nunca se pisa la suscripción vigente: la nueva es un duplicado
        -- (dos pagos simultáneos). El servidor la cancela en el proveedor.
        v_resultado := case when p_estado in ('active', 'past_due') then 'suscripcion_duplicada' else 'ignorado' end;
        v_detalle := jsonb_build_object('motivo', 'otra_suscripcion_vigente');
        exit proceso;
      end if;
      -- La anterior terminó: solo un checkout nuestro, ya pagado, la reemplaza.
      if v_checkout.id is null or p_estado <> 'active' then
        v_resultado := 'ignorado';
        v_detalle := jsonb_build_object('motivo', 'suscripcion_anterior');
        exit proceso;
      end if;
    end if;

    -- Una suscripción del proveedor que ya es de OTRO residencial nunca
    -- se mueve (el tenant A no puede activar ni tocar a B, ni al revés).
    if exists (select 1 from public.suscripciones o
               where o.provider = p_provider and o.provider_subscription_id = p_subscription_id
                 and o.tenant_id <> v_s.tenant_id) then
      v_resultado := 'rechazado';
      v_detalle := jsonb_build_object('motivo', 'suscripcion_de_otro_tenant');
      exit proceso;
    end if;

    -- Nunca se asocia algo que no llegó a pagarse.
    if v_s.provider_subscription_id is null and p_estado <> 'active' then
      v_resultado := 'ignorado';
      v_detalle := jsonb_build_object('motivo', 'sin_activacion_previa');
      exit proceso;
    end if;

    -- Snapshot más viejo que el último aplicado.
    if v_s.provider_version_at is not null and p_version_at <= v_s.provider_version_at
       and v_s.provider_subscription_id = p_subscription_id then
      v_resultado := 'obsoleto';
      exit proceso;
    end if;

    -- Pasar a active exige el checkout que la originó y el mismo monto,
    -- moneda e intervalo que fijó nuestro servidor.
    if p_estado = 'active' then
      if v_checkout.id is null then
        v_resultado := 'rechazado';
        v_detalle := jsonb_build_object('motivo', 'sin_checkout');
        exit proceso;
      end if;
      if v_checkout.tenant_id <> v_s.tenant_id then
        v_resultado := 'rechazado';
        v_detalle := jsonb_build_object('motivo', 'tenant_no_coincide');
        exit proceso;
      end if;
      if p_moneda is distinct from v_checkout.moneda or p_monto is distinct from v_checkout.monto
         or p_intervalo is distinct from 'month' then
        v_resultado := 'rechazado';
        v_detalle := jsonb_build_object('motivo', 'monto_no_coincide');
        exit proceso;
      end if;
      if v_checkout.provider_subscription_id is not null and v_checkout.provider_subscription_id <> p_subscription_id then
        v_resultado := 'rechazado';
        v_detalle := jsonb_build_object('motivo', 'checkout_de_otra_suscripcion');
        exit proceso;
      end if;
      if p_current_period_end is null then
        v_resultado := 'rechazado';
        v_detalle := jsonb_build_object('motivo', 'sin_periodo');
        exit proceso;
      end if;
      v_exceso := public.billing_viviendas_requeridas(v_s.tenant_id) > public.billing_limite_plan(v_checkout.plan);
    end if;

    v_nuevo := p_estado;
    update public.suscripciones s set
      estado = v_nuevo,
      provider = p_provider,
      provider_subscription_id = p_subscription_id,
      provider_customer_id = coalesce(p_customer_id, s.provider_customer_id),
      plan = coalesce(v_checkout.plan, s.plan),
      current_period_end = coalesce(p_current_period_end, s.current_period_end),
      cancel_at_period_end = case when v_nuevo = 'canceled' then false
                                  else coalesce(p_cancel_at_period_end, false) and coalesce(p_current_period_end, s.current_period_end) is not null end,
      provider_version_at = p_version_at
    where s.id = v_s.id;

    if v_checkout.id is not null and v_nuevo = 'active' then
      update public.billing_checkouts c set estado = 'completed', provider_subscription_id = p_subscription_id
      where c.id = v_checkout.id;
    end if;

    v_accion := case
      when v_nuevo = 'active' and v_s.estado = 'past_due' and v_s.provider_subscription_id = p_subscription_id then 'billing.pago_recuperado'
      when v_nuevo = 'active' and (v_s.estado <> 'active' or v_s.provider_subscription_id is distinct from p_subscription_id) then 'billing.suscripcion_activada'
      when v_nuevo = 'past_due' and v_s.estado <> 'past_due' then 'billing.pago_fallido'
      when v_nuevo = 'canceled' and v_s.estado <> 'canceled' then 'billing.suscripcion_cancelada'
      when v_nuevo = 'active' and coalesce(p_cancel_at_period_end, false) and not v_s.cancel_at_period_end then 'billing.cancelacion_solicitada'
      when v_nuevo = 'active' and not coalesce(p_cancel_at_period_end, false) and v_s.cancel_at_period_end then 'billing.cancelacion_revertida'
      when v_nuevo = 'active' and p_current_period_end > v_s.current_period_end then 'billing.periodo_renovado'
    end;
    if v_accion is not null then
      insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
      values (v_s.tenant_id, null, v_accion, 'suscripciones', v_s.id,
              jsonb_build_object('estado', v_s.estado, 'plan', v_s.plan, 'current_period_end', v_s.current_period_end,
                                 'cancel_at_period_end', v_s.cancel_at_period_end),
              jsonb_build_object('estado', v_nuevo, 'plan', coalesce(v_checkout.plan, v_s.plan), 'current_period_end',
                                 coalesce(p_current_period_end, v_s.current_period_end),
                                 'cancel_at_period_end', coalesce(p_cancel_at_period_end, false), 'provider', p_provider,
                                 'viviendas_exceden_plan', v_exceso));
    end if;

    v_resultado := 'aplicado';
    v_detalle := jsonb_build_object('estado_anterior', v_s.estado, 'estado_nuevo', v_nuevo, 'viviendas_exceden_plan', v_exceso);
  end proceso;

  update public.billing_eventos e set
    resultado = v_resultado,
    tenant_id = v_tenant,
    procesado_at = now(),
    detalle = v_detalle
  where e.id = v_evento;

  return jsonb_build_object('resultado', v_resultado, 'tenant_id', v_tenant) || v_detalle;
end;
$$;

revoke execute on function public.billing_crear_checkout(uuid, uuid, text, text, text, bigint, timestamptz) from public, anon, authenticated;
revoke execute on function public.billing_registrar_checkout_proveedor(uuid, text) from public, anon, authenticated;
revoke execute on function public.billing_aplicar_evento(text, text, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text, bigint, text) from public, anon, authenticated;
grant execute on function public.billing_crear_checkout(uuid, uuid, text, text, text, bigint, timestamptz) to service_role;
grant execute on function public.billing_registrar_checkout_proveedor(uuid, text) to service_role;
grant execute on function public.billing_aplicar_evento(text, text, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text, bigint, text) to service_role;
