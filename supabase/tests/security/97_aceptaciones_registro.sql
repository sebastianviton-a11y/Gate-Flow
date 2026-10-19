-- ============================================================
-- 20261017000000: evidencia de aceptación al registrarse y al aceptar
-- una invitación (Fase 3). Solo corre con la migración aplicada (fase
-- F3 del runner). Documentos y requisitos FICTICIOS creados dentro de
-- cada transacción (tests.lg_preparar, de 92_documentos_legales.sql) y
-- revertidos al final: nada queda cargado.
--   AR-0x  registro: compatibilidad sin requisitos; evidencia completa
--   AR-1x  registro: faltantes, cambios de versión, declaración, listas
--   AR-2x  registro: permisos y reversión del alta fallida
--   AR-3x  invitación: evidencia y fecha del servidor
--   AR-4x  invitación: faltantes, cambios, separación entre residenciales
--   AR-5x  users.terminos_aceptados_en solo la fija el servidor
-- ============================================================

create or replace function tests.ar() returns boolean language sql as $$
  select to_regprocedure('public.aceptar_documentos_invitacion(uuid,uuid[])') is not null
     and to_regprocedure('public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean,uuid[],boolean)') is not null
     and to_regprocedure('tests.lg_preparar()') is not null;
$$;
grant execute on function tests.ar() to anon, authenticated, service_role;

do $$ begin
  if not tests.ar() then raise notice 'INFO|97_aceptaciones_registro omitido: migración no aplicada'; end if;
end $$;

select tests.ar() as hay_ar \gset
\if :hay_ar

-- Alta como la hace el servidor (service_role): firma de 8 o de 6 argumentos.
create or replace function tests.ar_crear(p_uid uuid, p_ids uuid[], p_declara boolean default true, p_firma6 boolean default false)
returns text language sql as $$
  select tests.lg_llamar('00000000-0000-0000-0000-000000000000',
    case when p_firma6
      then format('select public.crear_cuenta_prueba(%L, %L, %L, %s, %L, %L)', p_uid, 'Residencial ZZ Fase 3', 'MX', 20, 'America/Mexico_City', true)
      else format('select public.crear_cuenta_prueba(%L, %L, %L, %s, %L, %L, %L::uuid[], %L)', p_uid, 'Residencial ZZ Fase 3', 'MX', 20,
                  'America/Mexico_City', true, p_ids, p_declara)
    end,
    'service_role');
$$;

-- Invitación con el JWT de p_uid.
create or replace function tests.ar_invitacion(p_uid uuid, p_tenant uuid, p_ids uuid[], p_rol text default 'authenticated')
returns text language sql as $$
  select tests.lg_llamar(p_uid, format('select public.aceptar_documentos_invitacion(%L, %L::uuid[])', p_tenant, p_ids), p_rol);
$$;

-- Cuentas creadas para el alta (sin membresías), como GoTrue.
create or replace function tests.ar_nueva_cuenta(p_uid uuid, p_correo text) returns void language plpgsql as $$
begin
  set local role supabase_auth_admin;
  execute format('insert into auth.users (id, email) values (%L, %L)', p_uid, p_correo);
  reset role;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ── AR-0x. Registro ─────────────────────────────────────────────────
begin;
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-0000000000d1';
  u2 uuid := '00000000-0000-0000-0000-0000000000d2';
  r text;
  t uuid;
begin
  perform tests.ar_nueva_cuenta(u1, 'zz_ar_d1@test.local');
  perform tests.ar_nueva_cuenta(u2, 'zz_ar_d2@test.local');

  -- Sin requisitos ni documentos (hoy): las dos firmas crean la cuenta sin evidencia.
  r := tests.ar_crear(u1, '{}');
  t := (r::jsonb->>'tenant_id')::uuid;
  perform tests.lg_ok('AR-01', 'sin requisitos: la firma nueva crea la cuenta y no registra evidencia',
    t is not null and (r::jsonb->>'aceptaciones')::int = 0 and not exists (select 1 from public.aceptaciones_legales where user_id = u1), r);
  r := tests.ar_crear(u2, null, false, true);
  perform tests.lg_ok('AR-02', 'sin requisitos: la firma anterior (6 argumentos) sigue funcionando igual',
    (r::jsonb->>'tenant_id') is not null and (select terminos_aceptados_en = now() from public.users where id = u2), r);
end $$;
rollback;

begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000d3';
  v_t uuid; v_p uuid; v_a uuid;
  r text;
  t uuid;
  filas text;
begin
  perform tests.ar_nueva_cuenta(u, 'zz_ar_d3@test.local');
  perform tests.lg_preparar();
  v_t := tests.lg_vid('terminos', '1.0'); v_p := tests.lg_vid('privacidad', '1.0'); v_a := tests.lg_vid('acuerdo_tratamiento', '1.0');

  r := tests.ar_crear(u, array[v_t, v_p, v_a]);
  t := (r::jsonb->>'tenant_id')::uuid;
  perform tests.lg_ok('AR-03', 'con requisitos y las 3 versiones mostradas: crea la cuenta y 3 aceptaciones', t is not null and (r::jsonb->>'aceptaciones')::int = 3, r);
  select string_agg(v.documento_clave || ':' || a.tipo || ':' || a.alcance || ':' || a.origen || ':' || a.declara_facultades
                    || ':' || (a.user_id = u) || ':' || (a.tenant_id = t) || ':' || (a.contenido_sha256 = v.contenido_sha256)
                    || ':' || (a.aceptado_en = now()), ',' order by v.documento_clave)
    into filas
  from public.aceptaciones_legales a join public.documentos_legales_versiones v on v.id = a.version_id
  where a.user_id = u;
  perform tests.lg_ok('AR-04', 'evidencia: versión, tipo, alcance, origen registro, usuario, residencial, hash de la versión y hora del servidor',
    filas = 'acuerdo_tratamiento:aceptacion:residencial:registro:true:true:true:true:true,'
         || 'privacidad:acuse:usuario:registro:false:true:true:true:true,'
         || 'terminos:aceptacion:usuario:registro:false:true:true:true:true', filas);
  perform tests.lg_ok('AR-05', 'users.terminos_aceptados_en = hora del servidor',
    (select terminos_aceptados_en = now() from public.users where id = u));
  perform tests.lg_ok('AR-06', 'separación: la evidencia es solo del residencial nuevo (ninguna fila en A, B ni P)',
    not exists (select 1 from public.aceptaciones_legales where tenant_id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000')));
end $$;
rollback;

-- ── AR-1x. Registro: lo que impide terminar el alta ─────────────────
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000d4';
  v_t uuid; v_p uuid; v_a uuid; v_t11 uuid; v_ar uuid;
  r text;
  nada boolean;
begin
  perform tests.ar_nueva_cuenta(u, 'zz_ar_d4@test.local');
  perform tests.lg_preparar();
  v_t := tests.lg_vid('terminos', '1.0'); v_p := tests.lg_vid('privacidad', '1.0'); v_a := tests.lg_vid('acuerdo_tratamiento', '1.0');
  v_ar := tests.lg_version('terminos', '1.0', 'AR');

  r := tests.ar_crear(u, null, false, true);
  perform tests.lg_ok('AR-10', 'con requisitos, la firma anterior no crea la cuenta (aceptacion_faltante)', r like 'ERR:22023:%aceptacion_faltante%', r);
  r := tests.ar_crear(u, array[v_t, v_a]);
  perform tests.lg_ok('AR-11', 'falta el Aviso de Privacidad → aceptacion_faltante (privacidad)', r like 'ERR:22023:%aceptacion_faltante (privacidad)%', r);
  r := tests.ar_crear(u, array[v_t, v_p, v_a], false);
  perform tests.lg_ok('AR-12', 'Acuerdo de Tratamiento sin declarar facultades → falta_declaracion_facultades', r like 'ERR:22023:%falta_declaracion_facultades%', r);
  r := tests.ar_crear(u, array[v_t, v_p, v_a, v_ar]);
  perform tests.lg_ok('AR-13', 'una versión de otro país → documento_cambiado', r like 'ERR:22023:%documento_cambiado%', r);
  r := tests.ar_crear(u, array[v_t, v_p, v_a, gen_random_uuid()]);
  perform tests.lg_ok('AR-14', 'una versión inexistente → documento_cambiado', r like 'ERR:22023:%documento_cambiado%', r);
  r := tests.ar_crear(u, array[v_t, v_t, v_p]);
  perform tests.lg_ok('AR-15', 'lista con repetidos → lista no válida', r like 'ERR:22023:%lista de versiones no válida%', r);
  r := tests.ar_crear(u, array[v_t, null, v_p]);
  perform tests.lg_ok('AR-16', 'lista con null → lista no válida', r like 'ERR:22023:%lista de versiones no válida%', r);

  -- El documento cambia mientras se llena el formulario: se publica 1.1 de Términos.
  v_t11 := tests.lg_version('terminos', '1.1', 'MX', 'publicado', now() - interval '1 minute');
  r := tests.ar_crear(u, array[v_t, v_p, v_a]);
  perform tests.lg_ok('AR-17', 'Términos 1.0 mostrado pero ya rige 1.1 → documento_cambiado (hay que aceptar de nuevo)', r like 'ERR:22023:%documento_cambiado%', r);

  select not exists (select 1 from public.user_tenants where user_id = u)
     and not exists (select 1 from public.aceptaciones_legales where user_id = u)
     and not exists (select 1 from public.tenants where nombre = 'Residencial ZZ Fase 3')
    into nada;
  perform tests.lg_ok('AR-18', 'ningún intento fallido dejó residencial, membresía ni evidencia', nada);

  r := tests.ar_crear(u, array[v_t11, v_p, v_a]);
  perform tests.lg_ok('AR-19', 'con la versión nueva mostrada, el alta termina y registra Términos 1.1',
    (r::jsonb->>'aceptaciones')::int = 3 and exists (select 1 from public.aceptaciones_legales where user_id = u and version_id = v_t11), r);
end $$;
rollback;

begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000d5';
  r text;
begin
  perform tests.ar_nueva_cuenta(u, 'zz_ar_d5@test.local');
  perform tests.lg_preparar();
  delete from public.requisitos_legales where documento_clave = 'acuerdo_tratamiento';
  insert into public.requisitos_legales (rol_clave, documento_clave, jurisdiccion, tipo, alcance)
  values ('admin_residencial', 'aviso_residentes', 'MX', 'acuse', 'usuario');
  r := tests.ar_crear(u, array[tests.lg_vid('terminos', '1.0'), tests.lg_vid('privacidad', '1.0')]);
  perform tests.lg_ok('AR-1A', 'requisito sin versión publicada → documento_no_disponible (cierre seguro, no se crea nada)',
    r like 'ERR:22023:%documento_no_disponible (aviso_residentes)%' and not exists (select 1 from public.user_tenants where user_id = u), r);
end $$;
rollback;

-- ── AR-2x. Registro: permisos y reversión ───────────────────────────
do $$
declare f text := 'public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean,uuid[],boolean)';
begin
  perform tests.lg_ok('AR-20', 'firma nueva: EXECUTE solo service_role',
    not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute'));
  perform tests.lg_ok('AR-21', 'firma anterior: sigue con EXECUTE solo service_role',
    not has_function_privilege('anon', 'public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)', 'execute')
    and has_function_privilege('service_role', 'public.crear_cuenta_prueba(uuid,text,text,integer,text,boolean)', 'execute'));
end $$;

-- auth.users del arnés no trae email_confirmed_at ni last_sign_in_at
-- (Supabase sí): se agregan dentro de la transacción.
begin;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists last_sign_in_at timestamptz;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000d6';
  ids uuid[];
  r text;
  rev jsonb;
begin
  perform tests.ar_nueva_cuenta(u, 'zz_ar_d6@test.local');
  perform tests.lg_preparar();
  ids := array[tests.lg_vid('terminos', '1.0'), tests.lg_vid('privacidad', '1.0'), tests.lg_vid('acuerdo_tratamiento', '1.0')];
  r := tests.ar_crear(u, ids);
  r := tests.lg_llamar(u, format('select public.revertir_cuenta_prueba(%L)', u), 'service_role');
  rev := r::jsonb;
  perform tests.lg_ok('AR-22', 'alta fallida (correo no enviado, cuenta sin confirmar): revertir borra el residencial y su evidencia',
    (rev->>'revertido')::boolean and not exists (select 1 from public.aceptaciones_legales where user_id = u)
    and not exists (select 1 from public.user_tenants where user_id = u), r);
end $$;
rollback;

begin;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists last_sign_in_at timestamptz;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000d7';
  ids uuid[];
  r text;
  t uuid;
begin
  perform tests.ar_nueva_cuenta(u, 'zz_ar_d7@test.local');
  perform tests.lg_preparar();
  ids := array[tests.lg_vid('terminos', '1.0'), tests.lg_vid('privacidad', '1.0'), tests.lg_vid('acuerdo_tratamiento', '1.0')];
  t := (tests.ar_crear(u, ids)::jsonb->>'tenant_id')::uuid;
  update auth.users set email_confirmed_at = now() where id = u;
  r := tests.lg_llamar(u, format('select public.revertir_cuenta_prueba(%L)', u), 'service_role');
  perform tests.lg_ok('AR-23', 'cuenta ya confirmada: revertir no borra nada y conserva la evidencia',
    r::jsonb->>'motivo' = 'evidencia_conservada' and (select count(*) from public.aceptaciones_legales where user_id = u) = 3
    and exists (select 1 from public.tenants where id = t), r);
end $$;
rollback;

-- ── AR-3x. Invitación: evidencia y fecha del servidor ───────────────
begin;
do $$
declare
  guard_a uuid := '00000000-0000-0000-0000-0000000000a9';
  admin_a uuid := '00000000-0000-0000-0000-00000000000a';
  ten_a uuid := 'aaaaaaaa-0000-0000-0000-000000000000';
  v_t uuid; v_p uuid;
  r text;
  filas text;
begin
  perform tests.lg_preparar();
  v_t := tests.lg_vid('terminos', '1.0'); v_p := tests.lg_vid('privacidad', '1.0');

  r := tests.ar_invitacion(guard_a, ten_a, array[v_p]);
  perform tests.lg_ok('AR-30', 'guardia invitado: registra el acuse del Aviso de Privacidad', (r::jsonb->>'registradas')::int = 1, r);
  select string_agg(a.tipo || ':' || a.alcance || ':' || a.origen || ':' || (a.tenant_id = ten_a) || ':'
                    || (a.contenido_sha256 = (select contenido_sha256 from public.documentos_legales_versiones where id = v_p)) || ':' || (a.aceptado_en = now()), ',')
    into filas from public.aceptaciones_legales a where a.user_id = guard_a;
  perform tests.lg_ok('AR-31', 'evidencia de la invitación: acuse, usuario, origen invitacion, residencial, hash y hora del servidor',
    filas = 'acuse:usuario:invitacion:true:true:true', filas);
  perform tests.lg_ok('AR-32', 'terminos_aceptados_en = hora del servidor (no la del navegador)',
    (select terminos_aceptados_en = now() from public.users where id = guard_a) and (r::jsonb->>'terminos_aceptados_en')::timestamptz = now(), r);

  r := tests.ar_invitacion(admin_a, ten_a, array[v_t, v_p]);
  perform tests.lg_ok('AR-33', 'administración invitada: Términos y Aviso por persona; el Acuerdo (del residencial) no se pide aquí',
    (r::jsonb->>'registradas')::int = 2
    and not exists (select 1 from public.aceptaciones_legales where user_id = admin_a and alcance = 'residencial'), r);
  r := tests.ar_invitacion(admin_a, ten_a, array[v_t, v_p]);
  perform tests.lg_ok('AR-34', 'repetir es idempotente (nada nuevo que registrar)',
    (r::jsonb->>'registradas')::int = 0 and (select count(*) from public.aceptaciones_legales where user_id = admin_a) = 2, r);
end $$;
rollback;

begin;
do $$
declare r text;
begin
  -- Sin requisitos ni documentos (hoy): solo la fecha del servidor.
  r := tests.ar_invitacion('00000000-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-000000000000', '{}');
  perform tests.lg_ok('AR-35', 'sin requisitos: la invitación solo fija terminos_aceptados_en con la hora del servidor',
    (r::jsonb->>'registradas')::int = 0 and (select terminos_aceptados_en = now() from public.users where id = '00000000-0000-0000-0000-0000000000a9'), r);
end $$;
rollback;

-- ── AR-4x. Invitación: faltantes, cambios y separación ──────────────
begin;
do $$
declare
  guard_a uuid := '00000000-0000-0000-0000-0000000000a9';
  admin_b uuid := '00000000-0000-0000-0000-00000000000b';
  mixto uuid := '00000000-0000-0000-0000-0000000000ab';
  ten_a uuid := 'aaaaaaaa-0000-0000-0000-000000000000';
  ten_b uuid := 'bbbbbbbb-0000-0000-0000-000000000000';
  v_p uuid; v_p11 uuid;
  antes timestamptz;
  r text;
begin
  perform tests.lg_preparar();
  v_p := tests.lg_vid('privacidad', '1.0');
  update public.users set terminos_aceptados_en = '2020-01-01' where id = guard_a;

  r := tests.ar_invitacion(guard_a, ten_a, '{}');
  perform tests.lg_ok('AR-40', 'sin el documento pendiente → aceptacion_faltante y no fija la fecha',
    r like 'ERR:22023:%aceptacion_faltante (privacidad)%' and (select terminos_aceptados_en = '2020-01-01' from public.users where id = guard_a), r);
  r := tests.ar_invitacion(guard_a, ten_b, array[v_p]);
  perform tests.lg_ok('AR-41', 'separación: un guardia de A no acepta en nombre de B (sin membresía)',
    r like 'ERR:42501:%sin membresía activa%' and not exists (select 1 from public.aceptaciones_legales where tenant_id = ten_b), r);
  r := tests.ar_invitacion(admin_b, ten_a, array[v_p]);
  perform tests.lg_ok('AR-42', 'separación: la administración de B no registra nada en A', r like 'ERR:42501:%' and not exists (select 1 from public.aceptaciones_legales where tenant_id = ten_a), r);
  r := tests.ar_invitacion(mixto, ten_b, array[v_p]);
  perform tests.lg_ok('AR-43', 'mixto (admin en A, guardia en B): en B registra según su rol de guardia y solo en B',
    (r::jsonb->>'registradas')::int = 1 and (select string_agg(tenant_id::text, ',') from public.aceptaciones_legales where user_id = mixto) = ten_b::text, r);

  v_p11 := tests.lg_version('privacidad', '1.1', 'MX', 'publicado', now() - interval '1 minute');
  r := tests.ar_invitacion(guard_a, ten_a, array[v_p]);
  perform tests.lg_ok('AR-44', 'Aviso 1.0 mostrado pero ya rige 1.1 → documento_cambiado', r like 'ERR:22023:%documento_cambiado%', r);
  r := tests.ar_invitacion(guard_a, ten_a, array[v_p11]);
  perform tests.lg_ok('AR-45', 'con la versión nueva mostrada, registra 1.1', (r::jsonb->>'registradas')::int = 1
    and exists (select 1 from public.aceptaciones_legales where user_id = guard_a and version_id = v_p11), r);
  r := tests.ar_invitacion(guard_a, ten_a, array[v_p11], 'anon');
  perform tests.lg_ok('AR-46', 'anon no puede llamar la invitación', r like 'ERR:42501:%', r);
  perform tests.lg_ok('AR-47', 'EXECUTE de aceptar_documentos_invitacion solo para authenticated',
    has_function_privilege('authenticated', 'public.aceptar_documentos_invitacion(uuid,uuid[])', 'execute')
    and not has_function_privilege('anon', 'public.aceptar_documentos_invitacion(uuid,uuid[])', 'execute')
    and not has_function_privilege('service_role', 'public.aceptar_documentos_invitacion(uuid,uuid[])', 'execute'));
end $$;
rollback;

-- ── AR-5x. users.terminos_aceptados_en solo la fija el servidor ─────
begin;
do $$
declare
  admin_a uuid := '00000000-0000-0000-0000-00000000000a';
  r text;
begin
  perform tests.como(admin_a);
  execute 'set local role authenticated';
  perform tests.debe_fallar('AR-50', 'el navegador (authenticated) no puede escribir terminos_aceptados_en',
    format($q$update public.users set terminos_aceptados_en = '2030-01-01' where id = %L$q$, admin_a), '42501');
  perform tests.filas('AR-51', 'el resto del perfil propio se sigue editando (nombre)',
    format($q$update public.users set nombre_completo = 'Admin A ZZ' where id = %L$q$, admin_a), 1);
  execute 'reset role';
  r := (select terminos_aceptados_en::text from public.users where id = admin_a);
  perform tests.lg_ok('AR-53', 'la fecha no cambió tras el intento del navegador', r is distinct from '2030-01-01 00:00:00+00', coalesce(r, 'null'));
  perform tests.lg_ok('AR-52', 'la función del trigger no es ejecutable por la API',
    not has_function_privilege('anon', 'public.users_terminos_solo_servidor()', 'execute')
    and not has_function_privilege('authenticated', 'public.users_terminos_solo_servidor()', 'execute')
    and not has_function_privilege('service_role', 'public.users_terminos_solo_servidor()', 'execute'));
end $$;
rollback;

\endif
