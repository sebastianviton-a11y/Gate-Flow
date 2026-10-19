-- ============================================================
-- Reconciliación de paridad (20260729200000): incidencias con
-- nivel_danio, 13 tipos, registrar_paquete_con_incidencia e historial
-- de paquetes, siempre con los grants de mínimo privilegio.
-- Solo corre si la reconciliación está aplicada.
--
--   guard_a  00000000-…-0000000000a9  guardia en A
--   admin_a  00000000-…-00000000000a  admin en A
--   guard_b  00000000-…-0000000000b9  guardia en B
--   A: unidad a1000000…, ubicación a2000000…, paquete a3000000…
--   B: unidad b1000000…, ubicación b2000000…, paquete b3000000…
-- ============================================================

create temp table if not exists reconciliacion_aplicada as
select exists (select 1 from pg_attribute
               where attrelid = 'public.incidencias'::regclass and attname = 'nivel_danio' and not attisdropped) as si;
grant select on reconciliacion_aplicada to anon, authenticated, service_role;

do $$
begin
  if not (select si from reconciliacion_aplicada) then
    raise notice 'INFO|40_reconciliacion omitida: la reconciliación no está aplicada';
  end if;
end $$;

-- ── Incidencias ───────────────────────────────────────────────

begin;
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
do $$
declare
  v_id uuid;
  v_tipo text;
  v_aceptados int := 0;
begin
  if not (select si from reconciliacion_aplicada) then return; end if;

  -- R-02: reportarIncidencia (incidencias.ts:62) con nivel_danio.
  insert into public.incidencias (tenant_id, paquete_id, tipo, descripcion, nivel_danio, reportada_por)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000',
          'golpeado', 'Caja golpeada', 'moderado', auth.uid())
  returning id into v_id;
  perform tests.pass('R-02', 'guardia reporta incidencia con nivel_danio');

  -- R-03: los 13 tipos de producción se aceptan.
  foreach v_tipo in array array['danado', 'abierto', 'mojado', 'etiqueta_ilegible', 'destinatario_desconocido',
                                'rechazado', 'devuelto', 'extraviado', 'golpeado', 'roto',
                                'empaque_deteriorado', 'contenido_incompleto', 'otro']
  loop
    insert into public.incidencias (tenant_id, paquete_id, tipo, reportada_por)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', v_tipo, auth.uid());
    v_aceptados := v_aceptados + 1;
  end loop;
  perform tests.igual('R-03a', 'los 13 tipos de incidencia se aceptan', format('select %s::text', v_aceptados), '13');

  -- R-01: listarIncidencias con el INCIDENCIA_SELECT real
  -- (incidencias.ts:168): columnas + paquetes→unidades, users por las
  -- dos FK y conteo de fotografías. Lo lee el admin del residencial.
  perform tests.como('00000000-0000-0000-0000-00000000000a');
  perform tests.igual('R-01', 'admin A: listarIncidencias (INCIDENCIA_SELECT con nivel_danio y embebidos)',
    $q$select count(*)::text from (
         select i.id, i.paquete_id, i.tipo, i.estado, i.descripcion, i.nivel_danio, i.created_at, i.resuelta_en,
                p.codigo_gateflow, u.identificador, rep.nombre_completo, res.nombre_completo,
                (select count(*) from public.incidencia_fotografias f where f.incidencia_id = i.id)
         from public.incidencias i
         left join public.paquetes p on p.id = i.paquete_id
         left join public.unidades u on u.id = p.unidad_id
         left join public.users rep on rep.id = i.reportada_por
         left join public.users res on res.id = i.resuelta_por
         where i.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'
         order by i.created_at desc) x$q$, '14');

  -- R-01b: detalle (listarIncidenciasDePaquete, incidencias-historial.ts:38).
  perform tests.igual('R-01b', 'admin A: detalle de incidencias del paquete con nivel_danio',
    $q$select nivel_danio from public.incidencias where paquete_id = 'a3000000-0000-0000-0000-000000000000'
       and tipo = 'golpeado' and descripcion = 'Caja golpeada'$q$, 'moderado');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
do $$
begin
  if not (select si from reconciliacion_aplicada) then return; end if;
  perform tests.debe_fallar('R-03b', 'tipo de incidencia inválido rechazado',
    $q$insert into public.incidencias (tenant_id, paquete_id, tipo, reportada_por)
       values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'inventado', auth.uid())$q$,
    '23514');
  perform tests.debe_fallar('R-03c', 'nivel_danio inválido rechazado',
    $q$insert into public.incidencias (tenant_id, paquete_id, tipo, nivel_danio, reportada_por)
       values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'roto', 'extremo', auth.uid())$q$,
    '23514');
end $$;
rollback;

-- ── Registro, historial y entrega ─────────────────────────────

begin;
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
do $$
declare
  v_paquete uuid;
  v_con_inc uuid;
  v_inc uuid;
begin
  if not (select si from reconciliacion_aplicada) then return; end if;

  -- R-04: registrarPaquete (mutations.ts:164) sin incidencia.
  insert into public.paquetes (tenant_id, unidad_id, ubicacion_id, recibido_por, estado_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000',
          'a2000000-0000-0000-0000-000000000000', auth.uid(), 'recibido')
  returning id into v_paquete;
  perform tests.pass('R-04', 'guardia registra paquete sin incidencia');

  -- R-06: el trigger DEFINER crea el historial de recepción.
  perform tests.igual('R-06', 'registro crea paquete_historial (null → recibido, por el guardia)',
    format($q$select string_agg(coalesce(estado_anterior_id, 'null') || '→' || estado_nuevo_id || '|' || (user_id = auth.uid())::text, ',')
              from public.paquete_historial where paquete_id = %L$q$, v_paquete),
    'null→recibido|true');

  -- R-05: registrarPaqueteConIncidencia (incidencias.ts:105).
  select r.paquete_id, r.incidencia_id into v_con_inc, v_inc
  from public.registrar_paquete_con_incidencia(
    'aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', null, 'Remitente', null,
    'GUIA-1', null, null, 'a2000000-0000-0000-0000-000000000000', null, auth.uid(),
    'roto', 'Llegó roto', 'grave') r;
  perform tests.igual('R-05', 'guardia registra paquete con incidencia (RPC)',
    format($q$select p.estado_id || '|' || i.tipo || '|' || i.nivel_danio || '|' ||
                     (select count(*) from public.paquete_historial h where h.paquete_id = p.id)
              from public.paquetes p join public.incidencias i on i.paquete_id = p.id
              where p.id = %L and i.id = %L$q$, v_con_inc, v_inc),
    'recibido|roto|grave|1');

  -- R-07: entrega (entregar_paquete, SECURITY INVOKER) y su historial.
  perform public.entregar_paquete(v_paquete, auth.uid(), 'Residente Demo');
  perform tests.igual('R-07', 'entrega: paquete entregado y historial recibido → entregado',
    format($q$select p.estado_id || '|' || (select string_agg(coalesce(estado_anterior_id, 'null') || '→' || estado_nuevo_id, ',' order by created_at, estado_anterior_id nulls first)
                                            from public.paquete_historial h where h.paquete_id = p.id)
              from public.paquetes p where p.id = %L$q$, v_paquete),
    'entregado|null→recibido,recibido→entregado');

  -- R-08: el guardia lee el historial que necesita (detalle/entrega).
  perform tests.igual('R-08', 'guardia A lee el historial de sus paquetes',
    format($q$select count(*)::text from public.paquete_historial h
              join public.users u on u.id = h.user_id
              where h.paquete_id in (%L, %L)$q$, v_paquete, v_con_inc), '3');
end $$;
rollback;

-- ── Aislamiento A/B ───────────────────────────────────────────

begin;
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
do $$
begin
  if not (select si from reconciliacion_aplicada) then return; end if;
  perform tests.debe_fallar('R-09a', 'guardia A no registra paquete con incidencia en B (RLS)',
    $q$select * from public.registrar_paquete_con_incidencia(
         'bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', null, null, null,
         null, null, null, 'b2000000-0000-0000-0000-000000000000', null, auth.uid(), 'roto', null, 'leve')$q$,
    '42501');
  perform tests.debe_fallar('R-09b', 'guardia A no registra paquete en B',
    $q$insert into public.paquetes (tenant_id, unidad_id, ubicacion_id, recibido_por, estado_id)
       values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000',
               'b2000000-0000-0000-0000-000000000000', auth.uid(), 'recibido')$q$,
    '42501');
  perform tests.debe_fallar('R-09c', 'guardia A no reporta incidencia en B',
    $q$insert into public.incidencias (tenant_id, paquete_id, tipo, reportada_por)
       values ('bbbbbbbb-0000-0000-0000-000000000000', 'b3000000-0000-0000-0000-000000000000', 'roto', auth.uid())$q$,
    '42501');
  perform tests.debe_fallar('R-09d', 'guardia A no entrega un paquete de B (invisible por RLS)',
    $q$select public.entregar_paquete('b3000000-0000-0000-0000-000000000000', auth.uid(), 'X')$q$,
    'P0001');
  perform tests.debe_fallar('R-09e', 'nadie escribe paquete_historial directamente',
    $q$insert into public.paquete_historial (tenant_id, paquete_id, estado_nuevo_id)
       values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'entregado')$q$,
    '42501');
end $$;
rollback;

-- Incidencias de B creadas por su guardia: A no las ve ni las toca.
begin;
select tests.como('00000000-0000-0000-0000-0000000000b9'); set local role authenticated;
do $$
begin
  if not (select si from reconciliacion_aplicada) then return; end if;
  insert into public.incidencias (tenant_id, paquete_id, tipo, nivel_danio, reportada_por)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'b3000000-0000-0000-0000-000000000000', 'mojado', 'leve', auth.uid());
  perform tests.como('00000000-0000-0000-0000-00000000000a');
  perform tests.igual('R-09f', 'admin A no ve incidencias de B',
    $q$select count(*)::text from public.incidencias where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$q$, '0');
  perform tests.filas('R-09g', 'admin A no resuelve incidencias de B',
    $q$update public.incidencias set estado = 'resuelta' where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$q$, 0);
  perform tests.igual('R-09h', 'admin A no ve el historial de B',
    $q$select count(*)::text from public.paquete_historial where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$q$, '0');
end $$;
rollback;

-- ── Funciones: seguridad de la reconciliación ─────────────────

do $$
begin
  if not (select si from reconciliacion_aplicada) then return; end if;
  perform tests.igual('R-10a', 'fn_registrar_historial_paquete: DEFINER, search_path vacío, sin EXECUTE para la API',
    $q$select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' ||
              has_function_privilege('anon', p.oid, 'EXECUTE')::text || ',' ||
              has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || ',' ||
              has_function_privilege('service_role', p.oid, 'EXECUTE')::text
       from pg_proc p where p.oid = 'public.fn_registrar_historial_paquete()'::regprocedure$q$,
    'true|search_path=""|false,false,false');
  perform tests.igual('R-10b', 'registrar_paquete_con_incidencia: INVOKER, search_path fijo, EXECUTE solo authenticated',
    $q$select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' ||
              has_function_privilege('anon', p.oid, 'EXECUTE')::text || ',' ||
              has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || ',' ||
              has_function_privilege('service_role', p.oid, 'EXECUTE')::text
       from pg_proc p where p.proname = 'registrar_paquete_con_incidencia' and p.pronamespace = 'public'::regnamespace$q$,
    'false|search_path=public, extensions|false,true,false');
end $$;

begin;
set local role anon;
do $$
begin
  if not (select si from reconciliacion_aplicada) then return; end if;
  perform tests.debe_fallar('R-10c', 'anon no ejecuta registrar_paquete_con_incidencia',
    $q$select * from public.registrar_paquete_con_incidencia(
         'aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', null, null, null,
         null, null, null, 'a2000000-0000-0000-0000-000000000000', null, null, 'roto', null, 'leve')$q$,
    '42501');
end $$;
rollback;
