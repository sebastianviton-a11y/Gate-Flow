-- ============================================================
-- Billing con los grants de staging: las tablas nuevas no tienen
-- grants para ningún rol de la API y el flujo del servidor
-- (service_role) funciona solo por las RPC. Los casos completos están
-- en tests/security/96_billing.sql y 97_tenant_operativo_billing.sql.
-- ============================================================

do $$
begin
  if to_regclass('public.billing_eventos') is null then
    raise notice 'INFO|96_billing (grants) omitido: migración no aplicada';
    return;
  end if;
  perform tests.igual('GB-01', 'staging: ningún privilegio de anon/authenticated/service_role sobre billing_checkouts y billing_eventos',
    $q$select count(*)::text from unnest(array['anon','authenticated','service_role']) r,
              unnest(array['public.billing_checkouts','public.billing_eventos']) t,
              unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
       where has_table_privilege(r, t, p)$q$, '0');
  perform tests.igual('GB-02', 'staging: suscripciones sigue siendo solo SELECT para authenticated y nada para service_role',
    $q$select concat_ws(',', case when has_table_privilege('authenticated', 'public.suscripciones', 'SELECT') then 'S' end,
                              case when has_table_privilege('authenticated', 'public.suscripciones', 'UPDATE') then 'U' end)
       || '/' || concat_ws(',', case when has_table_privilege('service_role', 'public.suscripciones', 'SELECT') then 'S' end,
                                case when has_table_privilege('service_role', 'public.suscripciones', 'UPDATE') then 'U' end)$q$, 'S/');
  perform tests.igual('GB-03', 'staging: las 3 RPC de billing solo para service_role',
    $q$select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text
         || has_function_privilege('authenticated', p.oid, 'execute')::text || has_function_privilege('service_role', p.oid, 'execute')::text, ',' order by p.proname)
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'billing\_%'
         and p.proname not in ('billing_limite_plan', 'billing_viviendas_requeridas')$q$,
    'billing_aplicar_evento:falsefalsetrue,billing_crear_checkout:falsefalsetrue,billing_registrar_checkout_proveedor:falsefalsetrue');
end $$;

-- El flujo del servidor completo con los grants mínimos de staging.
begin;
do $$ begin
  if to_regclass('public.billing_eventos') is null then return; end if;
  update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
end $$;
set local role service_role;
do $$
declare v_c uuid; v_r jsonb;
begin
  if to_regclass('public.billing_eventos') is null then return; end if;
  v_c := (public.billing_crear_checkout('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50', 'stripe', 'MXN', 49900, now() + interval '1 hour')->>'checkout_id')::uuid;
  perform public.billing_registrar_checkout_proveedor(v_c, 'cs_test_staging');
  v_r := public.billing_aplicar_evento('stripe', 'evt_staging', 'checkout.session.completed', 'active', 'cs_test_staging', v_c::text,
                                       'sub_staging', 'cus_staging', now() + interval '30 days', false, clock_timestamp(), 'MXN', 49900, 'month');
  if v_r->>'resultado' = 'aplicado' then
    perform tests.pass('GB-10', 'staging: service_role crea checkout, lo registra y el webhook activa, solo con las RPC');
  else
    perform tests.fail('GB-10', 'staging: flujo del servidor', v_r::text);
  end if;
end $$;
reset role;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regclass('public.billing_eventos') is null then return; end if;
  perform tests.igual('GB-11', 'staging: el admin lee su suscripción activada y vuelve a operar',
    $q$select estado || '/' || plan || '/' || public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text
       from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'active/hasta-50/true');
end $$;
rollback;

-- 20261009000000: con los grants de staging, el webhook (service_role)
-- abre el episodio de impago solo por la RPC y el admin lee impago_desde
-- (Admin y packages/auth lo seleccionan para la gracia y el aviso).
begin;
do $$ begin
  if to_regprocedure('public.billing_aplicar_evento(text,text,text,text,text,text,text,text,timestamptz,boolean,timestamptz,text,bigint,text,timestamptz,text)') is null then
    raise notice 'INFO|96_billing (grants, impago_desde) omitido: migración no aplicada';
    return;
  end if;
  update public.suscripciones set estado = 'active', provider = 'stripe', plan = 'hasta-50', provider_subscription_id = 'sub_gim',
         current_period_end = now() + interval '28 days'
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.igual('GB-20', 'staging: authenticated puede leer impago_desde; ningún rol de la API puede escribirlo',
    $q$select has_column_privilege('authenticated', 'public.suscripciones', 'impago_desde', 'SELECT')::text || '/'
         || (select count(*)::text from unnest(array['anon','authenticated','service_role']) r
             where has_column_privilege(r, 'public.suscripciones', 'impago_desde', 'UPDATE')
                or has_column_privilege(r, 'public.suscripciones', 'impago_desde', 'INSERT'))$q$, 'true/0');
end $$;
set local role service_role;
do $$
declare v_r jsonb;
begin
  if to_regprocedure('public.billing_aplicar_evento(text,text,text,text,text,text,text,text,timestamptz,boolean,timestamptz,text,bigint,text,timestamptz,text)') is null then return; end if;
  v_r := public.billing_aplicar_evento('stripe', 'evt_gim', 'invoice.payment_failed', 'past_due', null, null, 'sub_gim', 'cus_gim',
                                       now() + interval '28 days', false, clock_timestamp(), 'MXN', 49900, 'month', now() - interval '2 days', 'past_due');
  if v_r->>'resultado' = 'aplicado' then
    perform tests.pass('GB-21', 'staging: service_role abre el episodio de impago por la RPC de 16 argumentos');
  else
    perform tests.fail('GB-21', 'staging: RPC con impago', v_r::text);
  end if;
end $$;
reset role;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.billing_aplicar_evento(text,text,text,text,text,text,text,text,timestamptz,boolean,timestamptz,text,bigint,text,timestamptz,text)') is null then return; end if;
  perform tests.igual('GB-22', 'staging: el admin lee past_due + impago_desde (−48 h) y opera en gracia aunque el periodo termine en +28 d',
    $q$select estado || '/' || round(extract(epoch from impago_desde - now()) / 3600)::text || '/' || public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text
       from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'past_due/-48/true');
end $$;
rollback;
