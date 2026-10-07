-- ============================================================
-- tenant_operativo con billing (20261008200000): gracia de 7 días en
-- past_due y cancelación al final del periodo, con fronteras exactas.
-- Solo corre con la migración aplicada (fase OB del runner).
-- now() es estable dentro de la transacción: "now() - 7 días" es la
-- frontera exacta.
-- ============================================================

create or replace function tests.operativo_billing() returns boolean language sql as $$
  select coalesce(pg_get_functiondef(to_regprocedure('public.tenant_operativo(uuid)')) like '%past_due%', false);
$$;
grant execute on function tests.operativo_billing() to anon, authenticated, service_role;

do $$ begin
  if not tests.operativo_billing() then raise notice 'INFO|97_tenant_operativo_billing omitido: migración no aplicada'; end if;
end $$;

select tests.operativo_billing() as hay_operativo_billing \gset
\if :hay_operativo_billing

-- Prepara A con un estado de suscripción dado y mide tenant_operativo
-- como su admin_residencial y como su guardia.
create or replace function tests.op_billing(p_id text, p_desc text, p_estado text, p_cpe interval, p_cancel boolean, p_esperado boolean)
returns void language plpgsql as $$
declare v_admin boolean; v_guardia boolean;
begin
  update public.suscripciones set estado = p_estado, provider = 'stripe', plan = 'hasta-50', provider_subscription_id = 'sub_op',
         current_period_end = case when p_cpe is null then null else now() + p_cpe end, cancel_at_period_end = p_cancel
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.como('00000000-0000-0000-0000-00000000000a');
  set local role authenticated;
  v_admin := public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000');
  perform tests.como('00000000-0000-0000-0000-0000000000a9');
  v_guardia := public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000');
  reset role;
  if v_admin = p_esperado and v_guardia = p_esperado then
    perform tests.pass(p_id, p_desc || ' [' || p_esperado || ']');
  else
    perform tests.fail(p_id, p_desc, 'admin=' || v_admin || ' guardia=' || v_guardia || ', esperado ' || p_esperado);
  end if;
end $$;

begin;
do $$ begin
  if not tests.operativo_billing() then return; end if;
  -- active
  perform tests.op_billing('OB-01', 'active sin cancelación (periodo vigente)', 'active', interval '10 days', false, true);
  perform tests.op_billing('OB-02', 'active sin cancelación con periodo pasado (renovación en curso): sigue operativo', 'active', interval '-2 days', false, true);
  -- 30–31. cancelación al final del periodo
  perform tests.op_billing('OB-30', 'cancel_at_period_end antes del fin: operativo', 'active', interval '1 second', true, true);
  perform tests.op_billing('OB-31a', 'cancel_at_period_end en el instante exacto del fin: NO operativo', 'active', interval '0', true, false);
  perform tests.op_billing('OB-31b', 'cancel_at_period_end después del fin, sin webhook: NO operativo', 'active', interval '-1 second', true, false);
  -- 27–28. past_due con 7 días de gracia
  perform tests.op_billing('OB-27a', 'past_due recién vencido: operativo (gracia)', 'past_due', interval '-1 hour', false, true);
  perform tests.op_billing('OB-27b', 'past_due a 1 segundo de agotar la gracia: operativo', 'past_due', interval '-7 days' + interval '1 second', false, true);
  perform tests.op_billing('OB-28a', 'past_due en la frontera exacta de 7 días: bloqueado', 'past_due', interval '-7 days', false, false);
  perform tests.op_billing('OB-28b', 'past_due pasada la gracia: bloqueado', 'past_due', interval '-8 days', false, false);
  perform tests.op_billing('OB-28c', 'past_due sin fin de periodo: bloqueado (falla cerrado)', 'past_due', null, false, false);
  -- canceled / expired
  perform tests.op_billing('OB-32', 'canceled con periodo futuro: bloqueado', 'canceled', interval '10 days', false, false);
  perform tests.op_billing('OB-32b', 'expired: bloqueado', 'expired', interval '10 days', false, false);
end $$;
rollback;

-- trialing y alta manual no cambian.
begin;
do $$
declare v boolean;
begin
  if not tests.operativo_billing() then return; end if;
  update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '1 day', trial_ends_at = now() + interval '29 days'
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.como('00000000-0000-0000-0000-00000000000a');
  set local role authenticated;
  v := public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000');
  reset role;
  if v then perform tests.pass('OB-40', 'trial vigente sigue operativo'); else perform tests.fail('OB-40', 'trial vigente', 'false'); end if;
  update public.suscripciones set trial_ends_at = now() where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  set local role authenticated;
  v := public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000');
  reset role;
  if not v then perform tests.pass('OB-41', 'trial en su instante final: bloqueado (igual que antes)'); else perform tests.fail('OB-41', 'trial final', 'true'); end if;
  update public.suscripciones set estado = 'active', trial_started_at = null, trial_ends_at = null where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  set local role authenticated;
  v := public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000');
  reset role;
  if v then perform tests.pass('OB-42', 'active/alta_manual sin proveedor ni periodo: operativo (sin cambios)'); else perform tests.fail('OB-42', 'alta manual', 'false'); end if;
end $$;
rollback;

-- La gracia también vale para escribir (Guard registra paquetes) y
-- deja de valer al agotarse.
begin;
update public.suscripciones set estado = 'past_due', provider = 'stripe', plan = 'hasta-50', provider_subscription_id = 'sub_w',
       current_period_end = now() - interval '3 days'
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if not tests.operativo_billing() then return; end if;
  perform tests.debe_funcionar('OB-27c', 'gracia: el guardia registra un paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
end $$;
reset role;
update public.suscripciones set current_period_end = now() - interval '7 days' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set local role authenticated;
do $$ begin
  if not tests.operativo_billing() then return; end if;
  perform tests.debe_fallar('OB-28d', 'gracia agotada: el guardia ya no registra',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
end $$;
rollback;

do $$ begin
  if not tests.operativo_billing() then return; end if;
  perform tests.igual('OB-50', 'tenant_operativo conserva firma, DEFINER, search_path y grants',
    $q$select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), '-') || '/'
         || has_function_privilege('anon', p.oid, 'execute')::text || has_function_privilege('authenticated', p.oid, 'execute')::text
         || has_function_privilege('service_role', p.oid, 'execute')::text
       from pg_proc p where p.oid = 'public.tenant_operativo(uuid)'::regprocedure$q$, 'true/search_path=""/falsetruetrue');
end $$;
\endif
