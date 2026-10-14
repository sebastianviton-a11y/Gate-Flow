-- ============================================================
-- 20261014000000: documentos legales versionados y evidencia de
-- aceptaciones (Fase 1, INACTIVA). Solo corre con la migración aplicada
-- (fase LG del runner).
--   DL-0x  inactividad: sin versiones, requisitos ni permisos para la API
--   DL-1x  versiones: transiciones, inmutabilidad, auditoría, TRUNCATE
--   DL-3x  requisitos: forma y auditoría
--   DL-4x  vigentes / publicado
--   DL-5x  pendientes y registro (multitenant, mínimo privilegio, alcance
--          de residencial, versiones nuevas, país)
--   DL-7x  consentimiento y revocación
--   DL-8x  evidencia inmutable y validación al insertar
--   DL-9x  la evidencia sobrevive a la cuenta y al residencial; descarte
--          solo de un alta fallida
-- Para probar las funciones como la API, cada caso concede EXECUTE a
-- authenticated DENTRO de su transacción (se revierte con el ROLLBACK):
-- en la migración nadie lo tiene. La concurrencia real (dos sesiones)
-- está en concurrencia_aceptaciones.sh.
--   A  admin_a, guard_a, mixto (admin en A), admin_ab (admin en A y B)
--   B  admin_b, guard_b; en algunos casos B pasa a Argentina (AR)
-- ============================================================

create or replace function tests.lg() returns boolean language sql as $$
  select to_regclass('public.aceptaciones_legales') is not null
     and to_regprocedure('public.registrar_aceptaciones(uuid,uuid[],text,boolean)') is not null;
$$;
grant execute on function tests.lg() to anon, authenticated, service_role;

do $$ begin
  if not tests.lg() then raise notice 'INFO|92_documentos_legales omitido: migración no aplicada'; end if;
end $$;

select tests.lg() as hay_lg \gset
\if :hay_lg

create or replace function tests.lg_ok(p_id text, p_desc text, p_cond boolean, p_detalle text default '') returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) then perform tests.pass(p_id, p_desc); else perform tests.fail(p_id, p_desc, coalesce(p_detalle, '')); end if;
end $$;

-- Una versión sintética en el estado pedido (como postgres, el único que
-- puede escribir). Vigencias distintas por llamada: dentro de una
-- transacción now() es fijo.
create or replace function tests.lg_version(p_clave text, p_version text, p_pais text default 'MX',
                                            p_estado text default 'publicado',
                                            p_vigente timestamptz default now() - interval '4 minutes',
                                            p_requiere boolean default true) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.documentos_legales_versiones (documento_clave, version, jurisdiccion, contenido, contenido_sha256, requiere_nueva_aceptacion)
  values (p_clave, p_version, p_pais, 'Texto sintético de ' || p_clave || ' ' || p_version || ' ' || p_pais, repeat('0', 64), p_requiere)
  returning id into v_id;
  if p_estado in ('aprobado', 'publicado', 'retirado') then
    update public.documentos_legales_versiones set estado = 'aprobado', aprobado_por = 'Revisión jurídica (prueba)' where id = v_id;
  end if;
  if p_estado in ('publicado', 'retirado') then
    update public.documentos_legales_versiones set estado = 'publicado', vigente_desde = p_vigente where id = v_id;
  end if;
  if p_estado = 'retirado' then
    update public.documentos_legales_versiones set estado = 'retirado' where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function tests.lg_vid(p_clave text, p_version text, p_pais text default 'MX') returns uuid
language sql as $$
  select id from public.documentos_legales_versiones where documento_clave = p_clave and version = p_version and jurisdiccion = p_pais;
$$;

-- Escenario base (México): Términos (aceptación) y Aviso de Privacidad
-- (acuse) por persona para la administración; Acuerdo de Tratamiento
-- (aceptación) con alcance de residencial; el guardia solo reconoce el
-- Aviso de Privacidad. Concede EXECUTE a authenticated (se revierte).
create or replace function tests.lg_preparar() returns void language plpgsql as $$
begin
  perform tests.lg_version('terminos', '1.0');
  perform tests.lg_version('privacidad', '1.0');
  perform tests.lg_version('acuerdo_tratamiento', '1.0');
  insert into public.requisitos_legales (rol_clave, documento_clave, jurisdiccion, tipo, alcance) values
    ('admin_residencial', 'terminos', 'MX', 'aceptacion', 'usuario'),
    ('admin_residencial', 'privacidad', 'MX', 'acuse', 'usuario'),
    ('admin_residencial', 'acuerdo_tratamiento', 'MX', 'aceptacion', 'residencial'),
    ('guardia', 'privacidad', 'MX', 'acuse', 'usuario');
  grant execute on function public.documentos_pendientes(uuid), public.registrar_aceptaciones(uuid, uuid[], text, boolean),
                            public.documentos_legales_vigentes(text), public.documento_legal_publicado(uuid) to authenticated;
end $$;

-- Ejecuta p_sql con el JWT de p_uid y el rol indicado (como PostgREST);
-- devuelve el resultado como texto o 'ERR:<sqlstate>:<mensaje>'.
create or replace function tests.lg_llamar(p_uid uuid, p_sql text, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare v text;
begin
  perform tests.como(p_uid);
  execute format('set local role %I', p_rol);
  execute 'select (' || p_sql || ')::text' into v;
  reset role;
  return v;
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- Lo pendiente de p_uid en p_tenant: 'clave:version:tipo:alcance,…' u 'ERR:…'.
create or replace function tests.lg_pendientes(p_uid uuid, p_tenant uuid) returns text language sql as $$
  select tests.lg_llamar(p_uid, format(
    'select coalesce(string_agg(documento_clave || '':'' || version || '':'' || tipo || '':'' || alcance, '','' order by documento_clave), '''') from public.documentos_pendientes(%L)',
    p_tenant));
$$;

-- registrar_aceptaciones con el JWT de p_uid; devuelve el jsonb o 'ERR:…'.
create or replace function tests.lg_registrar(p_uid uuid, p_tenant uuid, p_ids uuid[], p_origen text default 'aceptacion_posterior',
                                              p_declara boolean default false) returns text language sql as $$
  select tests.lg_llamar(p_uid, format('select public.registrar_aceptaciones(%L, %L::uuid[], %L, %L)', p_tenant, p_ids, p_origen, p_declara));
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ── DL-0x. Inactiva: nada publicado, nada exigido, nada expuesto ──
do $$
declare
  t text;
  r text;
  f text;
  rol text;
  v_tablas text[] := array['public.documentos_legales', 'public.documentos_legales_versiones', 'public.requisitos_legales', 'public.aceptaciones_legales'];
  v_api text[] := array['public.documentos_legales_vigentes(text)', 'public.documento_legal_publicado(uuid)', 'public.documentos_pendientes(uuid)',
                        'public.registrar_aceptaciones(uuid,uuid[],text,boolean)', 'public.descartar_aceptaciones_alta_fallida(uuid,uuid)'];
  v_trg text[] := array['public.documentos_legales_catalogo_guardia()', 'public.documentos_legales_versiones_guardia()',
                        'public.documentos_legales_versiones_auditar()', 'public.requisitos_legales_auditar()',
                        'public.aceptaciones_legales_guardia()', 'public.documentos_legales_impedir_truncate()'];
begin
  perform tests.lg_ok('DL-01', 'catálogo fijo: terminos, privacidad, acuerdo_tratamiento, aviso_residentes',
    (select string_agg(clave, ',' order by clave) from public.documentos_legales) = 'acuerdo_tratamiento,aviso_residentes,privacidad,terminos');
  perform tests.lg_ok('DL-02', 'inactiva: 0 versiones, 0 requisitos y 0 aceptaciones',
    (select count(*) from public.documentos_legales_versiones) = 0 and (select count(*) from public.requisitos_legales) = 0
    and (select count(*) from public.aceptaciones_legales) = 0);
  foreach t in array v_tablas loop
    perform tests.lg_ok('DL-03', t || ': RLS activo y sin políticas',
      (select relrowsecurity from pg_class where oid = t::regclass)
      and not exists (select 1 from pg_policies where schemaname || '.' || tablename = t));
    foreach rol in array array['anon', 'authenticated', 'service_role'] loop
      perform tests.lg_ok('DL-04', t || ': ' || rol || ' sin ningún privilegio de tabla ni de columna',
        not has_table_privilege(rol, t, 'SELECT') and not has_table_privilege(rol, t, 'INSERT')
        and not has_table_privilege(rol, t, 'UPDATE') and not has_table_privilege(rol, t, 'DELETE')
        and not has_table_privilege(rol, t, 'TRUNCATE') and not has_table_privilege(rol, t, 'REFERENCES')
        and not has_table_privilege(rol, t, 'TRIGGER')
        and not has_any_column_privilege(rol, t, 'SELECT, INSERT, UPDATE, REFERENCES'));
    end loop;
  end loop;
  foreach f in array v_api loop
    perform tests.lg_ok('DL-05', f || ': SECURITY DEFINER, search_path vacío, sin EXECUTE para PUBLIC, anon, authenticated ni service_role',
      (select p.prosecdef and p.proconfig = array['search_path=""']
              and not has_function_privilege('anon', p.oid, 'EXECUTE')
              and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and not has_function_privilege('service_role', p.oid, 'EXECUTE')
              and not exists (select 1 from unnest(p.proacl) a where a::text like '=%')
       from pg_proc p where p.oid = f::regprocedure),
      (select coalesce(array_to_string(p.proacl, ','), 'acl nula') from pg_proc p where p.oid = f::regprocedure));
  end loop;
  foreach f in array v_trg loop
    perform tests.lg_ok('DL-06', f || ': función de trigger INVOKER, search_path vacío, sin EXECUTE para la API',
      (select not p.prosecdef and p.proconfig = array['search_path=""']
              and not has_function_privilege('anon', p.oid, 'EXECUTE')
              and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and not has_function_privilege('service_role', p.oid, 'EXECUTE')
       from pg_proc p where p.oid = f::regprocedure));
  end loop;
  -- Nada existente cambia de comportamiento: ningún trigger nuevo cuelga
  -- de una tabla anterior.
  perform tests.lg_ok('DL-07', 'los triggers legales solo cuelgan de las 4 tablas nuevas',
    not exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
                where p.proname in ('documentos_legales_catalogo_guardia', 'documentos_legales_versiones_guardia', 'documentos_legales_versiones_auditar',
                                    'requisitos_legales_auditar', 'aceptaciones_legales_guardia', 'documentos_legales_impedir_truncate')
                  and g.tgrelid <> all (v_tablas::regclass[])));
  r := tests.lg_llamar('00000000-0000-0000-0000-00000000000a', 'select count(*) from public.documentos_pendientes(''aaaaaaaa-0000-0000-0000-000000000000'')');
  perform tests.lg_ok('DL-08', 'la API no puede llamar documentos_pendientes (admin de A)', r like 'ERR:42501:permission denied%', r);
  r := tests.lg_llamar('00000000-0000-0000-0000-00000000000a',
         'select public.registrar_aceptaciones(''aaaaaaaa-0000-0000-0000-000000000000'', array[gen_random_uuid()], ''aceptacion_posterior'', true)');
  perform tests.lg_ok('DL-08b', 'la API no puede llamar registrar_aceptaciones', r like 'ERR:42501:permission denied%', r);
  r := tests.lg_llamar('00000000-0000-0000-0000-00000000000a', 'select public.documentos_legales_vigentes(''MX'')', 'anon');
  perform tests.lg_ok('DL-08c', 'anon no puede llamar documentos_legales_vigentes', r like 'ERR:42501:permission denied%', r);
  r := tests.lg_llamar('00000000-0000-0000-0000-00000000000a',
         'select public.descartar_aceptaciones_alta_fallida(''00000000-0000-0000-0000-00000000000a'', ''aaaaaaaa-0000-0000-0000-000000000000'')', 'service_role');
  perform tests.lg_ok('DL-08d', 'service_role no puede llamar descartar_aceptaciones_alta_fallida', r like 'ERR:42501:permission denied%', r);
  foreach rol in array array['anon', 'authenticated', 'service_role'] loop
    r := tests.lg_llamar('00000000-0000-0000-0000-00000000000a', 'select count(*) from public.aceptaciones_legales', rol);
    perform tests.lg_ok('DL-08e', rol || ' no lee aceptaciones_legales', r like 'ERR:42501:permission denied%', r);
    r := tests.lg_llamar('00000000-0000-0000-0000-00000000000a', 'select count(*) from public.documentos_legales_versiones', rol);
    perform tests.lg_ok('DL-08f', rol || ' no lee documentos_legales_versiones', r like 'ERR:42501:permission denied%', r);
  end loop;
end $$;

-- ── DL-1x. Versiones: ciclo de vida e inmutabilidad ───────────
begin;
do $$
declare
  v_id uuid;
  v public.documentos_legales_versiones;
  v_hash text;
begin
  perform tests.debe_fallar('DL-10', 'una versión no nace publicada',
    $q$insert into public.documentos_legales_versiones (documento_clave, version, jurisdiccion, estado, contenido, contenido_sha256)
       values ('terminos', '9.0', 'MX', 'publicado', 'x', repeat('a', 64))$q$, '23514');
  perform tests.debe_fallar('DL-10b', 'versión con formato inválido', $q$select tests.lg_version('terminos', '1', 'MX', 'borrador')$q$, '23514');
  perform tests.debe_fallar('DL-10c', 'jurisdicción fuera de MX/AR', $q$select tests.lg_version('terminos', '1.0', 'US', 'borrador')$q$, '23514');

  insert into public.documentos_legales_versiones (documento_clave, version, jurisdiccion, contenido, contenido_sha256, aprobado_por, aprobado_en, publicado_en)
  values ('terminos', '1.0', 'MX', 'Texto A', repeat('f', 64), 'nadie', now(), now())
  returning id into v_id;
  select * into v from public.documentos_legales_versiones where id = v_id;
  perform tests.lg_ok('DL-11', 'alta: el hash lo calcula el servidor (sha256 UTF-8) y se ignoran aprobación/publicación del llamador',
    v.contenido_sha256 = encode(sha256(convert_to('Texto A', 'UTF8')), 'hex') and v.estado = 'borrador'
    and v.aprobado_por is null and v.aprobado_en is null and v.publicado_en is null, row(v.*)::text);
  perform tests.lg_ok('DL-11b', 'auditoría del alta: legal.version_creada, sin residencial y sin el texto',
    exists (select 1 from public.audit_log a where a.entidad_id = v_id and a.accion = 'legal.version_creada' and a.tenant_id is null
            and a.datos_nuevos->>'contenido_sha256' = v.contenido_sha256 and not (a.datos_nuevos ? 'contenido')
            and a.datos_nuevos::text not like '%Texto A%'));

  update public.documentos_legales_versiones set contenido = 'Texto B', contenido_sha256 = repeat('e', 64) where id = v_id;
  select contenido_sha256 into v_hash from public.documentos_legales_versiones where id = v_id;
  perform tests.lg_ok('DL-12', 'borrador editable: el hash se recalcula y la edición queda auditada',
    v_hash = encode(sha256(convert_to('Texto B', 'UTF8')), 'hex')
    and exists (select 1 from public.audit_log a where a.entidad_id = v_id and a.accion = 'legal.version_borrador_editado'));
  perform tests.debe_fallar('DL-12b', 'ni en borrador cambian id, documento o fecha de alta',
    format('update public.documentos_legales_versiones set documento_clave = %L where id = %L', 'privacidad', v_id), '42501');
  perform tests.debe_fallar('DL-12c', 'un borrador no salta a publicado',
    format('update public.documentos_legales_versiones set estado = %L, vigente_desde = now() where id = %L', 'publicado', v_id), '42501');

  perform tests.debe_fallar('DL-13', 'aprobar exige aprobado_por',
    format('update public.documentos_legales_versiones set estado = %L where id = %L', 'aprobado', v_id), '23514');
  update public.documentos_legales_versiones set estado = 'aprobado', aprobado_por = 'Revisión jurídica (prueba)', aprobado_en = '2000-01-01' where id = v_id;
  select * into v from public.documentos_legales_versiones where id = v_id;
  perform tests.lg_ok('DL-14', 'aprobado: aprobado_en es la hora del servidor (no la del llamador) y queda auditado',
    v.estado = 'aprobado' and v.aprobado_en = now()
    and exists (select 1 from public.audit_log a where a.entidad_id = v_id and a.accion = 'legal.version_aprobado'), row(v.*)::text);

  perform tests.debe_fallar('DL-15', 'aprobado: el contenido no cambia',
    format('update public.documentos_legales_versiones set contenido = %L where id = %L', 'Texto C', v_id), '42501');
  perform tests.debe_fallar('DL-15b', 'aprobado: el número de versión no cambia',
    format('update public.documentos_legales_versiones set version = %L where id = %L', '1.1', v_id), '42501');
  perform tests.debe_fallar('DL-15c', 'aprobado: requiere_nueva_aceptacion no cambia',
    format('update public.documentos_legales_versiones set requiere_nueva_aceptacion = false where id = %L', v_id), '42501');
  perform tests.debe_fallar('DL-15d', 'aprobado: quién aprobó no cambia',
    format('update public.documentos_legales_versiones set aprobado_por = %L where id = %L', 'otra persona', v_id), '42501');
  perform tests.debe_fallar('DL-15e', 'aprobado: la jurisdicción no cambia',
    format('update public.documentos_legales_versiones set jurisdiccion = %L where id = %L', 'AR', v_id), '42501');
  perform tests.debe_fallar('DL-15f', 'aprobado no vuelve a borrador',
    format('update public.documentos_legales_versiones set estado = %L, aprobado_por = null, aprobado_en = null where id = %L', 'borrador', v_id), '42501');

  update public.documentos_legales_versiones set vigente_desde = now() + interval '1 day' where id = v_id;
  perform tests.lg_ok('DL-16', 'aprobado: la vigencia se puede fijar antes de publicar (auditado)',
    exists (select 1 from public.audit_log a where a.entidad_id = v_id and a.accion = 'legal.version_vigencia_cambiada'));

  update public.documentos_legales_versiones set vigente_desde = null where id = v_id;
  perform tests.debe_fallar('DL-17', 'publicar exige vigente_desde',
    format('update public.documentos_legales_versiones set estado = %L where id = %L', 'publicado', v_id), '23514');
  perform tests.debe_fallar('DL-17b', 'no se publica con vigencia retroactiva',
    format('update public.documentos_legales_versiones set estado = %L, vigente_desde = now() - interval %L where id = %L', 'publicado', '1 day', v_id), '23514');

  update public.documentos_legales_versiones set estado = 'publicado', vigente_desde = now() - interval '4 minutes', publicado_en = '2000-01-01' where id = v_id;
  select * into v from public.documentos_legales_versiones where id = v_id;
  perform tests.lg_ok('DL-18', 'publicado: publicado_en es la hora del servidor y queda auditado',
    v.estado = 'publicado' and v.publicado_en = now()
    and exists (select 1 from public.audit_log a where a.entidad_id = v_id and a.accion = 'legal.version_publicado'), row(v.*)::text);

  perform tests.debe_fallar('DL-19', 'publicado: el contenido no cambia (ni con el mismo hash forzado)',
    format('update public.documentos_legales_versiones set contenido = %L where id = %L', 'Texto C', v_id), '42501');
  perform tests.debe_fallar('DL-19b', 'publicado: el hash no cambia',
    format('update public.documentos_legales_versiones set contenido_sha256 = %L where id = %L', repeat('a', 64), v_id), '42501');
  perform tests.debe_fallar('DL-19c', 'publicado: la vigencia no cambia',
    format('update public.documentos_legales_versiones set vigente_desde = now() where id = %L', v_id), '42501');
  perform tests.debe_fallar('DL-19d', 'publicado no vuelve a aprobado ni a borrador',
    format('update public.documentos_legales_versiones set estado = %L, publicado_en = null where id = %L', 'aprobado', v_id), '42501');
  perform tests.debe_fallar('DL-19e', 'publicado: el resumen de cambios no cambia',
    format('update public.documentos_legales_versiones set resumen_cambios = %L where id = %L', 'otro', v_id), '42501');

  perform tests.debe_fallar('DL-20', 'una versión publicada no se borra',
    format('delete from public.documentos_legales_versiones where id = %L', v_id), '42501');
  perform tests.debe_fallar('DL-20b', 'una versión aprobada no se borra',
    format('delete from public.documentos_legales_versiones where id = %L', tests.lg_version('privacidad', '1.0', 'MX', 'aprobado')), '42501');
  v_id := tests.lg_version('privacidad', '0.9', 'MX', 'borrador');
  delete from public.documentos_legales_versiones where id = v_id;
  perform tests.lg_ok('DL-20c', 'un borrador sí se borra, y queda auditado',
    not exists (select 1 from public.documentos_legales_versiones where id = v_id)
    and exists (select 1 from public.audit_log a where a.entidad_id = v_id and a.accion = 'legal.version_borrador_eliminado'));

  perform tests.debe_fallar('DL-21', 'una versión nueva no se publica con vigencia igual o anterior a una ya publicada (mismo documento y país)',
    $q$select tests.lg_version('terminos', '1.1', 'MX', 'publicado', now() - interval '4 minutes')$q$, '23514');
  perform tests.debe_fallar('DL-21b', 'tampoco anterior',
    $q$select tests.lg_version('terminos', '1.2', 'MX', 'publicado', now() - interval '5 minutes' + interval '1 second')$q$, '23514');
  perform tests.debe_funcionar('DL-21c', 'otro país tiene su propio orden de vigencias (AR 1.0 con la misma vigencia)',
    $q$select tests.lg_version('terminos', '1.0', 'AR', 'publicado', now() - interval '4 minutes')$q$);
  perform tests.debe_fallar('DL-21d', 'versión duplicada para el mismo documento y país',
    $q$select tests.lg_version('terminos', '1.0', 'MX', 'borrador')$q$, '23505');
  v_id := tests.lg_version('privacidad', '2.0', 'MX', 'publicado', now() + interval '30 days');
  perform tests.debe_fallar('DL-21e', 'una publicada con vigencia futura bloquea publicar otra anterior',
    $q$select tests.lg_version('privacidad', '2.1', 'MX', 'publicado', now() + interval '10 days')$q$, '23514');
  update public.documentos_legales_versiones set estado = 'retirado' where id = v_id;
  perform tests.debe_funcionar('DL-21f', 'retirada antes de entrar en vigor (nadie pudo aceptarla): ya no bloquea su corrección',
    $q$select tests.lg_version('privacidad', '2.1', 'MX', 'publicado', now() + interval '10 days')$q$);

  v_id := tests.lg_vid('terminos', '1.0');
  update public.documentos_legales_versiones set estado = 'retirado', retirado_en = '2000-01-01' where id = v_id;
  select * into v from public.documentos_legales_versiones where id = v_id;
  perform tests.lg_ok('DL-22', 'retirar: retirado_en = hora del servidor, contenido intacto, auditado',
    v.estado = 'retirado' and v.retirado_en = now() and v.contenido = 'Texto B'
    and exists (select 1 from public.audit_log a where a.entidad_id = v_id and a.accion = 'legal.version_retirado'));
  perform tests.debe_fallar('DL-22b', 'retirado no se vuelve a publicar',
    format('update public.documentos_legales_versiones set estado = %L where id = %L', 'publicado', v_id), '42501');
  perform tests.debe_fallar('DL-22c', 'retirado no se edita',
    format('update public.documentos_legales_versiones set contenido = %L where id = %L', 'Texto D', v_id), '42501');
  perform tests.debe_fallar('DL-22d', 'retirado no se borra',
    format('delete from public.documentos_legales_versiones where id = %L', v_id), '42501');
end $$;
rollback;

-- TRUNCATE salta los triggers de fila: está prohibido aparte (incluso a postgres).
begin;
do $$
declare t text;
begin
  foreach t in array array['public.documentos_legales_versiones', 'public.aceptaciones_legales', 'public.requisitos_legales', 'public.documentos_legales'] loop
    perform tests.debe_fallar('DL-23', 'TRUNCATE ' || t || ' rechazado', 'truncate ' || t || ' cascade', '42501');
  end loop;
end $$;
rollback;

begin;
do $$ begin
  perform tests.debe_fallar('DL-24', 'el catálogo no se edita (el título es parte de lo aceptado)',
    $q$update public.documentos_legales set titulo = 'Otro' where clave = 'terminos'$q$, '42501');
  perform tests.debe_fallar('DL-24b', 'el catálogo no se borra',
    $q$delete from public.documentos_legales where clave = 'aviso_residentes'$q$, '42501');
end $$;
rollback;

-- Aun saltando los triggers (rol privilegiado), el texto no cambia sin
-- cambiar su hash: queda en evidencia frente al hash de cada aceptación.
begin;
select tests.lg_version('terminos', '1.0');
set local session_replication_role = replica;
do $$ begin
  perform tests.debe_fallar('DL-26', 'sin triggers: cambiar el texto de una publicada conservando el hash viola el CHECK',
    $q$update public.documentos_legales_versiones set contenido = 'Texto alterado' where documento_clave = 'terminos'$q$, '23514');
  perform tests.debe_fallar('DL-26b', 'sin triggers: insertar con un hash que no corresponde al texto viola el CHECK',
    $q$insert into public.documentos_legales_versiones (documento_clave, version, jurisdiccion, contenido, contenido_sha256)
       values ('privacidad', '1.0', 'MX', 'x', repeat('a', 64))$q$, '23514');
end $$;
rollback;

-- La auditoría de versiones no queda al alcance de un administrador de
-- residencial (tenant_id nulo: solo Super Admin por la política).
begin;
select tests.lg_version('terminos', '1.0');
do $$
declare r text;
begin
  r := tests.lg_llamar('00000000-0000-0000-0000-00000000000a', $q$select count(*) from public.audit_log where entidad = 'documentos_legales_versiones'$q$);
  perform tests.lg_ok('DL-25', 'admin de A no ve la auditoría de versiones (0 filas o sin permiso)', r = '0' or r like 'ERR:42501:%', r);
end $$;
rollback;

-- ── DL-3x. Requisitos ─────────────────────────────────────────
begin;
do $$ begin
  perform tests.debe_fallar('DL-30', 'alcance de residencial solo para aceptación (no acuse)',
    $q$insert into public.requisitos_legales values ('admin_residencial', 'acuerdo_tratamiento', 'MX', 'acuse', 'residencial')$q$, '23514');
  perform tests.debe_fallar('DL-30b', 'alcance de residencial solo para la administración (no guardia)',
    $q$insert into public.requisitos_legales values ('guardia', 'acuerdo_tratamiento', 'MX', 'aceptacion', 'residencial')$q$, '23514');
  perform tests.debe_fallar('DL-30c', 'residentes y super_admin no son roles de requisito (Fase 1)',
    $q$insert into public.requisitos_legales values ('residente', 'aviso_residentes', 'MX', 'acuse', 'usuario')$q$, '23514');
  insert into public.requisitos_legales (rol_clave, documento_clave, jurisdiccion, tipo, alcance) values ('guardia', 'privacidad', 'MX', 'acuse', 'usuario');
  update public.requisitos_legales set tipo = 'consentimiento' where rol_clave = 'guardia';
  delete from public.requisitos_legales where rol_clave = 'guardia';
  perform tests.lg_ok('DL-31', 'alta, cambio y baja de requisitos quedan en audit_log',
    (select string_agg(accion, ',' order by accion) from public.audit_log where entidad = 'requisitos_legales')
    = 'legal.requisito_alta,legal.requisito_baja,legal.requisito_cambio');
end $$;
rollback;

-- ── DL-4x. Vigentes y contenido publicado ─────────────────────
begin;
do $$
declare
  v10 uuid := tests.lg_version('terminos', '1.0', 'MX', 'publicado', now() - interval '4 minutes');
  v11 uuid := tests.lg_version('terminos', '1.1', 'MX', 'publicado', now() - interval '3 minutes');
  v12 uuid := tests.lg_version('terminos', '1.2', 'MX', 'publicado', now() + interval '1 day');
  v13 uuid := tests.lg_version('terminos', '1.3', 'MX', 'aprobado');
  vb uuid := tests.lg_version('privacidad', '2.0', 'MX', 'borrador');
  var uuid := tests.lg_version('terminos', '1.0', 'AR', 'publicado', now() - interval '4 minutes');
  r text;
begin
  perform tests.lg_ok('DL-40', 'vigente MX: la publicada más reciente ya en vigor (1.1), no la futura ni la aprobada',
    (select string_agg(documento_clave || ':' || version, ',') from public.documentos_legales_vigentes('MX')) = 'terminos:1.1');
  perform tests.lg_ok('DL-40b', 'vigente AR: solo versiones de Argentina',
    (select string_agg(documento_clave || ':' || version || ':' || version_id, ',') from public.documentos_legales_vigentes('AR')) = 'terminos:1.0:' || var);
  perform tests.debe_fallar('DL-40c', 'país no válido', $q$select * from public.documentos_legales_vigentes('US')$q$, '22023');
  perform tests.debe_fallar('DL-40d', 'país nulo', $q$select * from public.documentos_legales_vigentes(null)$q$, '22023');
  perform tests.lg_ok('DL-41', 'contenido publicado: una versión publicada devuelve su texto y su hash',
    (select contenido_sha256 = encode(sha256(convert_to(contenido, 'UTF8')), 'hex') from public.documento_legal_publicado(v10)));
  perform tests.lg_ok('DL-41b', 'un borrador o un aprobado sin publicar no se devuelven',
    not exists (select 1 from public.documento_legal_publicado(vb)) and not exists (select 1 from public.documento_legal_publicado(v13)));
  update public.documentos_legales_versiones set estado = 'retirado' where id = v11;
  perform tests.lg_ok('DL-42', 'retirar la vigente devuelve la vigencia a la anterior aún publicada (1.0)',
    (select string_agg(version, ',') from public.documentos_legales_vigentes('MX')) = '1.0');
  perform tests.lg_ok('DL-42b', 'una retirada sigue consultable como historial',
    (select estado from public.documento_legal_publicado(v11)) = 'retirado');
  grant execute on function public.documentos_legales_vigentes(text) to authenticated;
  r := tests.lg_llamar('00000000-0000-0000-0000-0000000000a9', $q$select count(*) from public.documentos_legales_vigentes('MX') where contenido_sha256 is not null$q$);
  perform tests.lg_ok('DL-43', 'con EXECUTE concedido, la API lee vigentes por la función (sin acceso a la tabla)', r = '1', r);
end $$;
rollback;

-- ── DL-5x. Pendientes y registro ──────────────────────────────
begin;
select tests.lg_preparar();
do $$
declare
  A uuid := 'aaaaaaaa-0000-0000-0000-000000000000';
  B uuid := 'bbbbbbbb-0000-0000-0000-000000000000';
  admin_a uuid := '00000000-0000-0000-0000-00000000000a';
  guard_a uuid := '00000000-0000-0000-0000-0000000000a9';
  admin_b uuid := '00000000-0000-0000-0000-00000000000b';
  mixto uuid := '00000000-0000-0000-0000-0000000000ab';
  admin_ab uuid := '00000000-0000-0000-0000-0000000000aa';
  solo uuid := '00000000-0000-0000-0000-000000000099';
  vt uuid := tests.lg_vid('terminos', '1.0');
  vp uuid := tests.lg_vid('privacidad', '1.0');
  vd uuid := tests.lg_vid('acuerdo_tratamiento', '1.0');
  r text;
  j jsonb;
  n bigint;
  fila public.aceptaciones_legales;
begin
  r := tests.lg_pendientes(admin_a, A);
  perform tests.lg_ok('DL-50', 'admin de A: Acuerdo (aceptación, residencial), Aviso (acuse, persona), Términos (aceptación, persona)',
    r = 'acuerdo_tratamiento:1.0:aceptacion:residencial,privacidad:1.0:acuse:usuario,terminos:1.0:aceptacion:usuario', r);
  r := tests.lg_pendientes(guard_a, A);
  perform tests.lg_ok('DL-51', 'guardia de A: solo el acuse del Aviso de Privacidad', r = 'privacidad:1.0:acuse:usuario', r);
  r := tests.lg_pendientes(solo, A);
  perform tests.lg_ok('DL-52', 'sin membresía en A: rechazado', r like 'ERR:42501:documentos_pendientes: sin membresía%', r);
  r := tests.lg_pendientes(admin_a, B);
  perform tests.lg_ok('DL-52b', 'admin de A no consulta B', r like 'ERR:42501:documentos_pendientes: sin membresía%', r);
  r := tests.lg_llamar(admin_a, format('select count(*) from public.documentos_pendientes(%L)', A), 'anon');
  perform tests.lg_ok('DL-52c', 'anon: sin EXECUTE aunque authenticated lo tenga', r like 'ERR:42501:permission denied%', r);
  r := tests.lg_llamar(null, format('select count(*) from public.documentos_pendientes(%L)', A));
  perform tests.lg_ok('DL-52d', 'sin sesión (auth.uid() nulo): rechazado', r like 'ERR:42501:documentos_pendientes: requiere una sesión%', r);
  perform tests.lg_ok('DL-52e', 'documentos_pendientes no devuelve quién aceptó (sin columnas de usuario ni de fecha de aceptación)',
    (select not ('user_id' = any (p.proargnames)) and not ('aceptado_en' = any (p.proargnames)) and not ('aceptado_por' = any (p.proargnames))
     from pg_proc p where p.oid = 'public.documentos_pendientes(uuid)'::regprocedure));

  -- Validación de la petición (nada se escribe).
  r := tests.lg_registrar(guard_a, A, array[vd], 'aceptacion_posterior', true);
  perform tests.lg_ok('DL-53', 'el guardia no acepta el Acuerdo de Tratamiento (no le aplica)', r like 'ERR:22023:%documento_no_aplicable%', r);
  r := tests.lg_registrar(guard_a, A, array[vp], 'registro');
  perform tests.lg_ok('DL-53b', 'el origen registro no se acepta desde la API', r like 'ERR:22023:%origen no permitido%', r);
  r := tests.lg_registrar(guard_a, A, array[]::uuid[]);
  perform tests.lg_ok('DL-53c', 'lista vacía', r like 'ERR:22023:%lista de versiones%', r);
  r := tests.lg_registrar(guard_a, A, array[vp, vp]);
  perform tests.lg_ok('DL-53d', 'ids repetidos', r like 'ERR:22023:%lista de versiones%', r);
  r := tests.lg_registrar(guard_a, A, array[vp, null]);
  perform tests.lg_ok('DL-53e', 'id nulo', r like 'ERR:22023:%lista de versiones%', r);
  r := tests.lg_registrar(guard_a, A, array(select gen_random_uuid() from generate_series(1, 11)));
  perform tests.lg_ok('DL-53f', 'más de 10 ids', r like 'ERR:22023:%lista de versiones%', r);
  r := tests.lg_registrar(solo, A, array[vp]);
  perform tests.lg_ok('DL-53g', 'sin membresía no registra', r like 'ERR:42501:%sin membresía%', r);
  r := tests.lg_registrar(admin_a, B, array[vt]);
  perform tests.lg_ok('DL-53h', 'admin de A no registra en B', r like 'ERR:42501:%sin membresía%', r);
  r := tests.lg_registrar(guard_a, A, array[gen_random_uuid()]);
  perform tests.lg_ok('DL-53i', 'versión inexistente', r like 'ERR:22023:%documento_no_aplicable%', r);

  r := tests.lg_registrar(admin_a, A, array[vt, vp, vd], 'aceptacion_posterior', false);
  perform tests.lg_ok('DL-54', 'Acuerdo de Tratamiento sin declarar facultades: rechazado',
    r like 'ERR:22023:%falta_declaracion_facultades%', r);
  perform tests.lg_ok('DL-54b', 'todo o nada: tampoco se registraron Términos ni Aviso', (select count(*) from public.aceptaciones_legales) = 0);

  r := tests.lg_registrar(admin_a, A, array[vt, vp, vd], 'aceptacion_posterior', true);
  j := r::jsonb;
  perform tests.lg_ok('DL-55', 'admin de A acepta y reconoce los tres: registradas 3, ya_existentes 0, pendientes 0',
    j = '{"registradas": 3, "ya_existentes": 0, "pendientes": 0}'::jsonb, r);
  select * into fila from public.aceptaciones_legales where version_id = vt;
  perform tests.lg_ok('DL-55b', 'Términos: aceptación por persona, hash de la versión, hora del servidor, sin declarar facultades',
    fila.user_id = admin_a and fila.tenant_id = A and fila.tipo = 'aceptacion' and fila.alcance = 'usuario' and not fila.declara_facultades
    and fila.origen = 'aceptacion_posterior' and fila.aceptado_en = now()
    and fila.contenido_sha256 = (select contenido_sha256 from public.documentos_legales_versiones where id = vt), row(fila.*)::text);
  select * into fila from public.aceptaciones_legales where version_id = vp;
  perform tests.lg_ok('DL-55c', 'Aviso de Privacidad: ACUSE de recepción, no aceptación ni consentimiento',
    fila.tipo = 'acuse' and fila.alcance = 'usuario', row(fila.*)::text);
  select * into fila from public.aceptaciones_legales where version_id = vd;
  perform tests.lg_ok('DL-55d', 'Acuerdo de Tratamiento: aceptación con alcance de residencial y declaración (no validada) de facultades',
    fila.tipo = 'aceptacion' and fila.alcance = 'residencial' and fila.declara_facultades and fila.tenant_id = A and fila.user_id = admin_a, row(fila.*)::text);
  perform tests.lg_ok('DL-55e', 'compatibilidad: users.terminos_aceptados_en = ahora para quien aceptó Términos (solo esa persona)',
    (select terminos_aceptados_en from public.users where id = admin_a) = now()
    and (select terminos_aceptados_en from public.users where id = guard_a) is distinct from now());
  perform tests.lg_ok('DL-55f', 'la aceptación no se duplica en audit_log (el historial no queda donde lo lean otros admins)',
    not exists (select 1 from public.audit_log where entidad = 'aceptaciones_legales'));

  r := tests.lg_registrar(admin_a, A, array[vt, vp, vd], 'aceptacion_posterior', true);
  perform tests.lg_ok('DL-56', 'idempotente: repetir no crea filas (registradas 0, ya_existentes 3)',
    r::jsonb = '{"registradas": 0, "ya_existentes": 3, "pendientes": 0}'::jsonb and (select count(*) from public.aceptaciones_legales) = 3, r);

  r := tests.lg_pendientes(mixto, A);
  perform tests.lg_ok('DL-57', 'otro admin de A: el Acuerdo ya no le aparece (lo aceptó el residencial); Términos y Aviso sí (son por persona)',
    r = 'privacidad:1.0:acuse:usuario,terminos:1.0:aceptacion:usuario', r);
  r := tests.lg_registrar(mixto, A, array[vd], 'aceptacion_posterior', true);
  perform tests.lg_ok('DL-57b', 'si lo vuelve a aceptar: ya_existentes 1 y no se crea otra fila del residencial',
    (r::jsonb->>'ya_existentes') = '1' and (select count(*) from public.aceptaciones_legales where version_id = vd) = 1, r);
  r := tests.lg_pendientes(mixto, B);
  perform tests.lg_ok('DL-57c', 'el mismo usuario como guardia de B: solo el acuse del Aviso', r = 'privacidad:1.0:acuse:usuario', r);

  r := tests.lg_pendientes(admin_ab, B);
  perform tests.lg_ok('DL-58', 'aislamiento: el Acuerdo aceptado para A no cubre B',
    r = 'acuerdo_tratamiento:1.0:aceptacion:residencial,privacidad:1.0:acuse:usuario,terminos:1.0:aceptacion:usuario', r);
  r := tests.lg_registrar(admin_ab, A, array[vt], 'aceptacion_posterior');
  r := tests.lg_pendientes(admin_ab, B);
  perform tests.lg_ok('DL-58b', 'alcance persona: Términos aceptados en A valen para la misma persona en B (mismo país)',
    r = 'acuerdo_tratamiento:1.0:aceptacion:residencial,privacidad:1.0:acuse:usuario', r);
  r := tests.lg_pendientes(admin_b, B);
  perform tests.lg_ok('DL-58c', 'admin de B sigue con todo pendiente (nada de A le afecta)',
    r = 'acuerdo_tratamiento:1.0:aceptacion:residencial,privacidad:1.0:acuse:usuario,terminos:1.0:aceptacion:usuario', r);

  -- Versión nueva que exige volver a aceptar / corrección menor que no.
  perform tests.lg_version('terminos', '1.1', 'MX', 'publicado', now() - interval '3 minutes', true);
  perform tests.lg_version('privacidad', '1.1', 'MX', 'publicado', now() - interval '3 minutes', false);
  r := tests.lg_pendientes(admin_a, A);
  perform tests.lg_ok('DL-61', 'Términos 1.1 (requiere nueva aceptación) vuelve a quedar pendiente; Aviso 1.1 (corrección menor) no',
    r = 'terminos:1.1:aceptacion:usuario', r);
  r := tests.lg_pendientes(guard_a, A);
  perform tests.lg_ok('DL-62', 'quien no había reconocido el Aviso ve la versión vigente (1.1)', r = 'privacidad:1.1:acuse:usuario', r);
  r := tests.lg_registrar(admin_a, A, array[vt], 'aceptacion_posterior');
  perform tests.lg_ok('DL-61b', 'la versión ya no vigente no se registra', r like 'ERR:22023:%documento_no_aplicable%', r);
  r := tests.lg_registrar(admin_a, A, array[tests.lg_vid('terminos', '1.1')], 'aceptacion_posterior');
  perform tests.lg_ok('DL-61c', 'acepta 1.1: nueva fila; la de 1.0 se conserva',
    (r::jsonb->>'registradas') = '1' and (select count(*) from public.aceptaciones_legales where user_id = admin_a and tipo = 'aceptacion' and alcance = 'usuario') = 2, r);
  perform tests.lg_version('terminos', '1.2', 'MX', 'publicado', now() + interval '1 day');
  r := tests.lg_pendientes(admin_a, A);
  perform tests.lg_ok('DL-63', 'una versión con vigencia futura no queda pendiente todavía', r = '', r);
  r := tests.lg_registrar(admin_a, A, array[tests.lg_vid('terminos', '1.2')], 'aceptacion_posterior');
  perform tests.lg_ok('DL-63b', 'ni se puede registrar antes de su vigencia', r like 'ERR:22023:%documento_no_aplicable%', r);
end $$;
rollback;

-- País: B en Argentina, sin requisitos para AR.
begin;
select tests.lg_preparar();
update public.tenants set pais = 'AR' where id = 'bbbbbbbb-0000-0000-0000-000000000000';
do $$
declare
  B uuid := 'bbbbbbbb-0000-0000-0000-000000000000';
  r text;
begin
  r := tests.lg_pendientes('00000000-0000-0000-0000-00000000000b', B);
  perform tests.lg_ok('DL-60', 'residencial en AR sin requisitos de AR: nada pendiente', r = '', r);
  r := tests.lg_registrar('00000000-0000-0000-0000-00000000000b', B, array[tests.lg_vid('terminos', '1.0')], 'aceptacion_posterior');
  perform tests.lg_ok('DL-60b', 'una versión de México no se registra en un residencial de Argentina', r like 'ERR:22023:%documento_no_aplicable%', r);
  perform tests.debe_fallar('DL-60c', 'ni insertando directo (validación del trigger)',
    format($q$insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, contenido_sha256)
              values ('00000000-0000-0000-0000-00000000000b', %L, %L, 'aceptacion', 'usuario', 'aceptacion_posterior', repeat('0', 64))$q$,
           B, tests.lg_vid('terminos', '1.0')), '23514');
  insert into public.requisitos_legales values ('admin_residencial', 'terminos', 'AR', 'aceptacion', 'usuario');
  perform tests.lg_version('terminos', '1.0', 'AR');
  r := tests.lg_pendientes('00000000-0000-0000-0000-0000000000aa', B);
  perform tests.lg_ok('DL-60d', 'admin de A (MX) y B (AR): en B ve los Términos de AR', r = 'terminos:1.0:aceptacion:usuario', r);
  r := tests.lg_registrar('00000000-0000-0000-0000-0000000000aa', 'aaaaaaaa-0000-0000-0000-000000000000', array[tests.lg_vid('terminos', '1.0', 'MX')]);
  r := tests.lg_pendientes('00000000-0000-0000-0000-0000000000aa', B);
  perform tests.lg_ok('DL-60e', 'aceptar los de México no cubre los de Argentina', r = 'terminos:1.0:aceptacion:usuario', r);
end $$;
rollback;

-- Membresía inactiva.
begin;
select tests.lg_preparar();
update public.user_tenants set activo = false
 where user_id = '00000000-0000-0000-0000-0000000000a9' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
do $$
declare r text;
begin
  r := tests.lg_pendientes('00000000-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-000000000000');
  perform tests.lg_ok('DL-64', 'membresía inactiva: no consulta', r like 'ERR:42501:%sin membresía%', r);
  r := tests.lg_registrar('00000000-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-000000000000', array[tests.lg_vid('privacidad', '1.0')]);
  perform tests.lg_ok('DL-64b', 'membresía inactiva: no registra', r like 'ERR:42501:%sin membresía%', r);
end $$;
rollback;

-- ── DL-7x. Consentimiento y revocación ────────────────────────
begin;
select tests.lg_preparar();
select tests.lg_version('aviso_residentes', '1.0');
insert into public.requisitos_legales values ('guardia', 'aviso_residentes', 'MX', 'consentimiento', 'usuario');
do $$
declare
  A uuid := 'aaaaaaaa-0000-0000-0000-000000000000';
  guard_a uuid := '00000000-0000-0000-0000-0000000000a9';
  vc uuid := tests.lg_vid('aviso_residentes', '1.0');
  v_con uuid;
  r text;
begin
  r := tests.lg_registrar(guard_a, A, array[vc]);
  select id into v_con from public.aceptaciones_legales where version_id = vc and tipo = 'consentimiento';
  perform tests.lg_ok('DL-70', 'consentimiento: se registra como tipo consentimiento (distinto de aceptación y acuse)',
    (r::jsonb->>'registradas') = '1' and v_con is not null, r);
  r := tests.lg_registrar(guard_a, A, array[vc]);
  perform tests.lg_ok('DL-70b', 'consentimiento vigente repetido: ya_existentes, sin duplicar',
    (r::jsonb->>'ya_existentes') = '1' and (select count(*) from public.aceptaciones_legales where version_id = vc) = 1, r);
  perform tests.debe_fallar('DL-71', 'revocación sin consentimiento al que apunte',
    format($q$insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, contenido_sha256)
              values (%L, %L, %L, 'revocacion', 'usuario', 'aceptacion_posterior', repeat('0', 64))$q$, guard_a, A, vc), '23514');
  perform tests.debe_fallar('DL-71b', 'no se revoca el consentimiento de otra persona',
    format($q$insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, revoca_aceptacion_id, contenido_sha256)
              values ('00000000-0000-0000-0000-00000000000a', %L, %L, 'revocacion', 'usuario', 'aceptacion_posterior', %L, repeat('0', 64))$q$, A, vc, v_con), '23514');
  insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, revoca_aceptacion_id, contenido_sha256)
  values (guard_a, A, vc, 'revocacion', 'usuario', 'aceptacion_posterior', v_con, repeat('0', 64));
  perform tests.lg_ok('DL-71c', 'revocado: el consentimiento vuelve a quedar pendiente; la fila original se conserva',
    tests.lg_pendientes(guard_a, A) = 'aviso_residentes:1.0:consentimiento:usuario,privacidad:1.0:acuse:usuario'
    and exists (select 1 from public.aceptaciones_legales where id = v_con));
  perform tests.debe_fallar('DL-71d', 'un consentimiento se revoca una sola vez',
    format($q$insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, revoca_aceptacion_id, contenido_sha256)
              values (%L, %L, %L, 'revocacion', 'usuario', 'aceptacion_posterior', %L, repeat('0', 64))$q$, guard_a, A, vc, v_con), '23505');
  r := tests.lg_registrar(guard_a, A, array[vc]);
  perform tests.lg_ok('DL-72', 'tras revocar puede volver a consentir: fila nueva',
    (r::jsonb->>'registradas') = '1' and (select count(*) from public.aceptaciones_legales where version_id = vc and tipo = 'consentimiento') = 2, r);
  r := tests.lg_registrar(guard_a, A, array[tests.lg_vid('privacidad', '1.0')]);
  perform tests.debe_fallar('DL-72b', 'un acuse no se "revoca"',
    format($q$insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, revoca_aceptacion_id, contenido_sha256)
              select %L, %L, version_id, 'revocacion', 'usuario', 'aceptacion_posterior', id, repeat('0', 64)
              from public.aceptaciones_legales where tipo = 'acuse' limit 1$q$, guard_a, A), '23514');
end $$;
rollback;

-- ── DL-8x. Evidencia inmutable y validada ─────────────────────
begin;
select tests.lg_preparar();
select tests.lg_registrar('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000',
                          array[tests.lg_vid('terminos', '1.0'), tests.lg_vid('acuerdo_tratamiento', '1.0')], 'aceptacion_posterior', true);
do $$
declare
  A uuid := 'aaaaaaaa-0000-0000-0000-000000000000';
  vt uuid := tests.lg_vid('terminos', '1.0');
  ins text := $q$insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, declara_facultades, contenido_sha256)
                 values (%L, %L, %L, %L, %L, %L, %L, repeat('0', 64))$q$;
  fila public.aceptaciones_legales;
begin
  perform tests.debe_fallar('DL-80', 'UPDATE de evidencia rechazado (incluso a postgres)',
    $q$update public.aceptaciones_legales set aceptado_en = now() - interval '1 year'$q$, '42501');
  perform tests.debe_fallar('DL-80b', 'UPDATE del tipo rechazado', $q$update public.aceptaciones_legales set tipo = 'acuse' where tipo = 'aceptacion'$q$, '42501');
  perform tests.debe_fallar('DL-81', 'DELETE de evidencia rechazado (incluso a postgres)', 'delete from public.aceptaciones_legales', '42501');
  perform set_config('gateflow.borrado_aceptaciones', 'alta_fallida', true);
  perform tests.debe_fallar('DL-81b', 'con la marca de alta fallida tampoco se borra evidencia que no es del registro',
    'delete from public.aceptaciones_legales', '42501');
  perform set_config('gateflow.borrado_aceptaciones', '', true);

  perform tests.debe_fallar('DL-82', 'versión en borrador no se acepta',
    format(ins, '00000000-0000-0000-0000-0000000000a9', A, tests.lg_version('terminos', '7.0', 'MX', 'borrador'), 'aceptacion', 'usuario', 'invitacion', false), '23514');
  perform tests.debe_fallar('DL-82b', 'versión aprobada sin publicar no se acepta',
    format(ins, '00000000-0000-0000-0000-0000000000a9', A, tests.lg_version('terminos', '7.1', 'MX', 'aprobado'), 'aceptacion', 'usuario', 'invitacion', false), '23514');
  perform tests.debe_fallar('DL-82c', 'versión con vigencia futura no se acepta',
    format(ins, '00000000-0000-0000-0000-0000000000a9', A, tests.lg_version('privacidad', '7.2', 'MX', 'publicado', now() + interval '1 day'), 'acuse', 'usuario', 'invitacion', false), '23514');
  perform tests.debe_fallar('DL-82d', 'usuario inexistente',
    format(ins, gen_random_uuid(), A, vt, 'aceptacion', 'usuario', 'invitacion', false), '23503');
  perform tests.debe_fallar('DL-82e', 'residencial inexistente',
    format(ins, '00000000-0000-0000-0000-0000000000a9', gen_random_uuid(), vt, 'aceptacion', 'usuario', 'invitacion', false), '23503');
  perform tests.debe_fallar('DL-82f', 'sin membresía en el residencial',
    format(ins, '00000000-0000-0000-0000-000000000099', A, vt, 'aceptacion', 'usuario', 'invitacion', false), '23514');
  perform tests.debe_fallar('DL-82g', 'un guardia no acepta en nombre del residencial',
    format(ins, '00000000-0000-0000-0000-0000000000a9', A, tests.lg_vid('acuerdo_tratamiento', '1.0'), 'aceptacion', 'residencial', 'invitacion', true), '23514');
  perform tests.debe_fallar('DL-82h', 'alcance de residencial sin declarar facultades',
    format(ins, '00000000-0000-0000-0000-0000000000ab', A, tests.lg_vid('acuerdo_tratamiento', '1.0'), 'aceptacion', 'residencial', 'invitacion', false), '23514');
  perform tests.debe_fallar('DL-82i', 'declarar facultades en una aceptación personal no vale',
    format(ins, '00000000-0000-0000-0000-0000000000a9', A, vt, 'aceptacion', 'usuario', 'invitacion', true), '23514');
  perform tests.debe_fallar('DL-82j', 'un acuse no tiene alcance de residencial',
    format(ins, '00000000-0000-0000-0000-0000000000ab', A, vt, 'acuse', 'residencial', 'invitacion', true), '23514');
  perform tests.debe_fallar('DL-82k', 'residencial obligatorio',
    format(ins, '00000000-0000-0000-0000-0000000000a9', null, vt, 'aceptacion', 'usuario', 'invitacion', false), '23502');
  perform tests.debe_fallar('DL-82l', 'segunda aceptación del Acuerdo para el mismo residencial y versión',
    format(ins, '00000000-0000-0000-0000-0000000000ab', A, tests.lg_vid('acuerdo_tratamiento', '1.0'), 'aceptacion', 'residencial', 'invitacion', true), '23505');
  perform tests.debe_fallar('DL-82m', 'segunda aceptación de la misma persona y versión',
    format(ins, '00000000-0000-0000-0000-00000000000a', A, vt, 'aceptacion', 'usuario', 'invitacion', false), '23505');

  insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, contenido_sha256, aceptado_en)
  values ('00000000-0000-0000-0000-0000000000a9', A, tests.lg_vid('privacidad', '1.0'), 'acuse', 'usuario', 'invitacion', repeat('f', 64), '2000-01-01')
  returning * into fila;
  perform tests.lg_ok('DL-83', 'hash y hora los fija el servidor: se ignoran los del llamador',
    fila.contenido_sha256 = (select contenido_sha256 from public.documentos_legales_versiones where id = fila.version_id) and fila.aceptado_en = now(), row(fila.*)::text);
  perform tests.lg_ok('DL-83b', 'la fila no guarda correo, IP ni navegador (solo columnas de evidencia)',
    (select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'public.aceptaciones_legales'::regclass and attnum > 0 and not attisdropped)
    = 'id,user_id,tenant_id,version_id,tipo,alcance,origen,declara_facultades,revoca_aceptacion_id,contenido_sha256,aceptado_en');
  perform tests.debe_fallar('DL-84', 'una versión con aceptaciones no se borra', format('delete from public.documentos_legales_versiones where id = %L', vt), '42501');
  perform tests.lg_ok('DL-85', 'user_id y tenant_id sin clave foránea (no se borran en cascada)',
    not exists (select 1 from pg_constraint c where c.conrelid = 'public.aceptaciones_legales'::regclass and c.contype = 'f'
                and c.confrelid in ('auth.users'::regclass, 'public.users'::regclass, 'public.tenants'::regclass)));
end $$;
rollback;

-- ── DL-9x. La evidencia sobrevive; descarte solo de un alta fallida ──
-- auth.users del arnés no trae email_confirmed_at ni last_sign_in_at
-- (Supabase sí): se agregan dentro de la transacción.
begin;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists last_sign_in_at timestamptz;
select tests.lg_preparar();
-- Cuenta y residencial sintéticos: U admin de T (alta pública simulada).
insert into public.empresas (id, nombre) values ('e0000000-0000-0000-0000-0000000000d1', 'Empresa DL');
insert into public.tenants (id, nombre, tipo, empresa_id) values
  ('d1000000-0000-0000-0000-000000000000', 'Residencial DL', 'residencial', 'e0000000-0000-0000-0000-0000000000d1'),
  ('d2000000-0000-0000-0000-000000000000', 'Residencial DL2', 'residencial', 'e0000000-0000-0000-0000-0000000000d1');
set local role supabase_auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'dl1@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'dl2@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'dl3@test.local');
reset role;
insert into public.user_tenants (user_id, tenant_id, rol_id)
select v.u::uuid, v.t::uuid, (select id from public.roles where clave = 'admin_residencial')
from (values ('00000000-0000-0000-0000-0000000000d1', 'd1000000-0000-0000-0000-000000000000'),
             ('00000000-0000-0000-0000-0000000000d2', 'd2000000-0000-0000-0000-000000000000'),
             ('00000000-0000-0000-0000-0000000000d3', 'd2000000-0000-0000-0000-000000000000')) v(u, t);
-- Evidencia de registro (origen 'registro', como la escribirá el alta en la fase 3).
insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, declara_facultades, contenido_sha256)
select u::uuid, t::uuid, tests.lg_vid(c, '1.0'), tipo, alcance, 'registro', alcance = 'residencial', repeat('0', 64)
from (values ('00000000-0000-0000-0000-0000000000d1', 'd1000000-0000-0000-0000-000000000000', 'terminos', 'aceptacion', 'usuario'),
             ('00000000-0000-0000-0000-0000000000d1', 'd1000000-0000-0000-0000-000000000000', 'privacidad', 'acuse', 'usuario'),
             ('00000000-0000-0000-0000-0000000000d1', 'd1000000-0000-0000-0000-000000000000', 'acuerdo_tratamiento', 'aceptacion', 'residencial'),
             ('00000000-0000-0000-0000-0000000000d2', 'd2000000-0000-0000-0000-000000000000', 'terminos', 'aceptacion', 'usuario'),
             ('00000000-0000-0000-0000-0000000000d3', 'd2000000-0000-0000-0000-000000000000', 'terminos', 'aceptacion', 'usuario')) x(u, t, c, tipo, alcance);
do $$
declare
  U uuid := '00000000-0000-0000-0000-0000000000d1';
  T uuid := 'd1000000-0000-0000-0000-000000000000';
  n int;
  r text;
begin
  update auth.users set email_confirmed_at = now() where id = U;
  perform tests.debe_fallar('DL-95', 'cuenta confirmada: su evidencia no se descarta',
    format('select public.descartar_aceptaciones_alta_fallida(%L, %L)', U, T), '42501');
  update auth.users set email_confirmed_at = null, last_sign_in_at = now() where id = U;
  perform tests.debe_fallar('DL-95b', 'cuenta que ya inició sesión: su evidencia no se descarta',
    format('select public.descartar_aceptaciones_alta_fallida(%L, %L)', U, T), '42501');
  update auth.users set last_sign_in_at = null where id = U;
  insert into public.user_tenants (user_id, tenant_id, rol_id) values (U, 'aaaaaaaa-0000-0000-0000-000000000000', (select id from public.roles where clave = 'guardia'));
  perform tests.debe_fallar('DL-95c', 'con otra membresía (cuenta real en otro residencial): no se descarta',
    format('select public.descartar_aceptaciones_alta_fallida(%L, %L)', U, T), '42501');
  delete from public.user_tenants where user_id = U and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  perform tests.debe_fallar('DL-95d', 'residencial con evidencia de otra persona (d2/d3): no se descarta',
    format('select public.descartar_aceptaciones_alta_fallida(%L, %L)', '00000000-0000-0000-0000-0000000000d2', 'd2000000-0000-0000-0000-000000000000'), '42501');
  perform tests.debe_fallar('DL-95e', 'faltan parámetros', format('select public.descartar_aceptaciones_alta_fallida(%L, null)', U), '22023');
  perform tests.debe_fallar('DL-95f', 'usuario inexistente', format('select public.descartar_aceptaciones_alta_fallida(%L, %L)', gen_random_uuid(), T), '22023');
  perform tests.lg_ok('DL-95g', 'ningún intento fallido borró nada', (select count(*) from public.aceptaciones_legales) = 5);

  n := public.descartar_aceptaciones_alta_fallida(U, T);
  perform tests.lg_ok('DL-96', 'alta fallida (sin confirmar ni usar, una sola membresía, todo de registro): se descartan sus 3 filas',
    n = 3 and not exists (select 1 from public.aceptaciones_legales where user_id = U) and (select count(*) from public.aceptaciones_legales) = 2, n::text);
  perform tests.debe_fallar('DL-96b', 'la marca de borrado no sobrevive a la función',
    $q$delete from public.aceptaciones_legales where user_id = '00000000-0000-0000-0000-0000000000d2'$q$, '42501');
  perform tests.lg_ok('DL-96c', 'la marca quedó vacía tras la función', coalesce(current_setting('gateflow.borrado_aceptaciones', true), '') = '');
  r := tests.lg_llamar(U, format('select count(*) from public.aceptaciones_legales where user_id = %L', U));
  perform tests.lg_ok('DL-96d', 'authenticated no borra ni lee evidencia aunque fije la marca', r like 'ERR:42501:%', r);

  -- La cuenta real se borra (Auth → users → membresías): la evidencia queda.
  delete from auth.users where id = '00000000-0000-0000-0000-0000000000d3';
  perform tests.lg_ok('DL-97', 'borrar la cuenta (auth.users en cascada) no borra su evidencia',
    not exists (select 1 from public.users where id = '00000000-0000-0000-0000-0000000000d3')
    and (select count(*) from public.aceptaciones_legales where user_id = '00000000-0000-0000-0000-0000000000d3') = 1);
  delete from public.tenants where id = 'd2000000-0000-0000-0000-000000000000';
  perform tests.lg_ok('DL-98', 'borrar el residencial no borra la evidencia de sus personas',
    not exists (select 1 from public.tenants where id = 'd2000000-0000-0000-0000-000000000000')
    and (select count(*) from public.aceptaciones_legales where tenant_id = 'd2000000-0000-0000-0000-000000000000') = 2);
  perform tests.debe_fallar('DL-98b', 'y sigue siendo inmutable (sin cuenta ni residencial)',
    $q$delete from public.aceptaciones_legales where tenant_id = 'd2000000-0000-0000-0000-000000000000'$q$, '42501');
end $$;
rollback;

do $$ begin
  perform tests.lg_ok('DL-99', 'tras la suite: sigue inactiva (0 versiones, 0 requisitos, 0 aceptaciones, sin EXECUTE para authenticated)',
    (select count(*) from public.documentos_legales_versiones) = 0 and (select count(*) from public.requisitos_legales) = 0
    and (select count(*) from public.aceptaciones_legales) = 0
    and not has_function_privilege('authenticated', 'public.registrar_aceptaciones(uuid,uuid[],text,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.documentos_pendientes(uuid)', 'EXECUTE'));
end $$;

\endif
