-- ============================================================
-- tenant_operativo en el mundo de mínimo privilegio (staging): la
-- función y las políticas restrictivas con los grants reales de
-- staging, y que la operación normal sigue funcionando. Los casos de
-- negocio completos (25–39) están en tests/security/80_tenant_operativo.sql.
-- Solo corre con la migración aplicada.
-- ============================================================

create or replace function tests.suscripcion(p_tenant uuid, p_estado text) returns void
language plpgsql as $$
begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  if p_estado = 'trial_vencido' then
    update public.suscripciones
    set estado = 'trialing', trial_started_at = now() - interval '31 days', trial_ends_at = now() - interval '1 day'
    where tenant_id = p_tenant;
  else
    update public.suscripciones
    set estado = p_estado, trial_started_at = null, trial_ends_at = null
    where tenant_id = p_tenant;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then
    raise notice 'INFO|80_tenant_operativo (grants) omitido: migración no aplicada';
    return;
  end if;
  perform tests.igual('GO-01', 'tenant_operativo: DEFINER, search_path vacío; EXECUTE auth y service_role, no anon',
    $q$select prosecdef::text || '|' || coalesce(array_to_string(proconfig, ','), '-')
         || '|anon=' || has_function_privilege('anon', oid, 'execute')
         || ',auth=' || has_function_privilege('authenticated', oid, 'execute')
         || ',svc=' || has_function_privilege('service_role', oid, 'execute')
       from pg_proc where oid = 'public.tenant_operativo(uuid)'::regprocedure$q$,
    'true|search_path=""|anon=false,auth=true,svc=true');
  perform tests.igual('GO-02', '61 políticas restrictivas de escritura',
    $q$select count(*)::text from pg_policies where permissive = 'RESTRICTIVE' and policyname like '%\_operativo\_%' and cmd in ('INSERT','UPDATE','DELETE')$q$, '61');
  perform tests.igual('GO-03', 'la migración no cambia ningún grant de tabla',
    $q$select count(*)::text from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
         and has_table_privilege('anon', c.oid, 'INSERT')$q$, '0');
  perform tests.igual('GO-04', 'entregar_paquete conserva su EXECUTE (invoker, sin cambio de grants)',
    $q$select prosecdef::text || '|' || has_function_privilege('authenticated', 'public.entregar_paquete(uuid,uuid,text)', 'execute')::text
       from pg_proc where oid = 'public.entregar_paquete(uuid,uuid,text)'::regprocedure$q$, 'false|true');
end $$;

-- Operación normal (active) con los grants de staging.
begin;
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_funcionar('GO-10', 'active: el guardia registra un paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
  perform tests.debe_funcionar('GO-11', 'active: el guardia entrega (RPC)',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$);
end $$;
rollback;

-- Trial vencido con los grants de staging.
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_fallar('GO-20', 'vencido: el guardia no registra paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
  perform tests.debe_fallar('GO-21', 'vencido: el guardia no entrega (RPC)',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$, '42501');
  perform tests.debe_fallar('GO-22', 'vencido: el guardia no crea incidencia',
    $q$insert into public.incidencias (tenant_id, paquete_id, tipo, reportada_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'otro', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
  perform tests.igual('GO-23', 'vencido: el guardia sigue leyendo sus paquetes',
    $q$select (count(*) > 0)::text from public.paquetes where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'true');
end $$;
rollback;

begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.filas('GO-24', 'vencido: el admin no edita la configuración del residencial',
    $q$update public.tenants set nombre = 'X' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.filas('GO-25', 'vencido: el admin no borra ubicaciones',
    $q$delete from public.ubicaciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.filas('GO-26', 'vencido: el admin todavía puede desactivar a un guardia',
    $q$update public.user_tenants set activo = false where user_id = '00000000-0000-0000-0000-0000000000a9' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 1);
end $$;
rollback;
