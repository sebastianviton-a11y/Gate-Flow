-- ============================================================
-- Rollback de 20261009000000_billing_impago_desde.sql
-- Restaura billing_aplicar_evento (20261008300000) y tenant_operativo
-- (20261008200000) tal cual, con sus grants, y quita la columna.
-- Atención: tras el rollback la gracia de past_due vuelve a medirse desde
-- current_period_end (comportamiento anterior, defectuoso).
-- ============================================================

drop function public.billing_aplicar_evento(text, text, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text, bigint, text, timestamptz);

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

    -- Una suscripción del proveedor que ya es de OTRO residencial nunca
    -- se mueve (el tenant A no puede activar ni tocar a B, ni al revés).
    -- Va ANTES de clasificar duplicados: si no, la suscripción de B se
    -- trataría como "duplicada" de A y el servidor la cancelaría en el
    -- proveedor (20261008300000).
    if exists (select 1 from public.suscripciones o
               where o.provider = p_provider and o.provider_subscription_id = p_subscription_id
                 and o.tenant_id <> v_s.tenant_id) then
      v_resultado := 'rechazado';
      v_detalle := jsonb_build_object('motivo', 'suscripcion_de_otro_tenant');
      exit proceso;
    end if;

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

revoke execute on function public.billing_aplicar_evento(text, text, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text, bigint, text) from public, anon, authenticated;
grant execute on function public.billing_aplicar_evento(text, text, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text, bigint, text) to service_role;

create or replace function public.tenant_operativo(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_tenant_id is null then false
    when public.is_super_admin() then true
    else exists (
      select 1
      from public.user_tenants ut
      join public.tenants t on t.id = ut.tenant_id
      join public.suscripciones s on s.tenant_id = t.id
      where ut.user_id = auth.uid()
        and ut.activo = true
        and ut.tenant_id = p_tenant_id
        and t.estado_servicio in ('piloto', 'activo', 'cancelado')
        and (
          (s.estado = 'active'
            and (not s.cancel_at_period_end
                 or (s.current_period_end is not null and pg_catalog.now() < s.current_period_end)))
          or (s.estado = 'trialing' and s.trial_ends_at is not null and pg_catalog.now() < s.trial_ends_at)
          or (s.estado = 'past_due' and s.current_period_end is not null
              and pg_catalog.now() < s.current_period_end + interval '7 days')
        )
    )
  end;
$$;

comment on function public.tenant_operativo(uuid) is
  'true si quien llama puede operar el tenant: super_admin, o miembro activo de un tenant no suspendido con suscripción active (sin cancelación ya cumplida), trial vigente o past_due dentro de 7 días de gracia. Falla cerrado.';

alter table public.suscripciones drop constraint suscripciones_impago_desde_check;
alter table public.suscripciones drop column impago_desde;
