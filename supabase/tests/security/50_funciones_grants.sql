-- ============================================================
-- Endurecimiento de funciones y grants.
--   * search_path = '' en todas las funciones del camino de privilegios
--   * SECURITY DEFINER solo donde hace falta; otorgar_membresia es INVOKER
--   * EXECUTE solo para los roles necesarios
--   * user_tenants: desde el cliente, solo UPDATE (activo)
--   * suplantación con tablas temporales: sin efecto
-- ============================================================

-- F-01: search_path vacío en las funciones del camino de privilegios.
select tests.igual('F-01', 'funciones de privilegios con search_path='''' (vacío)',
  $$select coalesce(string_agg(p.proname, ',' order by p.proname), 'todas ok')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('current_tenant_ids','is_super_admin','has_role_in_tenant','otorgar_membresia',
                        'handle_new_auth_user','vincular_membresia_heredada','fn_tenant_id_inmutable')
      and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=""%', false)$$, 'todas ok');

-- F-02: SECURITY DEFINER / INVOKER según el plan.
select tests.igual('F-02', 'DEFINER: helpers RLS y triggers de alta; INVOKER: otorgar_membresia e inmutabilidad',
  $$select string_agg(p.proname || '=' || case when p.prosecdef then 'definer' else 'invoker' end, ',' order by p.proname)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('current_tenant_ids','is_super_admin','has_role_in_tenant','otorgar_membresia',
                        'handle_new_auth_user','fn_tenant_id_inmutable')$$,
  'current_tenant_ids=definer,fn_tenant_id_inmutable=invoker,handle_new_auth_user=definer,'
  || 'has_role_in_tenant=definer,is_super_admin=definer,otorgar_membresia=invoker');

-- F-03: STABLE en los helpers de solo lectura.
select tests.igual('F-03', 'helpers RLS marcados STABLE',
  $$select string_agg(proname || '=' || provolatile::text, ',' order by proname) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('current_tenant_ids','is_super_admin','has_role_in_tenant')$$,
  'current_tenant_ids=s,has_role_in_tenant=s,is_super_admin=s');

-- F-04: matriz de EXECUTE de otorgar_membresia.
select tests.igual('F-04', 'otorgar_membresia: EXECUTE solo service_role (ni PUBLIC, ni anon, ni authenticated)',
  $$select concat_ws(',',
      'service_role=' || has_function_privilege('service_role', 'public.otorgar_membresia(uuid,uuid,text,uuid)', 'execute'),
      'authenticated=' || has_function_privilege('authenticated', 'public.otorgar_membresia(uuid,uuid,text,uuid)', 'execute'),
      'anon=' || has_function_privilege('anon', 'public.otorgar_membresia(uuid,uuid,text,uuid)', 'execute'),
      'public=' || exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                           where p.oid = 'public.otorgar_membresia(uuid,uuid,text,uuid)'::regprocedure
                             and a.grantee = 0 and a.privilege_type = 'EXECUTE'))$$,
  'service_role=true,authenticated=false,anon=false,public=false');

-- F-05: matriz de EXECUTE de has_role_in_tenant.
select tests.igual('F-05', 'has_role_in_tenant: EXECUTE solo authenticated',
  $$select concat_ws(',',
      'authenticated=' || has_function_privilege('authenticated', 'public.has_role_in_tenant(uuid,text[])', 'execute'),
      'anon=' || has_function_privilege('anon', 'public.has_role_in_tenant(uuid,text[])', 'execute'),
      'public=' || exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                           where p.oid = 'public.has_role_in_tenant(uuid,text[])'::regprocedure
                             and a.grantee = 0 and a.privilege_type = 'EXECUTE'))$$,
  'authenticated=true,anon=false,public=false');

-- F-06: funciones de trigger no ejecutables por anon/authenticated/PUBLIC.
select tests.igual('F-06', 'funciones de trigger sin EXECUTE para anon/authenticated/PUBLIC',
  $$select coalesce(string_agg(distinct p.proname, ',' order by p.proname), 'ninguna expuesta')
    from pg_proc p
    left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a on true
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('handle_new_auth_user','vincular_membresia_heredada','fn_tenant_id_inmutable')
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))$$,
  'ninguna expuesta');

-- F-07: has_role_in_tenant responde solo sobre el propio usuario y el tenant pedido.
begin;
select tests.como('00000000-0000-0000-0000-0000000000ab');
set local role authenticated;
select tests.igual('F-07a', 'mixto: admin en A → true',
  $$select public.has_role_in_tenant('aaaaaaaa-0000-0000-0000-000000000000', array['admin_residencial'])::text$$, 'true');
select tests.igual('F-07b', 'mixto: admin en B → false (es guardia)',
  $$select public.has_role_in_tenant('bbbbbbbb-0000-0000-0000-000000000000', array['admin_residencial'])::text$$, 'false');
select tests.igual('F-07c', 'mixto: guardia en B → true',
  $$select public.has_role_in_tenant('bbbbbbbb-0000-0000-0000-000000000000', array['guardia'])::text$$, 'true');
select tests.igual('F-07d', 'tenant NULL → false',
  $$select public.has_role_in_tenant(null, array['admin_residencial'])::text$$, 'false');
rollback;

-- F-08: anon no puede ejecutar has_role_in_tenant.
begin;
set local role anon;
select tests.debe_fallar('F-08', 'anon no puede ejecutar has_role_in_tenant',
  $$select public.has_role_in_tenant('aaaaaaaa-0000-0000-0000-000000000000', array['admin_residencial'])$$, '42501');
rollback;

-- F-09: suplantación con tablas temporales. En la sesión de mixto se
-- crean pg_temp.user_tenants y pg_temp.roles que lo hacen "admin de B".
-- Con referencias calificadas + search_path='' no deben tener efecto.
begin;
select tests.como('00000000-0000-0000-0000-0000000000ab');
set local role authenticated;
do $$
begin
  begin
    create temp table user_tenants (id uuid, user_id uuid, tenant_id uuid, rol_id uuid, activo boolean) on commit drop;
    create temp table roles (id uuid, clave text) on commit drop;
    insert into user_tenants values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000ab',
      'bbbbbbbb-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000000', true);
    insert into roles values ('f0000000-0000-0000-0000-000000000000', 'admin_residencial');
  exception when insufficient_privilege then
    perform tests.pass('F-09', 'authenticated no puede crear tablas temporales (también seguro)');
    return;
  end;
  perform tests.igual('F-09a', 'tablas temporales no hacen a mixto admin de B (has_role_in_tenant)',
    $q$select public.has_role_in_tenant('bbbbbbbb-0000-0000-0000-000000000000', array['admin_residencial'])::text$q$, 'false');
  perform tests.igual('F-09b', 'tablas temporales no alteran is_super_admin',
    $q$select public.is_super_admin()::text$q$, 'false');
  perform tests.filas('F-09c', 'con tablas temporales, mixto sigue sin poder editar el tenant B',
    $q$update public.tenants set nombre = 'Hackeado' where id = 'bbbbbbbb-0000-0000-0000-000000000000'$q$, 0);
end $$;
rollback;

-- F-10: grants de user_tenants para el cliente.
select tests.igual('F-10', 'user_tenants: authenticated solo SELECT + UPDATE(activo); anon sin escritura',
  $$select concat_ws(',',
      'auth_select=' || has_table_privilege('authenticated', 'public.user_tenants', 'select'),
      'auth_insert=' || has_table_privilege('authenticated', 'public.user_tenants', 'insert'),
      'auth_delete=' || has_table_privilege('authenticated', 'public.user_tenants', 'delete'),
      'auth_upd_activo=' || has_column_privilege('authenticated', 'public.user_tenants', 'activo', 'update'),
      'auth_upd_rol=' || has_column_privilege('authenticated', 'public.user_tenants', 'rol_id', 'update'),
      'auth_upd_tenant=' || has_column_privilege('authenticated', 'public.user_tenants', 'tenant_id', 'update'),
      'anon_insert=' || has_table_privilege('anon', 'public.user_tenants', 'insert'),
      'anon_upd_activo=' || has_column_privilege('anon', 'public.user_tenants', 'activo', 'update'))$$,
  'auth_select=true,auth_insert=false,auth_delete=false,auth_upd_activo=true,auth_upd_rol=false,'
  || 'auth_upd_tenant=false,anon_insert=false,anon_upd_activo=false');

-- F-11: ninguna política depende ya de has_role().
select tests.igual('F-11', 'ninguna política usa has_role()',
  $$select count(*)::text from pg_policies
    where coalesce(qual, '') ~ 'has_role\(' or coalesce(with_check, '') ~ 'has_role\('$$, '0');

-- F-12: estado de las piezas transitorias según la fase.
select tests.igual('F-12', 'has_role() y el trigger transitorio existen en fase A y no en fase C',
  $$select concat_ws(',',
      'has_role=' || exists (select 1 from pg_proc where proname = 'has_role' and pronamespace = 'public'::regnamespace),
      'transitorio=' || exists (select 1 from pg_trigger where tgname = 'trg_vincular_membresia_heredada'))$$,
  case current_setting('tests.fase', true)
    when 'C' then 'has_role=false,transitorio=false'
    else 'has_role=true,transitorio=true' end);
