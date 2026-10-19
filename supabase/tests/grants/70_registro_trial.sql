-- ============================================================
-- Registro/trial en el mundo de mínimo privilegio (staging): grants
-- exactos de las tablas nuevas, EXECUTE de las funciones y el alta
-- completa como service_role sin ningún grant de tabla adicional
-- (las funciones son DEFINER). Solo corre con la migración aplicada.
-- ============================================================

do $$
declare f text;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then
    raise notice 'INFO|70_registro_trial (grants) omitido: migración no aplicada';
    return;
  end if;

  perform tests.igual('GT-01', 'suscripciones: authenticated solo SELECT; anon y service_role nada',
    $q$select (select coalesce(string_agg(p, ','), '-') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p where has_table_privilege('authenticated', 'public.suscripciones', p))
         || '|' || (select coalesce(string_agg(p, ','), '-') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p where has_table_privilege('anon', 'public.suscripciones', p))
         || '|' || (select coalesce(string_agg(p, ','), '-') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p where has_table_privilege('service_role', 'public.suscripciones', p))$q$,
    'SELECT|-|-');
  perform tests.igual('GT-02', 'registro_intentos: ningún rol de la API tiene privilegios',
    $q$select count(*)::text from unnest(array['anon','authenticated','service_role']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
       where has_table_privilege(r, 'public.registro_intentos', p)$q$, '0');
  perform tests.igual('GT-03', 'RLS activada en las dos tablas; suscripciones con una sola política (SELECT)',
    $q$select (select relrowsecurity from pg_class where oid = 'public.suscripciones'::regclass)::text || '|'
         || (select relrowsecurity from pg_class where oid = 'public.registro_intentos'::regclass)::text || '|'
         || (select string_agg(policyname || ':' || cmd, ',') from pg_policies where tablename = 'suscripciones') || '|'
         || (select count(*) from pg_policies where tablename = 'registro_intentos')$q$,
    'true|true|suscripciones_select_member:SELECT|0');
  foreach f in array array[
    'public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)',
    'public.revertir_cuenta_prueba(uuid)',
    'public.registro_intento_permitido(text,text)',
    'public.registro_intento_resultado(uuid,text,text)',
    'public.crear_suscripcion_alta_manual(uuid)'
  ] loop
    perform tests.igual('GT-04-' || split_part(split_part(f, '.', 2), '(', 1), 'EXECUTE solo service_role: ' || f,
      format($q$select has_function_privilege('anon', %L, 'execute')::text || has_function_privilege('authenticated', %L, 'execute')::text || has_function_privilege('service_role', %L, 'execute')::text$q$, f, f, f),
      'falsefalsetrue');
  end loop;
end $$;

-- Alta completa como service_role con los grants de staging.
begin;
set local role service_role;
do $$
declare r jsonb; rev jsonb;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Staging', 'MX', 30, 'America/Monterrey', true);
  -- Las tablas se leen como postgres: service_role no tiene SELECT en
  -- empresas ni suscripciones (ese es justamente el punto).
  execute 'reset role';
  perform tests.igual('GT-05', 'service_role: alta completa (tenant, empresa, admin, suscripción trialing)',
    format($q$select (select count(*) from public.tenants where id = %L)::text
             || (select count(*) from public.empresas where id = %L)
             || (select count(*) from public.user_tenants ut join public.roles ro on ro.id = ut.rol_id where ut.tenant_id = %L and ro.clave = 'admin_residencial')
             || (select count(*) from public.suscripciones where tenant_id = %L and estado = 'trialing')$q$,
           r->>'tenant_id', r->>'empresa_id', r->>'tenant_id', r->>'tenant_id'),
    '1111');
  execute 'set local role service_role';
  rev := public.revertir_cuenta_prueba('00000000-0000-0000-0000-000000000099');
  execute 'reset role';
  perform tests.igual('GT-06', 'service_role: compensación completa',
    format($q$select %L || (select count(*) from public.tenants where id = %L) || (select count(*) from public.empresas where id = %L)$q$,
           rev->>'revertido', r->>'tenant_id', r->>'empresa_id'),
    'true00');
  execute 'set local role service_role';
  perform tests.debe_fallar('GT-07', 'service_role sigue sin poder escribir suscripciones directamente',
    $q$update public.suscripciones set estado = 'active'$q$, '42501');
end $$;
rollback;

-- Sesión del admin recién creado: get-session y helper de suscripción (RLS).
begin;
set local role service_role;
do $$
declare r jsonb;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Sesión', 'AR', 12, null, true);
  execute 'reset role';
  perform tests.como('00000000-0000-0000-0000-000000000099');
  execute 'set local role authenticated';
  perform tests.igual('GT-08', 'el admin nuevo resuelve sesión: tenant real, rol admin_residencial, onboarding pendiente',
    $q$select t.nombre || '|' || ro.clave || '|' || t.onboarding_completado from public.user_tenants ut
       join public.roles ro on ro.id = ut.rol_id join public.tenants t on t.id = ut.tenant_id
       where ut.user_id = auth.uid() and ut.activo limit 1$q$,
    'Residencial Sesión|admin_residencial|false');
  perform tests.igual('GT-09', 'el admin nuevo lee su suscripción (y solo la suya)',
    $q$select string_agg(estado || '|' || origen || '|' || viviendas_declaradas, ',') from public.suscripciones$q$,
    'trialing|registro_publico|12');
end $$;
rollback;

-- Alta manual con los grants de staging.
begin;
do $$
declare v_tenant uuid; r jsonb;
begin
  if to_regprocedure('public.crear_suscripcion_alta_manual(uuid)') is null then return; end if;
  insert into public.tenants (nombre, tipo, empresa_id) values ('Manual Staging', 'residencial', 'e0000000-0000-0000-0000-000000000001')
  returning id into v_tenant;
  execute 'set local role service_role';
  r := public.crear_suscripcion_alta_manual(v_tenant);
  execute 'reset role';
  perform tests.igual('GT-10', 'service_role: alta manual → active/alta_manual sin fechas',
    format($q$select estado || '|' || origen || '|' || (trial_started_at is null)::text || '|' || %L from public.suscripciones where tenant_id = %L$q$, r->>'creada', v_tenant),
    'active|alta_manual|true|true');
end $$;
rollback;
