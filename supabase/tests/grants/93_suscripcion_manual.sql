-- ============================================================
-- Suscripción manual de Super Admin (20261013000000) con los grants de
-- un proyecto Supabase nuevo (default privileges que dan EXECUTE a anon,
-- authenticated y service_role en cada función nueva). Los casos
-- completos están en tests/security/93_suscripcion_manual.sql.
-- ============================================================

do $$
begin
  if to_regprocedure('public.superadmin_activar_suscripcion_manual(uuid,date,text)') is null then
    raise notice 'INFO|93_suscripcion_manual (grants) omitido: migración no aplicada';
    return;
  end if;
  perform tests.igual('GSM-01', 'staging: EXECUTE de las tres funciones solo para authenticated (anon y service_role revocados pese a los default privileges)',
    $q$select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text
         || has_function_privilege('authenticated', p.oid, 'execute')::text
         || has_function_privilege('service_role', p.oid, 'execute')::text, ',' order by p.proname)
       from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('superadmin_extender_trial', 'superadmin_activar_suscripcion_manual', 'superadmin_extender_suscripcion_manual')$q$,
    'superadmin_activar_suscripcion_manual:falsetruefalse,superadmin_extender_suscripcion_manual:falsetruefalse,superadmin_extender_trial:falsetruefalse');
  perform tests.igual('GSM-02', 'staging: la auxiliar suscripcion_fin_dia_local no la ejecuta ningún rol de la API',
    $q$select has_function_privilege('anon', 'public.suscripcion_fin_dia_local(date,text)', 'execute')::text
         || has_function_privilege('authenticated', 'public.suscripcion_fin_dia_local(date,text)', 'execute')::text
         || has_function_privilege('service_role', 'public.suscripcion_fin_dia_local(date,text)', 'execute')::text$q$,
    'falsefalsefalse');
  perform tests.igual('GSM-03', 'staging: suscripciones sigue siendo de solo lectura para authenticated y cerrada para anon',
    $q$select string_agg(r || ':' || concat_ws(',',
         case when has_table_privilege(r, 'public.suscripciones', 'SELECT') then 'S' end,
         case when has_table_privilege(r, 'public.suscripciones', 'INSERT') then 'I' end,
         case when has_table_privilege(r, 'public.suscripciones', 'UPDATE') then 'U' end,
         case when has_table_privilege(r, 'public.suscripciones', 'DELETE') then 'D' end), ' ' order by r)
       from unnest(array['anon','authenticated']) r$q$,
    'anon: authenticated:S');
end $$;

-- Con los grants de staging: Super Admin activa; el admin del residencial no.
select to_regprocedure('public.superadmin_activar_suscripcion_manual(uuid,date,text)') is not null as hay_sm \gset
\if :hay_sm
begin;
update public.suscripciones set estado = 'trialing', origen = 'registro_publico', trial_started_at = now() - interval '40 days',
       trial_ends_at = now() - interval '1 day', current_period_end = null, cancel_at_period_end = false
where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
do $$
declare v jsonb; r text;
begin
  begin
    perform tests.como('00000000-0000-0000-0000-00000000000a');
    set local role authenticated;
    perform public.superadmin_activar_suscripcion_manual('aaaaaaaa-0000-0000-0000-000000000000', current_date + 30, null);
    r := 'ejecutó';
  exception when others then
    r := sqlstate || ':' || sqlerrm;
  end;
  perform tests.igual('GSM-10', 'staging: admin_residencial no puede activar (42501 no_autorizado)', format('select %L', r),
    '42501:suscripcion_manual:no_autorizado');
  perform tests.como('00000000-0000-0000-0000-000000000001');
  set local role authenticated;
  v := public.superadmin_activar_suscripcion_manual('aaaaaaaa-0000-0000-0000-000000000000', current_date + 30, null);
  reset role;
  perform tests.igual('GSM-11', 'staging: Super Admin activa manualmente (authenticated con su JWT)', format('select %L', v->>'resultado'), 'aplicado');
end $$;
rollback;
\endif
