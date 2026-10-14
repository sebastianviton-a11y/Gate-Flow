-- ============================================================
-- 20261015000000: lectura pública controlada de documentos legales
-- (Fase 2). Solo corre con la migración aplicada (fase LP del runner).
--   LP-0x  forma y permisos: solo las 3 lecturas de documentos
--          publicados son de anon/authenticated; nada más se abre
--   LP-1x  qué se ve: vigente por país, historial con su situación,
--          retirada consultable, nunca borradores ni aprobados sin
--          publicar ni quién aprobó
--   LP-2x  aislamiento: los documentos son globales; ninguna lectura
--          devuelve ni depende de datos de residenciales o aceptaciones
-- Documentos FICTICIOS, todo dentro de BEGIN … ROLLBACK.
-- ============================================================

create or replace function tests.lp() returns boolean language sql as $$
  select to_regprocedure('public.documentos_legales_historial(text,text)') is not null;
$$;
grant execute on function tests.lp() to anon, authenticated, service_role;

do $$ begin
  if not tests.lp() then raise notice 'INFO|91_documentos_legales_lectura omitido: migración no aplicada'; end if;
end $$;

select tests.lp() as hay_lp \gset
\if :hay_lp

create or replace function tests.lp_ok(p_id text, p_desc text, p_cond boolean, p_detalle text default '') returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) then perform tests.pass(p_id, p_desc); else perform tests.fail(p_id, p_desc, coalesce(p_detalle, '')); end if;
end $$;

-- Versión ficticia en el estado pedido (como postgres). Vigencias
-- distintas por llamada: dentro de una transacción now() es fijo.
create or replace function tests.lp_version(p_clave text, p_version text, p_pais text, p_estado text,
                                            p_vigente timestamptz, p_texto text default null) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.documentos_legales_versiones (documento_clave, version, jurisdiccion, contenido, contenido_sha256, resumen_cambios)
  values (p_clave, p_version, p_pais, coalesce(p_texto, 'Texto ficticio de prueba ' || p_clave || ' ' || p_version || ' ' || p_pais),
          repeat('0', 64), 'Cambios ficticios ' || p_version)
  returning id into v_id;
  if p_estado in ('aprobado', 'publicado', 'retirado') then
    update public.documentos_legales_versiones set estado = 'aprobado', aprobado_por = 'Referencia ficticia de aprobación' where id = v_id;
  end if;
  if p_estado in ('publicado', 'retirado') then
    update public.documentos_legales_versiones set estado = 'publicado', vigente_desde = p_vigente where id = v_id;
  end if;
  if p_estado = 'retirado' then
    update public.documentos_legales_versiones set estado = 'retirado' where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function tests.lp_vid(p_clave text, p_version text, p_pais text) returns uuid language sql as $$
  select id from public.documentos_legales_versiones where documento_clave = p_clave and version = p_version and jurisdiccion = p_pais;
$$;

-- Escenario ficticio: Términos MX 0.9 (retirada), 1.0 (anterior), 1.1
-- (vigente), 2.0 (programada), 3.0 (borrador) y 3.1 (aprobado sin
-- publicar); Términos AR 1.0; Privacidad y Acuerdo MX 1.0.
create or replace function tests.lp_preparar() returns void language plpgsql as $$
begin
  perform tests.lp_version('terminos', '0.9', 'MX', 'publicado', now() - interval '4 minutes 50 seconds');
  perform tests.lp_version('terminos', '1.0', 'MX', 'publicado', now() - interval '4 minutes');
  perform tests.lp_version('terminos', '1.1', 'MX', 'publicado', now() - interval '3 minutes');
  update public.documentos_legales_versiones set estado = 'retirado' where id = tests.lp_vid('terminos', '0.9', 'MX');
  perform tests.lp_version('terminos', '2.0', 'MX', 'publicado', now() + interval '10 days');
  perform tests.lp_version('terminos', '3.0', 'MX', 'borrador', null, 'ZZ_BORRADOR_NO_PUBLICO');
  perform tests.lp_version('terminos', '3.1', 'MX', 'aprobado', null, 'ZZ_APROBADO_NO_PUBLICO');
  perform tests.lp_version('terminos', '1.0', 'AR', 'publicado', now() - interval '4 minutes');
  perform tests.lp_version('privacidad', '1.0', 'MX', 'publicado', now() - interval '4 minutes');
  perform tests.lp_version('acuerdo_tratamiento', '1.0', 'MX', 'publicado', now() - interval '4 minutes');
end $$;

-- p_sql con el rol indicado (y el JWT de p_uid); resultado como texto o 'ERR:<sqlstate>:<mensaje>'.
create or replace function tests.lp_como(p_rol text, p_sql text, p_uid uuid default null) returns text
language plpgsql as $$
declare v text;
begin
  perform tests.como(p_uid, p_rol);
  execute format('set local role %I', p_rol);
  execute 'select (' || p_sql || ')::text' into v;
  reset role;
  return v;
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ── LP-0x. Forma y permisos ───────────────────────────────────
do $$
declare
  f text;
  t text;
  rol text;
  v_lectura text[] := array['public.documentos_legales_vigentes(text)', 'public.documento_legal_publicado(uuid)',
                            'public.documentos_legales_historial(text,text)'];
  v_cerradas text[] := array['public.documentos_pendientes(uuid)', 'public.registrar_aceptaciones(uuid,uuid[],text,boolean)',
                             'public.descartar_aceptaciones_alta_fallida(uuid,uuid)', 'public.documentos_legales_catalogo_guardia()',
                             'public.documentos_legales_versiones_guardia()', 'public.documentos_legales_versiones_auditar()',
                             'public.requisitos_legales_auditar()', 'public.aceptaciones_legales_guardia()',
                             'public.documentos_legales_impedir_truncate()'];
begin
  foreach f in array v_lectura loop
    perform tests.lp_ok('LP-01', f || ': SECURITY DEFINER, STABLE, search_path vacío; EXECUTE para anon y authenticated, no para service_role ni PUBLIC',
      (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
              and has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and not has_function_privilege('service_role', p.oid, 'EXECUTE')
              and not exists (select 1 from unnest(p.proacl) a where a::text like '=%')
       from pg_proc p where p.oid = f::regprocedure),
      (select coalesce(array_to_string(p.proacl, ','), 'acl nula') from pg_proc p where p.oid = f::regprocedure));
  end loop;
  foreach f in array v_cerradas loop
    perform tests.lp_ok('LP-02', f || ': sigue sin EXECUTE para anon, authenticated ni service_role',
      (select not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and not has_function_privilege('service_role', p.oid, 'EXECUTE')
       from pg_proc p where p.oid = f::regprocedure));
  end loop;
  foreach t in array array['public.documentos_legales', 'public.documentos_legales_versiones', 'public.requisitos_legales', 'public.aceptaciones_legales'] loop
    foreach rol in array array['anon', 'authenticated', 'service_role'] loop
      perform tests.lp_ok('LP-03', t || ': ' || rol || ' sigue sin acceso directo a la tabla',
        not has_table_privilege(rol, t, 'SELECT') and not has_table_privilege(rol, t, 'INSERT')
        and not has_table_privilege(rol, t, 'UPDATE') and not has_table_privilege(rol, t, 'DELETE')
        and not has_any_column_privilege(rol, t, 'SELECT, INSERT, UPDATE, REFERENCES'));
    end loop;
  end loop;
  perform tests.lp_ok('LP-04', 'ninguna lectura pública devuelve quién aprobó, usuarios, residenciales ni aceptaciones',
    not exists (select 1 from pg_proc p, unnest(p.proargnames) a
                where p.oid in ('public.documentos_legales_vigentes(text)'::regprocedure, 'public.documento_legal_publicado(uuid)'::regprocedure,
                                'public.documentos_legales_historial(text,text)'::regprocedure)
                  and a in ('aprobado_por', 'aprobado_en', 'user_id', 'tenant_id', 'aceptado_en', 'declara_facultades')));
end $$;

-- Sin nada publicado: todo vacío (las páginas muestran "pendiente").
do $$
declare r text;
begin
  r := tests.lp_como('anon', $q$select count(*) from public.documentos_legales_vigentes('MX')$q$);
  perform tests.lp_ok('LP-05', 'sin publicaciones: vigentes(MX) vacío para anon', r = '0', r);
  r := tests.lp_como('anon', $q$select count(*) from public.documentos_legales_historial('terminos', 'MX')$q$);
  perform tests.lp_ok('LP-05b', 'sin publicaciones: historial vacío para anon', r = '0', r);
  r := tests.lp_como('anon', $q$select count(*) from public.documento_legal_publicado(gen_random_uuid())$q$);
  perform tests.lp_ok('LP-05c', 'versión inexistente: 0 filas (no error)', r = '0', r);
end $$;

-- ── LP-1x. Qué se ve ──────────────────────────────────────────
begin;
select tests.lp_preparar();
do $$
declare
  r text;
  v_vig text;
  v09 uuid := tests.lp_vid('terminos', '0.9', 'MX');
  v30 uuid := tests.lp_vid('terminos', '3.0', 'MX');
  v31 uuid := tests.lp_vid('terminos', '3.1', 'MX');
  v20 uuid := tests.lp_vid('terminos', '2.0', 'MX');
begin
  r := tests.lp_como('anon', $q$select string_agg(documento_clave || ':' || version, ',' order by documento_clave) from public.documentos_legales_vigentes('MX')$q$);
  perform tests.lp_ok('LP-10', 'vigentes(MX) para anon: Acuerdo 1.0, Privacidad 1.0, Términos 1.1 (ni la programada ni el borrador)',
    r = 'acuerdo_tratamiento:1.0,privacidad:1.0,terminos:1.1', r);
  r := tests.lp_como('anon', $q$select string_agg(documento_clave || ':' || version, ',' order by documento_clave) from public.documentos_legales_vigentes('AR')$q$);
  perform tests.lp_ok('LP-11', 'vigentes(AR): solo los publicados para Argentina', r = 'terminos:1.0', r);
  r := tests.lp_como('anon', $q$select string_agg(version || ':' || situacion || ':' || estado, ',') from public.documentos_legales_historial('terminos', 'MX')$q$);
  perform tests.lp_ok('LP-12', 'historial Términos MX: programada, vigente, anterior y retirada; sin borrador ni aprobado',
    r = '2.0:programada:publicado,1.1:vigente:publicado,1.0:anterior:publicado,0.9:retirada:retirado', r);
  r := tests.lp_como('anon', $q$select string_agg(version || ':' || situacion, ',') from public.documentos_legales_historial('terminos', 'AR')$q$);
  perform tests.lp_ok('LP-13', 'historial Términos AR: solo la versión de Argentina', r = '1.0:vigente', r);
  r := tests.lp_como('anon', $q$select string_agg(version || ':' || situacion, ',') from public.documentos_legales_historial('acuerdo_tratamiento', 'AR')$q$);
  perform tests.lp_ok('LP-13b', 'documento sin versiones para un país: historial vacío', r is null, coalesce(r, 'null'));

  r := tests.lp_como('anon', format($q$select estado || ':' || version || ':' || (retirado_en is not null)::text || ':' || (contenido like 'Texto ficticio%%')::text
                                       || ':' || (contenido_sha256 = encode(sha256(convert_to(contenido, 'UTF8')), 'hex'))::text
                                       from public.documento_legal_publicado(%L)$q$, v09));
  perform tests.lp_ok('LP-14', 'una versión retirada se consulta desde el historial: texto, estado retirado y hash verificable', r = 'retirado:0.9:true:true:true', r);
  r := tests.lp_como('anon', format($q$select count(*) from public.documento_legal_publicado(%L)$q$, v30));
  perform tests.lp_ok('LP-15', 'un borrador no se devuelve ni pidiéndolo por id', r = '0', r);
  r := tests.lp_como('anon', format($q$select count(*) from public.documento_legal_publicado(%L)$q$, v31));
  perform tests.lp_ok('LP-15b', 'un aprobado sin publicar no se devuelve ni pidiéndolo por id', r = '0', r);
  r := tests.lp_como('anon', format($q$select estado || ':' || (vigente_desde > now())::text from public.documento_legal_publicado(%L)$q$, v20));
  perform tests.lp_ok('LP-15c', 'una programada (publicada con vigencia futura) se puede leer y se identifica por su vigencia', r = 'publicado:true', r);

  r := tests.lp_como('anon', $q$
    (select coalesce(string_agg(x::text, '|'), '') from public.documentos_legales_vigentes('MX') x)
    || (select coalesce(string_agg(x::text, '|'), '') from public.documentos_legales_historial('terminos', 'MX') x)
    || (select coalesce(string_agg(p::text, '|'), '') from public.documentos_legales_historial('terminos', 'MX') h
          cross join lateral public.documento_legal_publicado(h.version_id) p)$q$);
  perform tests.lp_ok('LP-16', 'nada de lo que lee anon contiene el texto de un borrador o de un aprobado sin publicar, ni quién aprobó',
    r not like '%ZZ_BORRADOR%' and r not like '%ZZ_APROBADO%' and r not like '%Referencia ficticia%', left(r, 120));

  v_vig := tests.lp_como('anon', $q$select version_id from public.documentos_legales_vigentes('MX') where documento_clave = 'terminos'$q$);
  r := tests.lp_como('anon', $q$select version_id from public.documentos_legales_historial('terminos', 'MX') where situacion = 'vigente'$q$);
  perform tests.lp_ok('LP-17', 'la vigente del historial es la misma que devuelve documentos_legales_vigentes (una sola regla, en el servidor)',
    r = v_vig and r is not null, coalesce(r, 'null') || ' / ' || coalesce(v_vig, 'null'));

  r := tests.lp_como('anon', $q$select count(*) from public.documentos_legales_historial('terminos', 'US')$q$);
  perform tests.lp_ok('LP-18', 'país no válido: 22023', r like 'ERR:22023:%', r);
  r := tests.lp_como('anon', $q$select count(*) from public.documentos_legales_historial('inventado', 'MX')$q$);
  perform tests.lp_ok('LP-18b', 'documento no válido: 22023', r like 'ERR:22023:%', r);
  r := tests.lp_como('anon', $q$select count(*) from public.documentos_legales_historial(null, null)$q$);
  perform tests.lp_ok('LP-18c', 'parámetros nulos: 22023', r like 'ERR:22023:%', r);

  r := tests.lp_como('anon', $q$select count(*) from public.documentos_legales_versiones$q$);
  perform tests.lp_ok('LP-19', 'anon no lee la tabla de versiones directamente (ni borradores ni nada)', r like 'ERR:42501:%', r);
  r := tests.lp_como('anon', $q$select count(*) from public.aceptaciones_legales$q$);
  perform tests.lp_ok('LP-19b', 'anon no lee aceptaciones', r like 'ERR:42501:%', r);
  r := tests.lp_como('anon', $q$select count(*) from public.documentos_pendientes('aaaaaaaa-0000-0000-0000-000000000000')$q$);
  perform tests.lp_ok('LP-19c', 'anon no llama documentos_pendientes', r like 'ERR:42501:permission denied%', r);
  r := tests.lp_como('anon', $q$select public.registrar_aceptaciones('aaaaaaaa-0000-0000-0000-000000000000', array[gen_random_uuid()], 'aceptacion_posterior', true)$q$);
  perform tests.lp_ok('LP-19d', 'anon no llama registrar_aceptaciones', r like 'ERR:42501:permission denied%', r);
  r := tests.lp_como('service_role', $q$select count(*) from public.documentos_legales_vigentes('MX')$q$);
  perform tests.lp_ok('LP-19e', 'service_role no recibió nada (sin EXECUTE)', r like 'ERR:42501:permission denied%', r);
  v_vig := (select count(*)::text from public.audit_log);
  r := tests.lp_como('anon', $q$(select count(*) from public.documentos_legales_vigentes('MX'))
                                 + (select count(*) from public.documentos_legales_historial('terminos', 'MX'))$q$);
  perform tests.lp_ok('LP-19f', 'las lecturas no escriben: leer no agrega nada a audit_log',
    r = '7' and (select count(*)::text from public.audit_log) = v_vig, r);
end $$;
rollback;

-- ── LP-2x. Aislamiento entre residenciales ────────────────────
begin;
select tests.lp_preparar();
insert into public.requisitos_legales values ('admin_residencial', 'terminos', 'MX', 'aceptacion', 'usuario');
do $$
declare
  a text;
  b text;
  anon text;
  q text := $q$(select string_agg(x::text, '|' order by x::text) from public.documentos_legales_vigentes('MX') x)
                || '#' || (select string_agg(x::text, '|' order by x::text) from public.documentos_legales_historial('terminos', 'MX') x)$q$;
  antes text;
begin
  anon := tests.lp_como('anon', q);
  a := tests.lp_como('authenticated', q, '00000000-0000-0000-0000-00000000000a');
  b := tests.lp_como('authenticated', q, '00000000-0000-0000-0000-00000000000b');
  perform tests.lp_ok('LP-20', 'los documentos son globales: anon, admin de A y admin de B leen exactamente lo mismo', anon = a and a = b and anon is not null,
    md5(coalesce(anon, '')) || ' ' || md5(coalesce(a, '')) || ' ' || md5(coalesce(b, '')));
  antes := anon;
  -- Una aceptación real de A (como la registraría la Fase 3) no cambia lo que lee nadie.
  insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, contenido_sha256)
  values ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', tests.lp_vid('terminos', '1.1', 'MX'),
          'aceptacion', 'usuario', 'aceptacion_posterior', repeat('0', 64));
  b := tests.lp_como('authenticated', q, '00000000-0000-0000-0000-00000000000b');
  anon := tests.lp_como('anon', q);
  perform tests.lp_ok('LP-21', 'tras una aceptación en A, ni B ni anon ven nada distinto (no se infiere quién aceptó)', anon = antes and b = antes);
  perform tests.lp_ok('LP-22', 'nada de lo leído contiene identificadores de residenciales ni de usuarios',
    antes not like '%aaaaaaaa-0000%' and antes not like '%bbbbbbbb-0000%' and antes not like '%00000000-0000-0000-0000-00000000000a%');
end $$;
rollback;

do $$ begin
  perform tests.lp_ok('LP-99', 'tras la suite: 0 versiones, 0 requisitos y 0 aceptaciones (todo se revirtió)',
    (select count(*) from public.documentos_legales_versiones) = 0 and (select count(*) from public.requisitos_legales) = 0
    and (select count(*) from public.aceptaciones_legales) = 0);
end $$;

\endif
