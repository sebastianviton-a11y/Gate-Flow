-- ============================================================
-- Corrección 20261008300000: con A ya activo, un evento que combine el
-- checkout de A con la suscripción de B se RECHAZA (nunca se clasifica
-- como duplicada de A, que haría cancelar en Stripe la de B).
-- Solo corre con la corrección aplicada (fase BF del runner).
-- ============================================================

create or replace function tests.billing_orden_corregido() returns boolean language sql as $$
  select coalesce((select strpos(p.prosrc, 'suscripcion_de_otro_tenant') between 1 and strpos(p.prosrc, 'otra_suscripcion_vigente')
                   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'billing_aplicar_evento'), false);
$$;
grant execute on function tests.billing_orden_corregido() to anon, authenticated, service_role;

do $$ begin
  if not tests.billing_orden_corregido() then raise notice 'INFO|98_billing_otro_tenant omitido: corrección no aplicada'; end if;
end $$;

select tests.billing_orden_corregido() as hay_correccion \gset
\if :hay_correccion
begin;
update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
where tenant_id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000');
set local role service_role;
do $$
declare v_a uuid; v_b uuid;
begin
  v_a := tests.bc('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'hasta-50');
  perform public.billing_registrar_checkout_proveedor(v_a, 'cs_test_oA');
  v_b := tests.bc('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'hasta-50');
  perform public.billing_registrar_checkout_proveedor(v_b, 'cs_test_oB');
  perform tests.igual('BF-01', 'A se activa con su checkout', $q$select tests.ev('evt_oA', 'active', 'cs_test_oA', 'sub_oA')$q$, 'aplicado');
  perform tests.igual('BF-02', 'B se activa con su checkout', $q$select tests.ev('evt_oB', 'active', 'cs_test_oB', 'sub_oB')$q$, 'aplicado');
  perform tests.igual('BF-03', 'A activo + checkout de A con la suscripción de B → rechazado (no duplicada)',
    $q$select tests.ev('evt_oX', 'active', 'cs_test_oA', 'sub_oB')$q$, 'rechazado');
  perform tests.igual('BF-04', 'ídem con past_due → rechazado',
    $q$select tests.ev('evt_oY', 'past_due', 'cs_test_oA', 'sub_oB')$q$, 'rechazado');
  perform tests.igual('BF-05', 'la duplicada real (misma A, otra suscripción sin dueño) sigue siendo duplicada',
    $q$select tests.ev('evt_oZ', 'active', 'cs_test_oA', 'sub_oA_2')$q$, 'suscripcion_duplicada');
end $$;
reset role;
do $$ begin
  perform tests.igual('BF-06', 'motivo registrado y A/B intactos',
    $q$select (select string_agg(provider_event_id || ':' || coalesce(detalle->>'motivo', '-'), ',' order by provider_event_id) from public.billing_eventos where provider_event_id in ('evt_oX', 'evt_oY'))
       || ' ' || (select estado || '/' || provider_subscription_id from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000')
       || ' ' || (select estado || '/' || provider_subscription_id from public.suscripciones where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000')$q$,
    'evt_oX:suscripcion_de_otro_tenant,evt_oY:suscripcion_de_otro_tenant active/sub_oA active/sub_oB');
end $$;
rollback;
\endif
