-- ============================================================
-- /registro + trial (20261006000000_registro_trial.sql).
-- Solo corre cuando la migración está aplicada (fase T del runner);
-- en las demás fases no emite nada.
--
-- Usuarios de los fixtures: solo (…0099) no tiene membresía;
-- admin_a (…000a) es admin de A; super (…0001) es super_admin en P.
-- ============================================================

do $$ begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then
    raise notice 'INFO|70_registro_trial omitido: migración de registro/trial no aplicada';
  end if;
end $$;

-- ── Backfill: tenants existentes ──────────────────────────────
do $$
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  perform tests.igual('RT-21', 'backfill: cada tenant existente tiene suscripción active + alta_manual',
    $q$select count(*)::text from public.tenants t
       where not exists (select 1 from public.suscripciones s where s.tenant_id = t.id
                         and s.estado = 'active' and s.origen = 'alta_manual')$q$, '0');
  perform tests.igual('RT-22', 'backfill: ningún tenant existente recibe trial (fechas nulas)',
    $q$select count(*)::text from public.suscripciones
       where origen = 'alta_manual' and (trial_started_at is not null or trial_ends_at is not null)$q$, '0');
  perform tests.igual('RT-22b', 'backfill: una fila por tenant',
    $q$select (count(*) = (select count(*) from public.tenants))::text from public.suscripciones$q$, 'true');
end $$;

-- ── EXECUTE: solo service_role ────────────────────────────────
do $$
declare f text;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  foreach f in array array[
    'public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)',
    'public.revertir_cuenta_prueba(uuid)',
    'public.registro_intento_permitido(text,text)',
    'public.registro_intento_resultado(uuid,text,text)',
    'public.crear_suscripcion_alta_manual(uuid)'
  ] loop
    perform tests.igual('RT-12-' || split_part(split_part(f, '.', 2), '(', 1), 'EXECUTE de ' || f || ' = solo service_role',
      format($q$select 'anon=' || has_function_privilege('anon', %L, 'execute')
                || ',auth=' || has_function_privilege('authenticated', %L, 'execute')
                || ',svc=' || has_function_privilege('service_role', %L, 'execute')
                || ',public=' || exists (select 1 from aclexplode((select proacl from pg_proc where oid = %L::regprocedure)) a where a.grantee = 0)$q$,
             f, f, f, f),
      'anon=false,auth=false,svc=true,public=false');
    perform tests.igual('RT-12s-' || split_part(split_part(f, '.', 2), '(', 1), f || ' es DEFINER con search_path vacío',
      format($q$select prosecdef::text || '|' || coalesce(array_to_string(proconfig, ','), '-') from pg_proc where oid = %L::regprocedure$q$, f),
      'true|search_path=""');
  end loop;
end $$;

begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  perform tests.debe_fallar('RT-12a', 'authenticated no ejecuta crear_cuenta_prueba',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Res', 'MX', 10, null, true)$q$, '42501');
  perform tests.debe_fallar('RT-12b', 'authenticated no ejecuta registro_intento_permitido',
    $q$select public.registro_intento_permitido(repeat('a', 64), null)$q$, '42501');
  perform tests.debe_fallar('RT-17', 'authenticated no modifica suscripciones (sin grant)',
    $q$update public.suscripciones set estado = 'active' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('RT-17b', 'authenticated no inserta suscripciones',
    $q$insert into public.suscripciones (tenant_id, estado, origen) values ('aaaaaaaa-0000-0000-0000-000000000000', 'active', 'alta_manual')$q$, '42501');
  perform tests.debe_fallar('RT-17c', 'authenticated no lee registro_intentos',
    $q$select count(*) from public.registro_intentos$q$, '42501');
end $$;
rollback;

begin;
set local role anon;
do $$ begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  perform tests.debe_fallar('RT-12c', 'anon no ejecuta crear_cuenta_prueba',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Res', 'MX', 10, null, true)$q$, '42501');
  perform tests.debe_fallar('RT-12d', 'anon no lee suscripciones',
    $q$select count(*) from public.suscripciones$q$, '42501');
end $$;
rollback;

-- ── RLS de suscripciones ──────────────────────────────────────
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  perform tests.igual('RT-15', 'admin A lee la suscripción de A y no la de B',
    $q$select string_agg(tenant_id::text, ',' order by tenant_id) from public.suscripciones$q$,
    'aaaaaaaa-0000-0000-0000-000000000000');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  perform tests.igual('RT-16', 'super_admin lee todas las suscripciones',
    $q$select (count(*) = (select count(*) from public.tenants))::text from public.suscripciones$q$, 'true');
end $$;
rollback;

-- ── crear_cuenta_prueba: validaciones (nada se crea) ──────────
-- Las RPC se llaman como service_role; las tablas se leen como
-- postgres (service_role no tiene grants en suscripciones a propósito).
begin;
do $$
declare
  v_antes text;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  v_antes := (select count(*) from public.tenants) || '|' || (select count(*) from public.empresas) || '|'
          || (select count(*) from public.user_tenants) || '|' || (select count(*) from public.suscripciones);
  execute 'set local role service_role';

  perform tests.debe_fallar('RT-04', 'residencial vacío → 22023',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', '   ', 'MX', 10, null, true)$q$, '22023');
  perform tests.debe_fallar('RT-05a', 'viviendas 0 → 22023',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Prueba', 'MX', 0, null, true)$q$, '22023');
  perform tests.debe_fallar('RT-05b', 'viviendas -5 → 22023',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Prueba', 'MX', -5, null, true)$q$, '22023');
  perform tests.debe_fallar('RT-23', 'más de 150 viviendas → 22023 (autoservicio hasta 150)',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Prueba', 'MX', 151, null, true)$q$, '22023');
  perform tests.debe_fallar('RT-06a', 'país US → 22023',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Prueba', 'US', 10, null, true)$q$, '22023');
  perform tests.debe_fallar('RT-06b', 'país en minúsculas (mx) → 22023: el servidor normaliza, la RPC no adivina',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Prueba', 'mx', 10, null, true)$q$, '22023');
  perform tests.debe_fallar('RT-24', 'sin aceptar términos → 22023',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Prueba', 'MX', 10, null, false)$q$, '22023');
  perform tests.debe_fallar('RT-24b', 'términos null → 22023',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Prueba', 'MX', 10, null, null)$q$, '22023');
  perform tests.debe_fallar('RT-03', 'usuario que ya tiene membresía (admin_a) → 42501',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-00000000000a', 'Residencial Prueba', 'MX', 10, null, true)$q$, '42501');
  perform tests.debe_fallar('RT-03b', 'usuario inexistente → 22023',
    $q$select public.crear_cuenta_prueba('dddddddd-0000-0000-0000-000000000000', 'Residencial Prueba', 'MX', 10, null, true)$q$, '22023');
  execute 'reset role';

  perform tests.igual('RT-14', 'ninguna validación fallida dejó filas (tenants|empresas|membresías|suscripciones)',
    format($q$select %L$q$, (select count(*) from public.tenants) || '|' || (select count(*) from public.empresas) || '|'
          || (select count(*) from public.user_tenants) || '|' || (select count(*) from public.suscripciones)), v_antes);
end $$;
rollback;

-- ── crear_cuenta_prueba: alta válida MX ───────────────────────
begin;
set local role service_role;
do $$
declare
  r jsonb;
  v_tenant uuid;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', '  Residencial   Las Palmas ', 'MX', 48, 'America/Cancun', true);
  v_tenant := (r->>'tenant_id')::uuid;
  execute 'reset role';
  perform tests.igual('RT-01', 'MX: tenant nuevo con nombre normalizado, tipo residencial, trial/activo, onboarding pendiente',
    format($q$select nombre || '|' || tipo || '|' || pais || '|' || plan || '|' || estado_servicio || '|' || onboarding_completado from public.tenants where id = %L$q$, v_tenant),
    'Residencial Las Palmas|residencial|MX|trial|activo|false');
  perform tests.igual('RT-01b', 'MX: empresa nueva con el mismo nombre, país y correo del perfil',
    format($q$select e.nombre || '|' || e.pais || '|' || e.correo_principal || '|' || e.plan || '|' || e.estado_servicio || '|' || (select count(*) from public.tenants t where t.empresa_id = e.id)
             from public.empresas e where e.id = %L$q$, r->>'empresa_id'),
    'Residencial Las Palmas|MX|solo@test.local|trial|activo|1');
  perform tests.igual('RT-10', 'primer usuario = admin_residencial activo, única membresía del tenant',
    format($q$select string_agg(ro.clave || ':' || ut.activo, ',') from public.user_tenants ut join public.roles ro on ro.id = ut.rol_id where ut.tenant_id = %L$q$, v_tenant),
    'admin_residencial:true');
  perform tests.igual('RT-09', 'trial: trialing, registro_publico, empieza ahora y termina exactamente 30 días después',
    format($q$select estado || '|' || origen || '|' || (trial_started_at = now())::text || '|' || (trial_ends_at = trial_started_at + interval '30 days')::text || '|' || viviendas_declaradas
             from public.suscripciones where tenant_id = %L$q$, v_tenant),
    'trialing|registro_publico|true|true|48');
  perform tests.igual('RT-25', 'timezone IANA válida del navegador se conserva',
    format($q$select timezone from public.tenants where id = %L$q$, v_tenant), 'America/Cancun');
  perform tests.igual('RT-05c', 'términos aceptados quedan en public.users',
    $q$select (terminos_aceptados_en is not null)::text from public.users where id = '00000000-0000-0000-0000-000000000099'$q$, 'true');
  perform tests.igual('RT-01c', 'auditoría: registro.cuenta_creada + membresia.otorgada, a nombre del usuario',
    format($q$select string_agg(accion, ',' order by accion) || '|' || count(distinct user_id) from public.audit_log where tenant_id = %L$q$, v_tenant),
    'membresia.otorgada,registro.cuenta_creada|1');
  perform tests.igual('RT-01d', 'el correo del tenant es el del perfil (dato de servidor)',
    format($q$select correo from public.tenants where id = %L$q$, v_tenant), 'solo@test.local');
  execute 'set local role service_role';
  perform tests.debe_fallar('RT-03c', 'segunda llamada con el mismo usuario → 42501 (ya tiene membresía)',
    $q$select public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Otro', 'MX', 10, null, true)$q$, '42501');
end $$;
rollback;

-- ── alta válida AR + timezone inválida ────────────────────────
begin;
set local role service_role;
do $$
declare r jsonb;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Barrio Cerrado Norte', 'AR', 150, 'Marte/Olympus', true);
  execute 'reset role';
  perform tests.igual('RT-02', 'AR: tenant con país AR y 150 viviendas (límite incluido)',
    format($q$select t.pais || '|' || s.viviendas_declaradas from public.tenants t join public.suscripciones s on s.tenant_id = t.id where t.id = %L$q$, r->>'tenant_id'),
    'AR|150');
  perform tests.igual('RT-26', 'timezone inválida → fallback del país (AR)',
    format($q$select timezone from public.tenants where id = %L$q$, r->>'tenant_id'), 'America/Argentina/Buenos_Aires');
end $$;
rollback;

begin;
set local role service_role;
do $$
declare r jsonb;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Sin TZ', 'MX', 1, null, true);
  execute 'reset role';
  perform tests.igual('RT-26b', 'sin timezone → fallback del país (MX)',
    format($q$select timezone from public.tenants where id = %L$q$, r->>'tenant_id'), 'America/Mexico_City');
end $$;
rollback;

-- ── revertir_cuenta_prueba ────────────────────────────────────
begin;
set local role service_role;
do $$
declare
  r jsonb; rev jsonb; v_tenant uuid; v_empresa uuid;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Reversible', 'MX', 20, null, true);
  v_tenant := (r->>'tenant_id')::uuid; v_empresa := (r->>'empresa_id')::uuid;
  rev := public.revertir_cuenta_prueba('00000000-0000-0000-0000-000000000099');
  execute 'reset role';
  perform tests.igual('RT-27', 'alta recién creada se revierte completa (sin huérfanos)',
    format($q$select %L || '|' || (select count(*) from public.tenants where id = %L) || (select count(*) from public.empresas where id = %L)
             || (select count(*) from public.user_tenants where user_id = '00000000-0000-0000-0000-000000000099')
             || (select count(*) from public.suscripciones where tenant_id = %L) || (select count(*) from public.audit_log where tenant_id = %L)$q$,
           rev->>'revertido', v_tenant, v_empresa, v_tenant, v_tenant),
    'true|00000');
  perform tests.igual('RT-27b', 'el perfil del usuario sigue (lo borra el servidor con la API de Auth)',
    $q$select count(*)::text from public.users where id = '00000000-0000-0000-0000-000000000099'$q$, '1');
  perform tests.igual('RT-27c', 'revertir de nuevo no hace nada',
    $q$select (public.revertir_cuenta_prueba('00000000-0000-0000-0000-000000000099'))->>'motivo'$q$, 'usuario_sin_membresia_unica');
end $$;
rollback;

begin;
set local role service_role;
do $$
declare rev jsonb;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  rev := public.revertir_cuenta_prueba('00000000-0000-0000-0000-00000000000a');
  perform tests.igual('RT-28', 'tenant de alta manual (active/alta_manual) no se puede revertir',
    format($q$select %L$q$, rev->>'revertido' || '|' || (rev->>'motivo')), 'false|suscripcion_no_revertible');
  perform tests.igual('RT-28b', 'el tenant A sigue intacto',
    $q$select count(*)::text from public.tenants where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '1');
end $$;
rollback;

begin;
set local role service_role;
do $$
declare r jsonb; rev jsonb; v_tenant uuid;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Con Onboarding', 'MX', 20, null, true);
  v_tenant := (r->>'tenant_id')::uuid;
  execute 'reset role';
  update public.tenants set onboarding_completado = true where id = v_tenant;
  execute 'set local role service_role';
  rev := public.revertir_cuenta_prueba('00000000-0000-0000-0000-000000000099');
  perform tests.igual('RT-29a', 'con onboarding completado no se revierte',
    format($q$select %L$q$, (rev->>'revertido') || '|' || (rev->>'motivo')), 'false|tenant_no_revertible');
end $$;
rollback;

begin;
set local role service_role;
do $$
declare r jsonb; rev jsonb; v_tenant uuid;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Con Actividad', 'MX', 20, null, true);
  v_tenant := (r->>'tenant_id')::uuid;
  execute 'reset role';
  insert into public.ubicaciones (tenant_id, nombre, tipo_nodo) values (v_tenant, 'Bodega', 'bodega');
  execute 'set local role service_role';
  rev := public.revertir_cuenta_prueba('00000000-0000-0000-0000-000000000099');
  perform tests.igual('RT-29b', 'con actividad operativa (ubicaciones) no se revierte',
    format($q$select %L$q$, (rev->>'revertido') || '|' || (rev->>'motivo')), 'false|actividad:ubicaciones');
  perform tests.igual('RT-29c', 'y nada se borró',
    format($q$select (count(*) = 1)::text from public.tenants where id = %L$q$, v_tenant), 'true');
end $$;
rollback;

begin;
set local role service_role;
do $$
declare r jsonb; rev jsonb; v_tenant uuid;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Con Guardia', 'MX', 20, null, true);
  v_tenant := (r->>'tenant_id')::uuid;
  perform public.otorgar_membresia('00000000-0000-0000-0000-0000000000f1', v_tenant, 'guardia', '00000000-0000-0000-0000-000000000099');
  rev := public.revertir_cuenta_prueba('00000000-0000-0000-0000-000000000099');
  perform tests.igual('RT-29d', 'con un segundo miembro no se revierte',
    format($q$select %L$q$, (rev->>'revertido') || '|' || (rev->>'motivo')), 'false|tenant_con_mas_miembros');
end $$;
rollback;

-- ── registro_intentos ─────────────────────────────────────────
begin;
set local role service_role;
do $$
declare
  e1 text := repeat('1', 64); e2 text := repeat('2', 64); e3 text := repeat('3', 64); e4 text := repeat('4', 64);
  e5 text := repeat('5', 64); e6 text := repeat('6', 64);
  ip text := repeat('a', 64);
  r jsonb; i int; ids uuid[] := '{}';
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;

  for i in 1..3 loop
    r := public.registro_intento_permitido(e1, ip);
    ids := ids || (r->>'intento_id')::uuid;
  end loop;
  perform tests.igual('RT-18a', '3 intentos/h por correo permitidos; el 4.º bloqueado por correo',
    format($q$select (%L::jsonb->>'permitido') || '|' || coalesce(%L::jsonb->>'motivo', '-')$q$,
           public.registro_intento_permitido(e1, ip), public.registro_intento_permitido(e1, ip)),
    'false|limite_email_hora');
  -- Ya hay 5 filas de esta IP (3 iniciados + 2 bloqueados): la IP se bloquea aunque el correo sea nuevo.
  perform tests.igual('RT-18b', '5 intentos/h por IP: el siguiente, con otro correo, bloqueado por IP',
    format($q$select (%L::jsonb->>'permitido') || '|' || coalesce(%L::jsonb->>'motivo', '-')$q$,
           public.registro_intento_permitido(e2, ip), public.registro_intento_permitido(e2, ip)),
    'false|limite_ip_hora');
  perform tests.igual('RT-18c', 'otra IP con el mismo correo nuevo sí pasa',
    format($q$select %L::jsonb->>'permitido'$q$, public.registro_intento_permitido(e3, repeat('b', 64))), 'true');
  perform tests.igual('RT-18d', 'sin IP (null) solo aplica el límite por correo',
    format($q$select %L::jsonb->>'permitido'$q$, public.registro_intento_permitido(e4, null)), 'true');
  -- Lecturas directas de la tabla: como postgres (service_role no tiene grants).
  execute 'reset role';
  perform tests.igual('RT-18e', 'todos los intentos quedan registrados solo como hashes',
    $q$select (count(*) = count(*) filter (where email_hash ~ '^[0-9a-f]{64}$' and (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$')))::text from public.registro_intentos$q$, 'true');

  -- La llamada y la comprobación van en sentencias distintas: dentro
  -- de una misma sentencia las subconsultas ven la instantánea previa.
  perform tests.igual('RT-30', 'registro_intento_resultado devuelve true para el intento indicado',
    format($q$select public.registro_intento_resultado(%L, 'exito', null)::text$q$, ids[1]), 'true');
  perform tests.igual('RT-30a', 'y solo ese intento quedó en exito',
    format($q$select (select estado from public.registro_intentos where id = %L) || '|' ||
             (select count(*) from public.registro_intentos where estado = 'exito')$q$, ids[1]),
    'exito|1');
  perform tests.igual('RT-30b', 'un intento ya cerrado no se vuelve a modificar',
    format($q$select public.registro_intento_resultado(%L, 'fallo', 'x')::text || '|' || (select estado from public.registro_intentos where id = %L)$q$, ids[1], ids[1]),
    'false|exito');
  perform tests.igual('RT-30c', 'un id inexistente no modifica nada',
    $q$select public.registro_intento_resultado('dddddddd-0000-0000-0000-000000000000', 'fallo', 'x')::text$q$, 'false');
  perform tests.debe_fallar('RT-30d', 'estado fuera de exito/fallo → 22023',
    format($q$select public.registro_intento_resultado(%L, 'bloqueado', null)$q$, ids[2]), '22023');
  perform tests.debe_fallar('RT-18f', 'hash mal formado → 22023',
    $q$select public.registro_intento_permitido('no-es-un-hash', null)$q$, '22023');
end $$;
rollback;

-- Límite diario por IP: 20 en 24 h aunque estén repartidos en horas distintas.
begin;
set local role service_role;
do $$
declare ip text := repeat('c', 64); i int; r jsonb;
begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  execute 'reset role';
  -- 20 intentos "viejos" de hoy (hace 2-5 h, distintos correos) para esta IP.
  for i in 1..20 loop
    insert into public.registro_intentos (email_hash, ip_hash, estado, created_at)
    values (lpad(to_hex(i), 64, '0'), ip, 'fallo', now() - interval '2 hours' - (i || ' minutes')::interval);
  end loop;
  execute 'set local role service_role';
  r := public.registro_intento_permitido(repeat('d', 64), ip);
  perform tests.igual('RT-18g', '20 intentos/24 h por IP: el 21.º bloqueado por día',
    format($q$select %L$q$, (r->>'permitido') || '|' || (r->>'motivo')), 'false|limite_ip_dia');
end $$;
rollback;

-- ── Sin tenant inventado ni cambios en lo existente ───────────
do $$ begin
  if to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)') is null then return; end if;
  perform tests.igual('RT-13', 'las membresías existentes no cambian con la migración',
    $q$select count(*)::text from public.user_tenants$q$, '10');
end $$;

-- ── Alta manual futura (Super Admin): crear_suscripcion_alta_manual ─
-- El tenant lo crea el super_admin con su sesión (RLS
-- tenants_insert_super_admin); la suscripción la crea el servidor con
-- service_role. Aquí el tenant se inserta como postgres.
begin;
do $$
declare
  v_tenant uuid; r jsonb; r2 jsonb;
begin
  if to_regprocedure('public.crear_suscripcion_alta_manual(uuid)') is null then return; end if;
  insert into public.tenants (nombre, tipo, empresa_id, plan, estado_servicio, onboarding_completado)
  values ('Residencial Manual Nuevo', 'residencial', 'e0000000-0000-0000-0000-000000000001', 'piloto', 'piloto', false)
  returning id into v_tenant;
  perform tests.igual('RT-33pre', 'un tenant creado después de la migración no tiene suscripción hasta que el servidor la crea',
    format($q$select count(*)::text from public.suscripciones where tenant_id = %L$q$, v_tenant), '0');

  execute 'set local role service_role';
  r := public.crear_suscripcion_alta_manual(v_tenant);
  r2 := public.crear_suscripcion_alta_manual(v_tenant);
  execute 'reset role';

  perform tests.igual('RT-33', 'alta manual nueva → suscripción active + alta_manual',
    format($q$select estado || '|' || origen || '|' || %L from public.suscripciones where tenant_id = %L$q$, r->>'creada', v_tenant),
    'active|alta_manual|true');
  perform tests.igual('RT-34', 'alta manual sin trial_started_at, trial_ends_at ni viviendas',
    format($q$select (trial_started_at is null)::text || (trial_ends_at is null)::text || (viviendas_declaradas is null)::text from public.suscripciones where tenant_id = %L$q$, v_tenant),
    'truetruetrue');
  perform tests.igual('RT-37', 'segunda llamada: creada=false, misma suscripción, sigue habiendo una sola',
    format($q$select %L || '|' || (%L = %L)::text || '|' || (select count(*) from public.suscripciones where tenant_id = %L)$q$,
           r2->>'creada', r->>'suscripcion_id', r2->>'suscripcion_id', v_tenant),
    'false|true|1');
  perform tests.debe_fallar('RT-37b', 'una segunda fila para el mismo tenant viola unique(tenant_id) → 23505',
    format($q$insert into public.suscripciones (tenant_id, estado, origen) values (%L, 'active', 'alta_manual')$q$, v_tenant), '23505');
  execute 'set local role service_role';
  perform tests.debe_fallar('RT-33b', 'tenant inexistente → 22023',
    $q$select public.crear_suscripcion_alta_manual('dddddddd-0000-0000-0000-000000000000')$q$, '22023');
  perform tests.debe_fallar('RT-36', 'la RPC no acepta estado ni origen (firma de un solo parámetro) → 42883',
    format($q$select public.crear_suscripcion_alta_manual(%L, 'trialing', 'registro_publico')$q$, v_tenant), '42883');
end $$;
rollback;

-- RT-35: la alta pública sigue trialing aunque después se llame a la de alta manual.
begin;
set local role service_role;
do $$
declare r jsonb; r2 jsonb;
begin
  if to_regprocedure('public.crear_suscripcion_alta_manual(uuid)') is null then return; end if;
  r := public.crear_cuenta_prueba('00000000-0000-0000-0000-000000000099', 'Residencial Público', 'MX', 10, null, true);
  r2 := public.crear_suscripcion_alta_manual((r->>'tenant_id')::uuid);
  execute 'reset role';
  perform tests.igual('RT-35', 'registro público: trialing/registro_publico se conserva; la alta manual no lo pisa (creada=false)',
    format($q$select estado || '|' || origen || '|' || (trial_ends_at is not null)::text || '|' || %L || '|' || (select count(*) from public.suscripciones where tenant_id = %L)
             from public.suscripciones where tenant_id = %L$q$, r2->>'creada', r->>'tenant_id', r->>'tenant_id'),
    'trialing|registro_publico|true|false|1');
end $$;
rollback;

-- RT-36b: el super_admin, con su sesión, no puede crear la suscripción por su cuenta.
begin;
select tests.como('00000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.crear_suscripcion_alta_manual(uuid)') is null then return; end if;
  perform tests.debe_fallar('RT-36b', 'super_admin (authenticated) no ejecuta crear_suscripcion_alta_manual',
    $q$select public.crear_suscripcion_alta_manual('aaaaaaaa-0000-0000-0000-000000000000')$q$, '42501');
  perform tests.debe_fallar('RT-36c', 'super_admin (authenticated) no inserta suscripciones ni elige estado/origen',
    $q$insert into public.suscripciones (tenant_id, estado, origen) values ('aaaaaaaa-0000-0000-0000-000000000000', 'trialing', 'registro_publico')$q$, '42501');
end $$;
rollback;
