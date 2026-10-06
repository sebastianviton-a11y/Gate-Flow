-- ============================================================
-- Integridad multitenant con los grants de staging: la regla la
-- cumple la base para authenticated y no cambia ningún grant. Los
-- casos completos están en tests/security/90_integridad_multitenant.sql.
-- ============================================================

do $$
begin
  if to_regprocedure('public.fn_mt_casas()') is null then
    raise notice 'INFO|90_integridad_multitenant (grants) omitido: migración no aplicada';
    return;
  end if;
  perform tests.igual('GI-01', '15 FK compuestas validadas y 5 UNIQUE (id, tenant_id)',
    $q$select (select count(*) from pg_constraint where conname like 'fk\_mt\_%' and convalidated)::text || '|' || (select count(*) from pg_constraint where conname like 'uq\_mt\_%')::text$q$, '15|5');
  perform tests.igual('GI-02', 'funciones de trigger sin EXECUTE para anon/authenticated/service_role',
    $q$select count(*)::text from pg_proc p, unnest(array['anon','authenticated','service_role']) r
       where p.proname in ('fn_mt_catalogos_paquete','fn_mt_casas','fn_mt_departamentos') and has_function_privilege(r, p.oid, 'execute')$q$, '0');
end $$;

begin;
insert into public.user_tenants (user_id, tenant_id, rol_id)
select '00000000-0000-0000-0000-0000000000a9', 'bbbbbbbb-0000-0000-0000-000000000000', r.id from public.roles r where r.clave = 'guardia';
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_fallar('GI-10', 'staging: guardia en A y B no crea paquete de B con unidad de A',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '23503');
  perform tests.debe_funcionar('GI-11', 'staging: guardia en A y B registra en B con unidad de B',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
end $$;
rollback;
