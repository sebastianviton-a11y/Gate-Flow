-- ============================================================
-- 20261011000000: registro de residentes por enlace.
-- Permisos, paridad con tenant_operativo, validaciones, enlace
-- (generar/regenerar/desactivar), envíos públicos con límites,
-- revisión (aprobar/rechazar/duplicados), aislamiento entre
-- residenciales (mismo WhatsApp en A y B), lo que el guardia no puede
-- hacer y que nada crea cuentas ni membresías. Todo en UNA transacción
-- que se revierte: la suite no deja datos (el rollback de la migración
-- exige que no los haya). Solo corre con la migración aplicada (fase RE
-- del runner). La revisión concurrente (dos sesiones) está en
-- concurrencia_residentes.sh.
-- ============================================================

create or replace function tests.residentes() returns boolean language sql as $$
  select to_regclass('public.residentes_solicitudes') is not null;
$$;
grant execute on function tests.residentes() to anon, authenticated, service_role;

do $$ begin
  if not tests.residentes() then raise notice 'INFO|94_residentes_enlace omitido: migración no aplicada'; end if;
end $$;

select tests.residentes() as hay_residentes \gset
\if :hay_residentes

-- Ejecuta p_sql con la identidad indicada y devuelve el primer valor.
create or replace function tests.re(p_uid uuid, p_rol text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  if p_rol = 'service_role' then
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
  elsif p_rol = 'anon' then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform tests.como(p_uid);
    set local role authenticated;
  end if;
  execute p_sql into v;
  reset role;
  return v;
exception when others then
  reset role;
  raise;
end $$;

-- Identidades de 00_fixtures.sql.
create or replace function tests.admin_a() returns uuid language sql as $$ select '00000000-0000-0000-0000-00000000000a'::uuid $$;
create or replace function tests.guard_a() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000a9'::uuid $$;
create or replace function tests.admin_b() returns uuid language sql as $$ select '00000000-0000-0000-0000-00000000000b'::uuid $$;
create or replace function tests.tenant_a() returns uuid language sql as $$ select 'aaaaaaaa-0000-0000-0000-000000000000'::uuid $$;
create or replace function tests.tenant_b() returns uuid language sql as $$ select 'bbbbbbbb-0000-0000-0000-000000000000'::uuid $$;

-- Envío público como lo hace el servidor del panel (service_role).
create or replace function tests.enviar(p_token text, p_nombre text, p_apellido text, p_dir text, p_tel text, p_ip text default null)
returns text language sql as $$
  select tests.re(null, 'service_role', format(
    'select public.residentes_solicitud_crear(%L, %L, %L, %L, %L, %L)->>''resultado''', p_token, p_nombre, p_apellido, p_dir, p_tel, p_ip));
$$;

-- La respuesta completa (jsonb como texto), para comprobar el id guardado.
create or replace function tests.enviar_j(p_token text, p_nombre text, p_apellido text, p_dir text, p_tel text, p_ip text default null)
returns jsonb language sql as $$
  select tests.re(null, 'service_role', format(
    'select public.residentes_solicitud_crear(%L, %L, %L, %L, %L, %L)::text', p_token, p_nombre, p_apellido, p_dir, p_tel, p_ip))::jsonb;
$$;

-- Una letra por resultado: r recibida, c limite_conexion, e limite_enlace.
create or replace function tests.letra(p text) returns text language sql as $$
  select case p when 'recibida' then 'r' when 'limite_conexion' then 'c' when 'limite_enlace' then 'e' else 'x' end;
$$;

-- SQL que ejecuta p_sql con esa identidad (para tests.debe_fallar).
create or replace function tests.q(p_uid uuid, p_rol text, p_sql text) returns text language sql as $$
  select format('select tests.re(%L, %L, %L)', p_uid, p_rol, p_sql);
$$;

-- Compara un valor ya calculado (cada cálculo en su propia sentencia:
-- una consulta no ve lo que insertó una función en esa misma sentencia).
create or replace function tests.chk(p_id text, p_desc text, p_valor text, p_esperado text) returns void language sql as $$
  select tests.igual(p_id, p_desc, format('select %L::text', p_valor), p_esperado);
$$;

create or replace function tests.adm(p_sql text) returns text language sql as $$ select tests.re(tests.admin_a(), 'authenticated', p_sql) $$;
create or replace function tests.srv(p_sql text) returns text language sql as $$ select tests.re(null, 'service_role', p_sql) $$;

grant execute on all functions in schema tests to anon, authenticated, service_role, supabase_auth_admin;

begin;
create temp table re_ids (k text primary key, v text) on commit drop;
grant all on re_ids to anon, authenticated, service_role;
-- Línea de base de RE-49: el flujo completo no crea cuentas ni membresías.
insert into re_ids select 'cuentas', (select count(*) from auth.users)::text || '/' || (select count(*) from public.users)::text
  || '/' || (select count(*) from public.user_tenants)::text;

-- ── Permisos del catálogo ─────────────────────────────────────
do $$ begin
  perform tests.igual('RE-00a', 'RLS activo en las dos tablas nuevas',
    $q$select string_agg(relname || '=' || relrowsecurity::text, ',' order by relname) from pg_class
       where oid in ('public.residentes_enlaces'::regclass, 'public.residentes_solicitudes'::regclass)$q$,
    'residentes_enlaces=true,residentes_solicitudes=true');
  perform tests.igual('RE-00b', 'authenticated solo SELECT; anon y service_role sin privilegios de tabla',
    $q$select string_agg(t || ':' || has_table_privilege('anon', t, 'select')::text || has_table_privilege('authenticated', t, 'select')::text
         || has_table_privilege('authenticated', t, 'insert')::text || has_table_privilege('authenticated', t, 'update')::text
         || has_table_privilege('authenticated', t, 'delete')::text || has_table_privilege('service_role', t, 'insert')::text, ',' order by t)
       from unnest(array['public.residentes_enlaces', 'public.residentes_solicitudes']) t$q$,
    'public.residentes_enlaces:falsetruefalsefalsefalsefalse,public.residentes_solicitudes:falsetruefalsefalsefalsefalse');
  perform tests.igual('RE-00c', 'funciones públicas: EXECUTE solo service_role',
    $q$select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text
         || has_function_privilege('authenticated', p.oid, 'execute')::text || has_function_privilege('service_role', p.oid, 'execute')::text, ',' order by p.proname)
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('residentes_enlace_publico', 'residentes_solicitud_crear')$q$,
    'residentes_enlace_publico:falsefalsetrue,residentes_solicitud_crear:falsefalsetrue');
  perform tests.igual('RE-00d', 'funciones de administración: EXECUTE solo authenticated (validan el rol adentro)',
    $q$select count(*) filter (where not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
                                  and not has_function_privilege('service_role', p.oid, 'execute'))::text || '/' || count(*)::text
       from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('residentes_enlace_generar', 'residentes_enlace_desactivar', 'residentes_solicitudes_revision', 'residentes_solicitud_aprobar',
                          'residentes_solicitud_rechazar', 'residentes_adicional_actualizar', 'residentes_adicional_quitar')$q$, '7/7');
  perform tests.igual('RE-00e', 'auxiliares: sin EXECUTE para anon, authenticated ni service_role',
    $q$select count(*) filter (where has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                                  or has_function_privilege('service_role', p.oid, 'execute'))::text
       from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'fn_residente%' or p.proname in
        ('fn_telefono_canonico', 'fn_direccion_clave', 'fn_tenant_servicio_vigente'))$q$, '0');
  perform tests.igual('RE-00f', 'todas las funciones nuevas con search_path vacío; las que leen datos, SECURITY DEFINER',
    $q$select count(*) filter (where coalesce(array_to_string(p.proconfig, ','), '') <> 'search_path=""')::text || '/'
         || count(*) filter (where not p.prosecdef and p.provolatile <> 'i')::text
       from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'residentes\_%' or p.proname like 'fn_residente%'
        or p.proname in ('fn_telefono_canonico', 'fn_direccion_clave', 'fn_tenant_servicio_vigente'))$q$, '0/0');
end $$;

-- ── Paridad: fn_tenant_servicio_vigente = tenant_operativo ────
do $$
declare
  v_caso record;
  v_ok int := 0;
  v_mal text := '';
  v_op text;
  v_vig text;
begin
  for v_caso in select * from (values
    ('activo', 'active', null::timestamptz, null::timestamptz, false, null::timestamptz, null::timestamptz),
    ('activo', 'active', null, null, true, now() + interval '3 days', null),
    ('activo', 'active', null, null, true, now() - interval '1 day', null),
    ('activo', 'trialing', now() - interval '5 days', now() + interval '25 days', false, null, null),
    ('activo', 'trialing', now() - interval '35 days', now() - interval '5 days', false, null, null),
    ('activo', 'past_due', null, null, false, now() + interval '20 days', now() - interval '3 days'),
    ('activo', 'past_due', null, null, false, now() + interval '20 days', now() - interval '8 days'),
    ('activo', 'past_due', null, null, false, now() + interval '20 days', null),
    ('activo', 'canceled', null, null, false, null, null),
    ('activo', 'expired', null, null, false, null, null),
    ('suspendido', 'active', null, null, false, null, null),
    ('piloto', 'active', null, null, false, null, null),
    ('cancelado', 'active', null, null, false, null, null)
  ) as c(servicio, estado, t0, t1, cancela, cpe, impago)
  loop
    update public.tenants set estado_servicio = v_caso.servicio where id = tests.tenant_a();
    update public.suscripciones set estado = v_caso.estado, trial_started_at = v_caso.t0, trial_ends_at = v_caso.t1,
           cancel_at_period_end = v_caso.cancela, current_period_end = v_caso.cpe, impago_desde = v_caso.impago
     where tenant_id = tests.tenant_a();
    v_op := tests.re(tests.admin_a(), 'authenticated', format('select public.tenant_operativo(%L)::text', tests.tenant_a()));
    v_vig := public.fn_tenant_servicio_vigente(tests.tenant_a())::text;
    if v_op = v_vig then v_ok := v_ok + 1; else v_mal := v_mal || format(' %s/%s: operativo=%s vigente=%s', v_caso.servicio, v_caso.estado, v_op, v_vig); end if;
  end loop;
  if v_mal = '' then
    perform tests.pass('RE-01', format('fn_tenant_servicio_vigente coincide con tenant_operativo en los %s estados de servicio y suscripción', v_ok));
  else
    perform tests.fail('RE-01', 'paridad con tenant_operativo', v_mal);
  end if;
  update public.tenants set estado_servicio = 'activo' where id = tests.tenant_a();
  update public.suscripciones set estado = 'active', trial_started_at = null, trial_ends_at = null, cancel_at_period_end = false,
         current_period_end = null, impago_desde = null where tenant_id = tests.tenant_a();
end $$;

-- ── Validaciones y normalización ──────────────────────────────
do $$ begin
  perform tests.igual('RE-02', 'teléfonos canónicos con las reglas de normalizarTelefonoWhatsApp (MX y AR)',
    $q$select string_agg(coalesce(public.fn_telefono_canonico(t, p), 'null'), ',' order by n) from (values
       (1, '998 123 4567', 'MX'), (2, '+52 998 123 4567', 'MX'), (3, '+52 1 998 123 4567', 'MX'), (4, '99812345', 'MX'),
       (5, '11 2345-6789', 'AR'), (6, '011 15 2345-6789', 'AR'), (7, '+54 11 2345 6789', 'AR'), (8, '+54 9 11 2345 6789', 'AR'),
       (9, '0351 15 123-4567', 'AR'), (10, '123', 'AR')) v(n, t, p)$q$,
    '529981234567,529981234567,529981234567,null,5491123456789,5491123456789,5491123456789,5491123456789,5493511234567,null');
  perform tests.igual('RE-03', 'nombres: acentos, espacios, apóstrofos y guiones sí; dígitos, signos y separadores dobles no',
    $q$select string_agg(public.fn_residente_nombre_valido(n)::text, ',' order by i) from (values
       (1, 'María José'), (2, 'O''Connor'), (3, 'Ana-Lía'), (4, 'D' || chr(8217) || 'Angelo'), (5, 'Núñez Güemes'),
       (6, 'Juan2'), (7, 'Ana@'), (8, '-Ana'), (9, 'Ana--Lía'), (10, ''), (11, repeat('a', 61))) v(i, n)$q$,
    'true,true,true,true,true,false,false,false,false,false,false');
  perform tests.igual('RE-04', 'WhatsApp válido según el país del residencial',
    $q$select string_agg(public.fn_residente_telefono_valido(t, p)::text, ',' order by i) from (values
       (1, '5491123456789', 'AR'), (2, '529981234567', 'MX'), (3, '529981234567', 'AR'), (4, '54911234567890', 'AR'),
       (5, '5290812345678', 'MX'), (6, '5201234567890', 'MX')) v(i, t, p)$q$,
    'true,true,false,false,false,false');
  perform tests.igual('RE-05', 'limpieza: recorta y colapsa espacios sin tocar el resto de la dirección',
    $q$select public.fn_residente_texto_limpio('   Torre B,   Depto 4°  ')$q$, 'Torre B, Depto 4°');
end $$;

-- ── Enlace: generar, ver, regenerar ───────────────────────────
do $$
declare v jsonb; v_t1 text; v_t2 text; a text; b text; c text;
begin
  perform tests.debe_fallar('RE-10', 'el guardia no genera el enlace',
    tests.q(tests.guard_a(), 'authenticated', format('select public.residentes_enlace_generar(%L)::text', tests.tenant_a())), '42501');
  perform tests.debe_fallar('RE-11', 'el admin de B no genera el enlace de A',
    tests.q(tests.admin_b(), 'authenticated', format('select public.residentes_enlace_generar(%L)::text', tests.tenant_a())), '42501');
  v := tests.adm(format('select public.residentes_enlace_generar(%L)::text', tests.tenant_a()))::jsonb;
  v_t1 := v->>'token';
  insert into re_ids values ('token1', v_t1);
  perform tests.chk('RE-12', 'el admin de A genera un enlace: token de 64 hex, uno activo',
    (v_t1 ~ '^[0-9a-f]{64}$')::text || '/' || (select count(*) from public.residentes_enlaces where tenant_id = tests.tenant_a() and activo)::text, 'true/1');
  a := tests.re(tests.guard_a(), 'authenticated', 'select count(*)::text from public.residentes_enlaces');
  b := tests.re(tests.admin_b(), 'authenticated', 'select count(*)::text from public.residentes_enlaces');
  c := tests.adm('select count(*)::text from public.residentes_enlaces');
  perform tests.chk('RE-13', 'el enlace lo ven solo los admins de A (guardia 0, admin de B 0, admin de A 1)', a || '/' || b || '/' || c, '0/0/1');
  v := tests.adm(format('select public.residentes_enlace_generar(%L)::text', tests.tenant_a()))::jsonb;
  v_t2 := v->>'token';
  insert into re_ids values ('token2', v_t2);
  perform tests.chk('RE-14', 'regenerar revoca el anterior (con fecha) y deja uno activo distinto',
    (select count(*) from public.residentes_enlaces where tenant_id = tests.tenant_a() and activo)::text || '/'
    || (select (not activo and revocado_en is not null)::text from public.residentes_enlaces where token = v_t1) || '/' || (v_t1 <> v_t2)::text,
    '1/true/true');
  a := tests.srv(format('select public.residentes_enlace_publico(%L)->>''estado''', v_t1));
  v := tests.srv(format('select public.residentes_enlace_publico(%L)::text', v_t2))::jsonb;
  perform tests.chk('RE-15', 'público: el enlace anterior responde revocado; el vigente, activo con nombre y país del residencial',
    a || '/' || (v->>'estado') || '/' || (v->>'residencial') || '/' || (v->>'pais'),
    'revocado/activo/' || (select nombre from public.tenants where id = tests.tenant_a()) || '/MX');
  perform tests.chk('RE-16', 'token desconocido o mal formado: revocado (sin distinguir)',
    tests.srv(format('select public.residentes_enlace_publico(%L)->>''estado''', repeat('0', 64))) || '/'
    || tests.srv('select public.residentes_enlace_publico(''aaaa'')->>''estado'''), 'revocado/revocado');
  perform tests.debe_fallar('RE-17a', 'anon no llama la función pública directo (solo el servidor)',
    tests.q(null, 'anon', format('select public.residentes_enlace_publico(%L)::text', v_t2)), '42501');
  perform tests.debe_fallar('RE-17b', 'authenticated tampoco puede crear solicitudes directo',
    tests.q(tests.admin_a(), 'authenticated', format('select public.residentes_solicitud_crear(%L, ''Ana'', ''Paz'', ''Casa 1'', ''529981234567'', null)::text', v_t2)), '42501');
end $$;

-- ── Envíos públicos ───────────────────────────────────────────
do $$
declare v_t text := (select r.v from re_ids r where r.k = 'token2'); v_t1 text := (select r.v from re_ids r where r.k = 'token1'); a text; b text; c text; d text; j jsonb;
begin
  j := tests.enviar_j(v_t, '  Ana   María ', 'López', ' Casa  12 ', '529981110001');
  perform tests.chk('RE-20', 'envío válido: recibida; queda pendiente en A con espacios limpiados y la dirección intacta',
    (j->>'resultado') || '/' || (select string_agg(tenant_id::text || '|' || nombre || '|' || direccion || '|' || estado, ',') from public.residentes_solicitudes),
    'recibida/aaaaaaaa-0000-0000-0000-000000000000|Ana María|Casa 12|pendiente');
  perform tests.chk('RE-20b', '"recibida" trae el id de la solicitud efectivamente guardada',
    ((j->>'solicitud_id') = (select id::text from public.residentes_solicitudes where nombre = 'Ana María'))::text, 'true');
  insert into re_ids values ('ana', j->>'solicitud_id');
  a := tests.enviar(v_t, 'Ana2', 'López', 'Casa 12', '529981110002');
  b := tests.enviar(v_t, 'Ana', 'López', 'Casa 12', '5491123456789');
  c := tests.enviar(v_t, 'Ana', 'López', '  ', '529981110002');
  perform tests.chk('RE-21', 'campos inválidos (dígitos en el nombre, WhatsApp de otro país, dirección vacía): invalido, nada guardado',
    a || '/' || b || '/' || c || '/' || (select count(*) from public.residentes_solicitudes)::text, 'invalido/invalido/invalido/1');
  a := tests.enviar(v_t1, 'Ana', 'López', 'Casa 12', '529981110003');
  perform tests.chk('RE-22', 'enlace revocado: rechazado sin guardar', a || '/' || (select count(*) from public.residentes_solicitudes)::text, 'revocado/1');
  j := tests.enviar_j(v_t, 'ANA MARÍA', 'lópez', 'casa 12', '529981110001');
  perform tests.chk('RE-23', 'reenvío idéntico (mayúsculas, acentos, espacios): responde con la MISMA solicitud guardada y no se duplica',
    (j->>'resultado') || '/' || ((j->>'solicitud_id') = (select r.v from re_ids r where r.k = 'ana'))::text || '/' || (select count(*) from public.residentes_solicitudes)::text,
    'recibida/true/1');
  a := tests.enviar(v_t, 'Bea', 'López', 'Casa 13', '529981110002');
  b := tests.enviar(v_t, 'Ceci', 'López', 'Casa 13', '529981110002');
  c := tests.enviar(v_t, 'Dani', 'López', 'Casa 13', '529981110002');
  d := tests.enviar(v_t, 'Eli', 'López', 'Casa 13', '529981110002');
  perform tests.chk('RE-24', 'mismo WhatsApp con otros datos: cada uno se guarda (nada se descarta en silencio; el admin ve el posible duplicado)',
    a || b || c || d || '/' || (select count(*) from public.residentes_solicitudes where telefono = '529981110002')::text,
    'recibidarecibidarecibidarecibida/4');
  -- La revisión de abajo usa Bea, Ceci y Dani.
  delete from public.residentes_solicitudes where nombre = 'Eli';
end $$;

-- ── Límites: el enlace se comparte en el grupo del residencial ──
-- Varios vecinos desde el mismo wifi (misma IP), por conexión, por
-- enlace, pendientes y reenvíos idénticos. N = viviendas del residencial.
do $$
declare
  v_t text := (select r.v from re_ids r where r.k = 'token2');
  v_enlace uuid := (select id from public.residentes_enlaces where token = (select r.v from re_ids r where r.k = 'token2'));
  v_wifi text := repeat('ab', 32); v_otra text := repeat('cd', 32); v_tercera text := repeat('ef', 32);
  v_viv integer; v_enlace_b uuid; v_r text := ''; i int; a text; j jsonb;
begin
  select viviendas_declaradas into v_viv from public.suscripciones where tenant_id = tests.tenant_a();
  update public.suscripciones set viviendas_declaradas = 40 where tenant_id = tests.tenant_a();
  perform tests.chk('RE-25a', 'tamaño del residencial para los límites: N = 40 viviendas',
    public.billing_viviendas_requeridas(tests.tenant_a())::text, '40');

  for i in 1..35 loop
    v_r := v_r || tests.letra(tests.enviar(v_t, 'Vecino', 'Wifi', 'Torre 1 Depto ' || i, '52998222' || lpad(i::text, 4, '0'), v_wifi));
  end loop;
  perform tests.chk('RE-25b', 'mismo wifi: 35 residentes distintos en la misma hora → los 35 guardados',
    v_r || '/' || (select count(*) from public.residentes_solicitudes where ip_hash = v_wifi)::text, repeat('r', 35) || '/35');

  v_r := '';
  for i in 36..41 loop
    v_r := v_r || tests.letra(tests.enviar(v_t, 'Vecino', 'Wifi', 'Torre 1 Depto ' || i, '52998222' || lpad(i::text, 4, '0'), v_wifi));
  end loop;
  perform tests.chk('RE-25c', 'por conexión: max(40, ⌈N/2⌉) por hora; el 41.º responde limite_conexion y no se guarda',
    v_r || '/' || (select count(*) from public.residentes_solicitudes where ip_hash = v_wifi)::text, 'rrrrrc/40');

  j := tests.enviar_j(v_t, 'Vecino', 'Wifi', 'Torre 1 Depto 7', '529982220007', v_wifi);
  perform tests.chk('RE-25d', 'reenvío idéntico desde esa conexión, ya en su límite: la misma solicitud guardada, sin duplicar',
    (j->>'resultado') || '/' || ((j->>'solicitud_id') = (select id::text from public.residentes_solicitudes where telefono = '529982220007'))::text
      || '/' || (select count(*) from public.residentes_solicitudes where ip_hash = v_wifi)::text,
    'recibida/true/40');

  a := tests.enviar(v_t, 'Otra', 'Conexión', 'Torre 2', '529982229999', v_otra);
  perform tests.chk('RE-25e', 'otra conexión del mismo residencial sigue enviando', a, 'recibida');

  -- Por día: las de hace horas no cuentan por hora, sí por día.
  update public.residentes_solicitudes set created_at = now() - interval '3 hours' where ip_hash = v_wifi;
  insert into public.residentes_solicitudes (tenant_id, enlace_id, nombre, apellido, direccion, telefono, ip_hash, created_at)
  select tests.tenant_a(), v_enlace, 'Vecino', 'Día', 'Torre 3 Depto ' || g, '52998333' || lpad(g::text, 4, '0'), v_wifi, now() - interval '5 hours'
  from generate_series(1, 80) g;
  a := tests.enviar(v_t, 'Vecino', 'Tarde', 'Torre 4', '529983339999', v_wifi);
  perform tests.chk('RE-25f', 'por conexión: max(120, 2N) por día; con 120 en el día el siguiente responde limite_conexion',
    a || '/' || (select count(*) from public.residentes_solicitudes where ip_hash = v_wifi)::text, 'limite_conexion/120');

  update public.suscripciones set viviendas_declaradas = 150 where tenant_id = tests.tenant_a();
  a := tests.enviar(v_t, 'Vecino', 'Tarde', 'Torre 4', '529983339999', v_wifi);
  perform tests.chk('RE-25g', 'los límites escalan: con N = 150 la misma conexión sigue (75 por hora, 300 por día)', a, 'recibida');
  update public.suscripciones set viviendas_declaradas = 40 where tenant_id = tests.tenant_a();

  -- Por conexión en todos los residenciales: 600 por día.
  insert into public.residentes_enlaces (tenant_id, token, activo, revocado_en) values (tests.tenant_b(), repeat('9', 64), false, now()) returning id into v_enlace_b;
  insert into public.residentes_solicitudes (tenant_id, enlace_id, nombre, apellido, direccion, telefono, ip_hash, created_at)
  select tests.tenant_b(), v_enlace_b, 'Vecino', 'Otro', 'Casa ' || g, '52998444' || lpad(g::text, 4, '0'), v_otra, now() - interval '2 hours'
  from generate_series(1, 599) g;
  a := tests.enviar(v_t, 'Otra', 'Conexión', 'Torre 5', '529984449999', v_otra);
  perform tests.chk('RE-25h', 'por conexión en todos los residenciales: 600 por día (1 en A + 599 en B → limite_conexion)', a, 'limite_conexion');
  delete from public.residentes_solicitudes where tenant_id = tests.tenant_b();
  delete from public.residentes_enlaces where id = v_enlace_b;

  -- Por enlace: max(300, 4N) por día (rechazadas cuentan: es volumen del enlace).
  insert into public.residentes_solicitudes (tenant_id, enlace_id, nombre, apellido, direccion, telefono, ip_hash, estado, motivo_rechazo, revisado_en, created_at)
  select tests.tenant_a(), v_enlace, 'Relleno', 'Enlace', 'Lote ' || g, '52998555' || lpad(g::text, 4, '0'), null, 'rechazada', 'otro', now(), now() - interval '1 hour'
  from generate_series(1, 300 - (select count(*) from public.residentes_solicitudes where enlace_id = v_enlace and created_at > now() - interval '24 hours')) g;
  a := tests.enviar(v_t, 'Nueva', 'Conexión', 'Lote 900', '529985559999', v_tercera);
  perform tests.chk('RE-25i', 'por enlace: max(300, 4N) por día; con 300 en el día responde limite_enlace aunque la conexión sea nueva', a, 'limite_enlace');
  a := tests.enviar(v_t, 'Vecino', 'Wifi', 'Torre 1 Depto 7', '529982220007', v_tercera);
  perform tests.chk('RE-25j', 'reenvío idéntico desde OTRA conexión con el enlace en su límite: limite_enlace (no confirma datos ajenos)', a, 'limite_enlace');
  delete from public.residentes_solicitudes where nombre = 'Relleno';

  -- Pendientes del residencial: max(300, 4N), aunque sean de días anteriores.
  insert into public.residentes_solicitudes (tenant_id, enlace_id, nombre, apellido, direccion, telefono, ip_hash, created_at)
  select tests.tenant_a(), v_enlace, 'Relleno', 'Pendiente', 'Lote ' || g, '52998666' || lpad(g::text, 4, '0'), null, now() - interval '30 hours'
  from generate_series(1, 300 - (select count(*) from public.residentes_solicitudes where tenant_id = tests.tenant_a() and estado = 'pendiente')) g;
  a := tests.enviar(v_t, 'Nueva', 'Conexión', 'Lote 901', '529986669999', v_tercera);
  perform tests.chk('RE-25k', 'pendientes del residencial: con max(300, 4N) sin revisar responde limite_enlace', a, 'limite_enlace');

  delete from public.residentes_solicitudes where nombre = 'Relleno' or ip_hash in (v_wifi, v_otra, v_tercera);
  update public.suscripciones set viviendas_declaradas = v_viv where tenant_id = tests.tenant_a();
end $$;

do $$
declare v_t text := (select r.v from re_ids r where r.k = 'token2'); a text; b text; c text;
begin
  update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
   where tenant_id = tests.tenant_a();
  a := tests.srv(format('select public.residentes_enlace_publico(%L)->>''estado''', v_t));
  b := tests.enviar(v_t, 'Eva', 'Ruiz', 'Casa 30', '529981110009');
  perform tests.chk('RE-26', 'residencial no operativo (prueba vencida): el enlace responde no_operativo y no recibe envíos',
    a || '/' || b || '/' || (select count(*) from public.residentes_solicitudes)::text, 'no_operativo/no_operativo/4');
  update public.suscripciones set estado = 'active', trial_started_at = null, trial_ends_at = null where tenant_id = tests.tenant_a();
  perform tests.debe_fallar('RE-27a', 'el admin no escribe solicitudes directo (sin grant)',
    tests.q(tests.admin_a(), 'authenticated', 'update public.residentes_solicitudes set estado = ''aprobada'' returning id::text'), '42501');
  a := tests.re(tests.guard_a(), 'authenticated', 'select count(*)::text from public.residentes_solicitudes');
  b := tests.re(tests.admin_b(), 'authenticated', 'select count(*)::text from public.residentes_solicitudes');
  c := tests.adm('select count(*)::text from public.residentes_solicitudes');
  perform tests.chk('RE-27b', 'solicitudes visibles: guardia de A 0, admin de B 0, admin de A 4', a || '/' || b || '/' || c, '0/0/4');
end $$;

-- ── Revisión ──────────────────────────────────────────────────
-- Datos: A1 (fixture, sin contacto); Casa 7 con contacto (propietaria).
-- Pendientes: Ana María (Casa 12, nueva) y Bea, Ceci, Dani (mismo WhatsApp).
insert into public.unidades (id, tenant_id, identificador, contacto_nombre, contacto_telefono)
values ('a7000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'Casa 7', 'Rosa Propietaria', '998 333 4444');

do $$
declare
  v_ana uuid := (select id from public.residentes_solicitudes where nombre = 'Ana María');
  v_t text := (select r.v from re_ids r where r.k = 'token2');
  v jsonb;
begin
  perform tests.debe_fallar('RE-30a', 'el admin de B no lista las solicitudes de A',
    tests.q(tests.admin_b(), 'authenticated', format('select public.residentes_solicitudes_revision(%L)::text', tests.tenant_a())), '42501');
  v := tests.adm(format('select public.residentes_solicitudes_revision(%L)::text', tests.tenant_a()))::jsonb;
  perform tests.chk('RE-30b', 'revisión del admin de A: 4 pendientes; en Bea, las otras 2 del mismo WhatsApp son coincidencias',
    jsonb_array_length(v)::text || '/' || (select jsonb_array_length(e->'coincidencias')::text from jsonb_array_elements(v) e where e->>'nombre' = 'Bea'), '4/2');

  v := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Ana María', 'López', 'Casa 12', '529981110001', null, false)::text$q$, v_ana))::jsonb;
  perform tests.chk('RE-31', 'aprobar en vivienda nueva: crea la vivienda sin tipo, con la persona como contacto; ya no está pendiente',
    (v->>'resultado') || '/' || (select coalesce(tipo, 'sin tipo') || '|' || contacto_nombre || '|' || contacto_telefono from public.unidades where identificador = 'Casa 12' and tenant_id = tests.tenant_a())
    || '/' || (select estado from public.residentes_solicitudes where id = v_ana),
    'vivienda_nueva/sin tipo|Ana María López|529981110001/aprobada');

  perform tests.enviar(v_t, 'Iván', 'Inquilino', 'casa 7', '529981110020');
end $$;

do $$
declare
  v_ivan uuid := (select id from public.residentes_solicitudes where nombre = 'Iván');
  v jsonb;
begin
  v := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Iván', 'Inquilino', 'casa 7', '529981110020', null, false)::text$q$, v_ivan))::jsonb;
  perform tests.chk('RE-32a', 'vivienda nueva con una dirección que ya existe: direccion_existente (se elige la vivienda)',
    (v->>'motivo') || '/' || (v->>'direccion'), 'direccion_existente/Casa 7');
  v := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Iván', 'Inquilino', 'casa 7', '529981110020', 'a7000000-0000-0000-0000-000000000000', false)::text$q$, v_ivan))::jsonb;
  perform tests.chk('RE-32b', 'propietaria e inquilino en la misma vivienda: residente adicional sin relación inventada; el contacto de la propietaria no cambia',
    (v->>'resultado') || '/' || (select contacto_nombre || '|' || contacto_telefono from public.unidades where id = 'a7000000-0000-0000-0000-000000000000')
    || '/' || (select nombre || ' ' || apellido || '|' || coalesce(tipo_relacion, 'sin relación') || '|' || origen from public.residentes_unidades where unidad_id = 'a7000000-0000-0000-0000-000000000000'),
    'residente_adicional/Rosa Propietaria|998 333 4444/Iván Inquilino|sin relación|enlace');
end $$;

do $$
declare
  v_bea uuid := (select id from public.residentes_solicitudes where nombre = 'Bea');
  v_ceci uuid := (select id from public.residentes_solicitudes where nombre = 'Ceci');
  v_dani uuid := (select id from public.residentes_solicitudes where nombre = 'Dani');
  v jsonb; a text; b text;
begin
  v := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Bea', 'López', 'Casa A1', '529981110030', 'a1000000-0000-0000-0000-000000000000', false)::text$q$, v_bea))::jsonb;
  perform tests.chk('RE-33', 'vivienda existente sin contacto: lo completa (contacto_principal); la corrección del WhatsApp queda registrada',
    (v->>'resultado') || '/' || (select contacto_nombre || '|' || contacto_telefono from public.unidades where id = 'a1000000-0000-0000-0000-000000000000')
    || '/' || (select corregida::text || '|' || telefono from public.residentes_solicitudes where id = v_bea),
    'contacto_principal/Bea López|529981110030/true|529981110030');

  v := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Ceci', 'López', 'Casa 12', '529981110001', (select id from public.unidades where identificador = 'Casa 12'), false)::text$q$, v_ceci))::jsonb;
  perform tests.chk('RE-34a', 'el mismo WhatsApp ya está en esa vivienda: ya_registrado', v->>'motivo', 'ya_registrado');
  v := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Ceci', 'López', 'Casa 7', '529981110001', 'a7000000-0000-0000-0000-000000000000', false)::text$q$, v_ceci))::jsonb;
  perform tests.chk('RE-34b', 'el mismo WhatsApp en otra vivienda: posible_duplicado con el detalle (solo para el admin)',
    (v->>'motivo') || '/' || (v->'coincidencias'->0->>'tipo') || '/' || (v->'coincidencias'->0->>'direccion'), 'posible_duplicado/telefono_contacto/Casa 12');
  v := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Ceci', 'López', 'Casa 7', '529981110001', 'a7000000-0000-0000-0000-000000000000', true)::text$q$, v_ceci))::jsonb;
  perform tests.chk('RE-34c', 'confirmado por el admin: se agrega (varias personas en una dirección)',
    (v->>'resultado') || '/' || (select count(*)::text from public.residentes_unidades where unidad_id = 'a7000000-0000-0000-0000-000000000000' and fecha_fin is null),
    'residente_adicional/2');

  perform tests.debe_fallar('RE-35a', 'motivo de rechazo inválido',
    tests.q(tests.admin_a(), 'authenticated', format('select public.residentes_solicitud_rechazar(%L, ''porque si'')::text', v_dani)), '22023');
  perform tests.debe_fallar('RE-35b', 'el guardia no rechaza',
    tests.q(tests.guard_a(), 'authenticated', format('select public.residentes_solicitud_rechazar(%L, ''duplicado'')::text', v_dani)), '42501');
  perform tests.debe_fallar('RE-35c', 'el admin de B no aprueba solicitudes de A',
    tests.q(tests.admin_b(), 'authenticated', format('select public.residentes_solicitud_aprobar(%L, ''Dani'', ''López'', ''Casa 99'', ''529981110040'')::text', v_dani)), '42501');
  a := tests.adm(format('select public.residentes_solicitud_rechazar(%L, ''duplicado'')->>''ok''', v_dani));
  b := tests.adm(format('select public.residentes_solicitud_aprobar(%L, ''Dani'', ''López'', ''Casa 99'', ''529981110040'')->>''motivo''', v_dani));
  perform tests.chk('RE-35d', 'rechazar por duplicado; aprobar después responde ya_revisada',
    a || '/' || b || '/' || (select estado || '|' || motivo_rechazo from public.residentes_solicitudes where id = v_dani), 'true/ya_revisada/rechazada|duplicado');
end $$;

do $$
declare v_t text := (select r.v from re_ids r where r.k = 'token2'); v_id uuid; v jsonb;
begin
  perform tests.enviar(v_t, 'Fede', 'Otro', 'Casa B1', '529981110050');
  v_id := (select id from public.residentes_solicitudes where nombre = 'Fede');
  v := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Fede', 'Otro', 'Casa B1', '529981110050', 'b1000000-0000-0000-0000-000000000000', false)::text$q$, v_id))::jsonb;
  perform tests.chk('RE-36', 'una vivienda de otro residencial no se acepta: unidad_no_valida (nada cambia en B)',
    (v->>'motivo') || '/' || (select count(*)::text from public.residentes_unidades where tenant_id = tests.tenant_b()), 'unidad_no_valida/0');
  v := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Fede2', 'Otro', 'Casa 40', '529981110050')::text$q$, v_id))::jsonb;
  perform tests.chk('RE-37', 'datos corregidos inválidos: datos_invalidos, sigue pendiente',
    (v->>'motivo') || '/' || (select estado from public.residentes_solicitudes where id = v_id), 'datos_invalidos/pendiente');
  update public.suscripciones set estado = 'expired' where tenant_id = tests.tenant_a();
  v := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Fede', 'Otro', 'Casa 40', '529981110050')::text$q$, v_id))::jsonb;
  perform tests.chk('RE-38', 'residencial no operativo: no se aprueba (no_operativo)', v->>'motivo', 'no_operativo');
  update public.suscripciones set estado = 'active' where tenant_id = tests.tenant_a();
end $$;

-- ── Lo que ve el guardia y la gestión posterior ───────────────
do $$
declare v_id uuid := (select id from public.residentes_unidades where nombre = 'Iván'); v jsonb; a text; b text; c text;
begin
  a := tests.re(tests.guard_a(), 'authenticated', 'select count(*)::text from public.residentes_unidades where origen = ''enlace''');
  b := tests.re(tests.guard_a(), 'authenticated', 'select count(*)::text from public.residentes_solicitudes where estado = ''pendiente''');
  c := tests.re('00000000-0000-0000-0000-0000000000b9', 'authenticated', 'select count(*)::text from public.residentes_unidades where origen = ''enlace''');
  perform tests.chk('RE-40', 'el guardia ve a los aprobados de su residencial (destinatarios) y no los pendientes; el de B no ve los de A',
    a || '/' || b || '/' || c, '2/0/0');
  perform tests.debe_fallar('RE-41a', 'el guardia no edita residentes',
    tests.q(tests.guard_a(), 'authenticated', format('select public.residentes_adicional_actualizar(%L, ''Iván'', ''Pérez'', ''529981110020'')::text', v_id)), '42501');
  v := tests.adm(format($q$select public.residentes_adicional_actualizar(%L, 'Iván', 'Pérez', '529981110021')::text$q$, v_id))::jsonb;
  perform tests.chk('RE-41b', 'el admin corrige a un residente aprobado',
    (v->>'ok') || '/' || (select apellido || '|' || telefono from public.residentes_unidades where id = v_id), 'true/Pérez|529981110021');
  v := tests.adm(format('select public.residentes_adicional_quitar(%L)::text', v_id))::jsonb;
  a := tests.re(tests.guard_a(), 'authenticated', 'select count(*)::text from public.residentes_unidades where origen = ''enlace'' and fecha_fin is null');
  perform tests.chk('RE-41c', 'quitarlo de la vivienda: queda con fecha de fin (historial) y el guardia deja de verlo como destinatario',
    (v->>'ok') || '/' || (select (fecha_fin is not null)::text from public.residentes_unidades where id = v_id) || '/' || a, 'true/true/1');
  perform tests.igual('RE-42', 'auditoría sin datos personales: solo resultado, vivienda o motivo',
    $q$select string_agg(distinct k, ',' order by k) from public.audit_log a, jsonb_object_keys(coalesce(a.datos_nuevos, '{}'::jsonb)) k
       where a.accion like 'residente%'$q$, 'motivo,resultado,unidad_id');
  perform tests.debe_fallar('RE-43', 'integridad: una persona sin cuenta exige nombre, apellido y WhatsApp',
    $q$insert into public.residentes_unidades (tenant_id, unidad_id, origen, nombre) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'enlace', 'Solo')$q$, '23514');
  perform tests.debe_fallar('RE-44', 'integridad: el WhatsApp guardado siempre está normalizado',
    $q$insert into public.residentes_unidades (tenant_id, unidad_id, origen, nombre, apellido, telefono) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'enlace', 'Ana', 'Paz', '998 123 4567')$q$, '23514');
  a := tests.adm(format('select public.residentes_enlace_desactivar(%L)::text', tests.tenant_a()));
  b := tests.srv(format('select public.residentes_enlace_publico(%L)->>''estado''', (select r.v from re_ids r where r.k = 'token2')));
  perform tests.chk('RE-45', 'desactivar el enlace: ninguno activo y el público responde revocado', a || '/' || b, '1/revocado');
end $$;

-- ── El destinatario queda en el paquete ───────────────────────
do $$
declare
  v_persona uuid; v_unidad uuid; v_ajena uuid; a text;
begin
  select id, unidad_id into v_persona, v_unidad from public.residentes_unidades
   where tenant_id = tests.tenant_a() and origen = 'enlace' and fecha_fin is null limit 1;
  a := tests.re(tests.guard_a(), 'authenticated', format(
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por, ubicacion_id, destinatario_nombre, destinatario_telefono, destinatario_residente_id)
       values (%L, %L, %L, 'a2000000-0000-0000-0000-000000000000', 'Persona Aprobada', '529981110099', %L)
       returning destinatario_nombre || '|' || destinatario_telefono || '|' || (destinatario_residente_id = %L)::text$q$,
    tests.tenant_a(), v_unidad, tests.guard_a(), v_persona, v_persona));
  perform tests.chk('RE-46a', 'el guardia registra el paquete con la persona elegida de esa vivienda: nombre, WhatsApp e id en el paquete',
    a, 'Persona Aprobada|529981110099|true');
  perform tests.debe_fallar('RE-46b', 'una persona de OTRA vivienda del mismo residencial no se acepta como destinataria',
    tests.q(tests.guard_a(), 'authenticated', format(
      $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por, ubicacion_id, destinatario_residente_id)
         values (%L, 'a1000000-0000-0000-0000-000000000000', %L, 'a2000000-0000-0000-0000-000000000000', %L) returning id::text$q$,
      tests.tenant_a(), tests.guard_a(), v_persona)), '23514');
  insert into public.residentes_unidades (tenant_id, unidad_id, origen, nombre, apellido, telefono)
  values (tests.tenant_b(), 'b1000000-0000-0000-0000-000000000000', 'enlace', 'Bruno', 'Ajeno', '529981110098') returning id into v_ajena;
  perform tests.debe_fallar('RE-46c', 'una persona de OTRO residencial no se acepta (aunque el guardia conozca su id)',
    tests.q(tests.guard_a(), 'authenticated', format(
      $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por, ubicacion_id, destinatario_residente_id)
         values (%L, %L, %L, 'a2000000-0000-0000-0000-000000000000', %L) returning id::text$q$,
      tests.tenant_a(), v_unidad, tests.guard_a(), v_ajena)), '23514');
  perform tests.igual('RE-46d', 'paquetes existentes: sin destinatario inventado (NULL)',
    $q$select coalesce(destinatario_nombre, 'null') || '|' || coalesce(destinatario_residente_id::text, 'null')
       from public.paquetes where id = 'a3000000-0000-0000-0000-000000000000'$q$, 'null|null');
end $$;

-- ── Residencial suspendido ────────────────────────────────────
do $$
declare v_t text; a text; b text; n text;
begin
  v_t := (tests.adm(format('select public.residentes_enlace_generar(%L)::text', tests.tenant_a()))::jsonb)->>'token';
  insert into re_ids values ('token3', v_t);
  n := (select count(*)::text from public.residentes_solicitudes);
  update public.tenants set estado_servicio = 'suspendido' where id = tests.tenant_a();
  a := tests.srv(format('select public.residentes_enlace_publico(%L)->>''estado''', v_t));
  b := tests.enviar(v_t, 'Olga', 'Suspendida', 'Casa 70', '529981110070');
  perform tests.chk('RE-26b', 'residencial suspendido: el enlace responde no_operativo y no guarda envíos',
    a || '/' || b || '/' || ((select count(*)::text from public.residentes_solicitudes) = n)::text, 'no_operativo/no_operativo/true');
  update public.tenants set estado_servicio = 'activo' where id = tests.tenant_a();
end $$;

-- ── Regenerar invalida el enlace anterior en el acto ──────────
do $$
declare v_t3 text := (select r.v from re_ids r where r.k = 'token3'); v_t4 text; a text; b text; c text; d text;
begin
  a := tests.enviar(v_t3, 'Hilda', 'Previa', 'Casa 60', '529981110061');
  v_t4 := (tests.adm(format('select public.residentes_enlace_generar(%L)::text', tests.tenant_a()))::jsonb)->>'token';
  insert into re_ids values ('token4', v_t4);
  b := tests.enviar(v_t3, 'Inés', 'Tarde', 'Casa 61', '529981110062');
  c := tests.srv(format('select public.residentes_enlace_publico(%L)->>''estado''', v_t3));
  d := tests.enviar(v_t4, 'Inés', 'Tarde', 'Casa 61', '529981110062');
  perform tests.chk('RE-47', 'regenerar invalida el anterior en el acto: el envío siguiente con él responde revocado y no se guarda; el nuevo recibe',
    a || '/' || b || '/' || c || '/' || d || '/' || (select count(*)::text from public.residentes_solicitudes where nombre = 'Inés')
    || '/' || (select count(*)::text from public.residentes_solicitudes s join public.residentes_enlaces e on e.id = s.enlace_id
               where s.nombre = 'Inés' and e.token = v_t4),
    'recibida/revocado/revocado/recibida/1/1');
end $$;

-- ── El mismo WhatsApp en dos residenciales ────────────────────
do $$
declare
  v_ta text := (select r.v from re_ids r where r.k = 'token4'); v_tb text;
  ja jsonb; jb jsonb; ra jsonb; rb jsonb;
begin
  v_tb := (tests.re(tests.admin_b(), 'authenticated', format('select public.residentes_enlace_generar(%L)::text', tests.tenant_b()))::jsonb)->>'token';
  ja := tests.enviar_j(v_ta, 'Gabi', 'Doble', 'Casa 50', '529981110077', repeat('a', 64));
  jb := tests.enviar_j(v_tb, 'Gabi', 'Doble', 'Casa 50', '529981110077', repeat('a', 64));
  insert into re_ids values ('gabi_a', ja->>'solicitud_id'), ('gabi_b', jb->>'solicitud_id');
  perform tests.chk('RE-50a', 'mismos datos y WhatsApp en A y en B (misma conexión): dos solicitudes, cada una en su residencial (no es un reenvío)',
    (ja->>'resultado') || '/' || (jb->>'resultado') || '/' || ((ja->>'solicitud_id') <> (jb->>'solicitud_id'))::text || '/'
    || (select tenant_id::text from public.residentes_solicitudes where id = (ja->>'solicitud_id')::uuid) || '/'
    || (select tenant_id::text from public.residentes_solicitudes where id = (jb->>'solicitud_id')::uuid),
    'recibida/recibida/true/aaaaaaaa-0000-0000-0000-000000000000/bbbbbbbb-0000-0000-0000-000000000000');
  -- Hugo usa en A el WhatsApp de Bruno, la persona aprobada de B (RE-46c).
  perform tests.enviar(v_ta, 'Hugo', 'Cruce', 'Casa 51', '529981110098');
  ra := tests.adm(format('select public.residentes_solicitudes_revision(%L)::text', tests.tenant_a()))::jsonb;
  rb := tests.re(tests.admin_b(), 'authenticated', format('select public.residentes_solicitudes_revision(%L)::text', tests.tenant_b()))::jsonb;
  perform tests.chk('RE-50b', 'coincidencias solo del mismo residencial: Gabi no ve su pendiente del otro, Hugo no ve a la persona de B, B solo ve lo suyo',
    (select jsonb_array_length(e->'coincidencias')::text from jsonb_array_elements(ra) e where e->>'nombre' = 'Gabi') || '/'
    || (select jsonb_array_length(e->'coincidencias')::text from jsonb_array_elements(ra) e where e->>'nombre' = 'Hugo') || '/'
    || (select jsonb_array_length(e->'coincidencias')::text from jsonb_array_elements(rb) e where e->>'nombre' = 'Gabi') || '/'
    || (select string_agg(e->>'nombre', ',') from jsonb_array_elements(rb) e),
    '0/0/0/Gabi');
  perform tests.debe_fallar('RE-50c', 'el admin de A no aprueba la solicitud de B',
    tests.q(tests.admin_a(), 'authenticated', format($q$select public.residentes_solicitud_aprobar(%L, 'Gabi', 'Doble', 'Casa 50', '529981110077')::text$q$, jb->>'solicitud_id')), '42501');
  perform tests.debe_fallar('RE-50d', 'quien es admin en A y guardia en B tampoco aprueba en B (su rol en B manda)',
    tests.q('00000000-0000-0000-0000-0000000000ab', 'authenticated', format($q$select public.residentes_solicitud_aprobar(%L, 'Gabi', 'Doble', 'Casa 50', '529981110077')::text$q$, jb->>'solicitud_id')), '42501');
end $$;

do $$
declare a text; b text;
begin
  a := tests.adm(format($q$select public.residentes_solicitud_aprobar(%L, 'Gabi', 'Doble', 'Casa 50', '529981110077')->>'resultado'$q$,
    (select r.v from re_ids r where r.k = 'gabi_a')));
  b := tests.re(tests.admin_b(), 'authenticated', format($q$select public.residentes_solicitud_aprobar(%L, 'Gabi', 'Doble', 'Casa 50', '529981110077')->>'resultado'$q$,
    (select r.v from re_ids r where r.k = 'gabi_b')));
  perform tests.chk('RE-50e', 'aprobadas las dos: una vivienda en cada residencial, sin posible_duplicado cruzado; cada guardia ve solo la suya',
    a || '/' || b || '/'
    || (select string_agg(tenant_id::text, ',' order by tenant_id) from public.unidades where contacto_telefono = '529981110077') || '/'
    || tests.re(tests.guard_a(), 'authenticated', 'select string_agg(tenant_id::text, '','') from public.unidades where contacto_telefono = ''529981110077''') || '/'
    || tests.re('00000000-0000-0000-0000-0000000000b9', 'authenticated', 'select string_agg(tenant_id::text, '','') from public.unidades where contacto_telefono = ''529981110077'''),
    'vivienda_nueva/vivienda_nueva/aaaaaaaa-0000-0000-0000-000000000000,bbbbbbbb-0000-0000-0000-000000000000/'
    || 'aaaaaaaa-0000-0000-0000-000000000000/bbbbbbbb-0000-0000-0000-000000000000');
end $$;

-- ── El guardia no revisa ni modifica residentes ───────────────
do $$
declare
  v_hugo uuid := (select id from public.residentes_solicitudes where nombre = 'Hugo');
  v_r uuid := (select id from public.residentes_unidades where tenant_id = tests.tenant_a() and origen = 'enlace' and fecha_fin is null limit 1);
begin
  perform tests.debe_fallar('RE-48a', 'el guardia no aprueba',
    tests.q(tests.guard_a(), 'authenticated', format($q$select public.residentes_solicitud_aprobar(%L, 'Hugo', 'Cruce', 'Casa 51', '529981110098')::text$q$, v_hugo)), '42501');
  perform tests.debe_fallar('RE-48b', 'el guardia no ve la revisión (pendientes y coincidencias)',
    tests.q(tests.guard_a(), 'authenticated', format('select public.residentes_solicitudes_revision(%L)::text', tests.tenant_a())), '42501');
  perform tests.debe_fallar('RE-48c', 'el guardia no desactiva el enlace',
    tests.q(tests.guard_a(), 'authenticated', format('select public.residentes_enlace_desactivar(%L)::text', tests.tenant_a())), '42501');
  perform tests.debe_fallar('RE-48d', 'el guardia no quita residentes',
    tests.q(tests.guard_a(), 'authenticated', format('select public.residentes_adicional_quitar(%L)::text', v_r)), '42501');
  perform tests.debe_fallar('RE-48e', 'el guardia no escribe solicitudes directo',
    tests.q(tests.guard_a(), 'authenticated', format('update public.residentes_solicitudes set estado = ''aprobada'' where id = %L returning id::text', v_hugo)), '42501');
  perform tests.chk('RE-48f', 'tras todos los intentos, la solicitud sigue pendiente y el enlace activo',
    (select estado from public.residentes_solicitudes where id = v_hugo) || '/'
    || (select count(*)::text from public.residentes_enlaces where tenant_id = tests.tenant_a() and activo), 'pendiente/1');
end $$;

-- ── Sin cuentas ni membresías ─────────────────────────────────
do $$ begin
  perform tests.chk('RE-49', 'envíos, aprobaciones y destinatarios no crearon auth.users, public.users ni user_tenants; las personas del enlace no tienen usuario',
    (select count(*) from auth.users)::text || '/' || (select count(*) from public.users)::text || '/' || (select count(*) from public.user_tenants)::text
    || '|' || (select count(*)::text from public.residentes_unidades where origen = 'enlace' and user_id is not null),
    (select r.v from re_ids r where r.k = 'cuentas') || '|0');
end $$;

rollback;

\endif
