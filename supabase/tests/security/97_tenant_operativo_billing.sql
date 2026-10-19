-- ============================================================
-- tenant_operativo con billing (20261008200000): gracia de 7 días en
-- past_due y cancelación al final del periodo, con fronteras exactas.
-- Solo corre con la migración aplicada (fases OB, BF e IM del runner).
-- Con 20261009000000 (fase IM) la gracia se mide desde
-- suscripciones.impago_desde (inicio del impago) y ya NO desde
-- current_period_end, que Stripe adelanta al periodo impago: los casos
-- de past_due de esa fase usan un fin de periodo FUTURO a propósito.
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

-- ¿Está aplicada 20261009000000 (gracia desde impago_desde)?
create or replace function tests.hay_impago() returns boolean language sql as $$
  select exists (select 1 from pg_attribute where attrelid = 'public.suscripciones'::regclass and attname = 'impago_desde' and not attisdropped);
$$;
grant execute on function tests.hay_impago() to anon, authenticated, service_role;

-- Prepara A con un estado de suscripción dado y mide tenant_operativo
-- como su admin_residencial y como su guardia. p_impago (solo fase IM):
-- inicio del impago relativo a now(); null = sin fecha fiable.
create or replace function tests.op_billing(p_id text, p_desc text, p_estado text, p_cpe interval, p_cancel boolean, p_esperado boolean,
                                            p_impago interval default null)
returns void language plpgsql as $$
declare v_admin boolean; v_guardia boolean;
begin
  if tests.hay_impago() then
    -- Una sola sentencia: el check exige impago_desde null fuera de past_due.
    execute $u$update public.suscripciones set estado = $1, provider = 'stripe', plan = 'hasta-50', provider_subscription_id = 'sub_op',
                   current_period_end = $2, cancel_at_period_end = $3, impago_desde = $4
              where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$u$
      using p_estado, case when p_cpe is null then null else now() + p_cpe end, p_cancel,
            case when p_estado = 'past_due' and p_impago is not null then now() + p_impago end;
  else
    update public.suscripciones set estado = p_estado, provider = 'stripe', plan = 'hasta-50', provider_subscription_id = 'sub_op',
           current_period_end = case when p_cpe is null then null else now() + p_cpe end, cancel_at_period_end = p_cancel
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  end if;
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

-- A en past_due "desde hace p": en fase IM, impago_desde = now() + p con
-- el fin de periodo ya adelantado (+30 días, como deja Stripe una
-- renovación fallida); antes de IM, la regla vieja (fin de periodo = now() + p).
create or replace function tests.past_due_desde(p interval) returns void language plpgsql as $$
begin
  if tests.hay_impago() then
    execute $u$update public.suscripciones set estado = 'past_due', provider = 'stripe', plan = 'hasta-50', provider_subscription_id = 'sub_w',
                   current_period_end = now() + interval '30 days', impago_desde = now() + $1
              where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$u$ using p;
  else
    update public.suscripciones set estado = 'past_due', provider = 'stripe', plan = 'hasta-50', provider_subscription_id = 'sub_w',
           current_period_end = now() + p
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
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
  if tests.hay_impago() then
    -- Fase IM: gracia desde impago_desde; el fin de periodo es FUTURO
    -- (renovación fallida real) y no debe extender nada.
    perform tests.op_billing('OB-27a', 'past_due: impago desde hace 1 h, periodo +30 d: operativo (gracia)', 'past_due', interval '30 days', false, true, interval '-1 hour');
    perform tests.op_billing('OB-27b', 'past_due: a 1 s de agotar los 7 días desde el impago: operativo', 'past_due', interval '30 days', false, true, interval '-7 days' + interval '1 second');
    perform tests.op_billing('OB-28a', 'REGRESIÓN: impago hace 7 d exactos con periodo +30 d: bloqueado', 'past_due', interval '30 days', false, false, interval '-7 days');
    perform tests.op_billing('OB-28b', 'past_due: impago hace 8 d con periodo +30 d: bloqueado', 'past_due', interval '30 days', false, false, interval '-8 days');
    perform tests.op_billing('OB-28c', 'past_due sin inicio de impago y periodo +30 d: bloqueado (falla cerrado)', 'past_due', interval '30 days', false, false, null);
    perform tests.op_billing('OB-28e', 'past_due sin inicio de impago ni periodo: bloqueado', 'past_due', null, false, false, null);
    perform tests.op_billing('OB-28f', 'past_due: el fin de periodo no cuenta (impago hace 3 d, sin periodo): operativo', 'past_due', null, false, true, interval '-3 days');
    perform tests.op_billing('OB-28g', 'past_due: cancel_at_period_end no reabre la gracia agotada', 'past_due', interval '30 days', true, false, interval '-8 days');
  else
    perform tests.op_billing('OB-27a', 'past_due recién vencido: operativo (gracia)', 'past_due', interval '-1 hour', false, true);
    perform tests.op_billing('OB-27b', 'past_due a 1 segundo de agotar la gracia: operativo', 'past_due', interval '-7 days' + interval '1 second', false, true);
    perform tests.op_billing('OB-28a', 'past_due en la frontera exacta de 7 días: bloqueado', 'past_due', interval '-7 days', false, false);
    perform tests.op_billing('OB-28b', 'past_due pasada la gracia: bloqueado', 'past_due', interval '-8 days', false, false);
    perform tests.op_billing('OB-28c', 'past_due sin fin de periodo: bloqueado (falla cerrado)', 'past_due', null, false, false);
  end if;
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
select tests.past_due_desde(interval '-3 days');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if not tests.operativo_billing() then return; end if;
  perform tests.debe_funcionar('OB-27c', 'gracia: el guardia registra un paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
end $$;
reset role;
select tests.past_due_desde(interval '-7 days');
set local role authenticated;
do $$ begin
  if not tests.operativo_billing() then return; end if;
  perform tests.debe_fallar('OB-28d', 'gracia agotada: el guardia ya no registra',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
end $$;
rollback;

-- Fase IM: la definición ya no lee current_period_end en la rama past_due
-- y la columna tiene su check (impago_desde solo en past_due).
do $$ begin
  if not tests.operativo_billing() or not tests.hay_impago() then return; end if;
  perform tests.igual('OB-51', 'tenant_operativo usa impago_desde + 7 días',
    $q$select (pg_get_functiondef('public.tenant_operativo(uuid)'::regprocedure) like '%impago_desde + %7 days%')::text$q$, 'true');
  perform tests.igual('OB-52', 'check: impago_desde solo con estado past_due',
    $q$select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = 'public.suscripciones'::regclass and c.conname = 'suscripciones_impago_desde_check'$q$,
    'CHECK (((impago_desde IS NULL) OR (estado = ''past_due''::text)))');
end $$;

do $$ begin
  if not tests.operativo_billing() then return; end if;
  perform tests.igual('OB-50', 'tenant_operativo conserva firma, DEFINER, search_path y grants',
    $q$select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), '-') || '/'
         || has_function_privilege('anon', p.oid, 'execute')::text || has_function_privilege('authenticated', p.oid, 'execute')::text
         || has_function_privilege('service_role', p.oid, 'execute')::text
       from pg_proc p where p.oid = 'public.tenant_operativo(uuid)'::regprocedure$q$, 'true/search_path=""/falsetruetrue');
end $$;
\endif
