-- ============================================================
-- Grupos de entrega con el token de gen_random_uuid() (sección 5 de
-- la reconciliación) y el flujo real de Guard:
--   registrarPaquete → obtenerOCrearGrupoEntrega (o
--   crearGrupoEntregaSeparado) → ligarPaqueteAGrupo (UPDATE paquetes +
--   recalcular_grupo_entrega) → obtenerGrupoEntrega → escaneo por
--   token → entregarGrupoPaquetes.
-- Solo corre si la reconciliación está aplicada.
--
--   guard_a 00000000-…-0000000000a9   guard_b 00000000-…-0000000000b9
--   A: unidad a1000000…, ubicación a2000000…, grupo abierto a4000000…
-- ============================================================

create temp table if not exists grupos_reconciliados as
select exists (select 1 from pg_proc
               where oid = 'public.crear_grupo_entrega_separado(uuid,uuid,uuid)'::regprocedure
                 and prosrc like '%gen_random_uuid%') as si;
grant select on grupos_reconciliados to anon, authenticated, service_role;

do $$
begin
  if not (select si from grupos_reconciliados) then
    raise notice 'INFO|50_grupos omitida: la reconciliación de grupos no está aplicada';
  end if;
end $$;

-- ── Obtener/crear, separado, token ────────────────────────────

begin;
-- Sin grupo abierto para la unidad A1.
delete from public.paquete_grupos_entrega where id = 'a4000000-0000-0000-0000-000000000000';
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
do $$
declare
  ta constant uuid := 'aaaaaaaa-0000-0000-0000-000000000000';
  ua constant uuid := 'a1000000-0000-0000-0000-000000000000';
  g1 uuid; g2 uuid; g3 uuid;
begin
  if not (select si from grupos_reconciliados) then return; end if;

  g1 := public.obtener_o_crear_grupo_entrega(ta, ua);
  perform tests.igual('G-01', 'obtener_o_crear crea grupo pendiente con código RETIRO-',
    format($q$select estado || '|' || (codigo_grupo ~ '^RETIRO-[0-9]{6}$')::text from public.paquete_grupos_entrega where id = %L$q$, g1),
    'pendiente|true');

  g2 := public.obtener_o_crear_grupo_entrega(ta, ua, '00000000-0000-0000-0000-0000000000a9');
  perform tests.igual('G-02', 'obtener_o_crear reutiliza el grupo abierto y completa residente_id',
    format($q$select (%L::uuid = %L::uuid)::text || '|' || (residente_id is not null)::text
              from public.paquete_grupos_entrega where id = %L$q$, g1, g2, g1),
    'true|true');

  g3 := public.crear_grupo_entrega_separado(ta, ua);
  perform tests.igual('G-03', 'crear_grupo_entrega_separado crea otro grupo aunque haya uno abierto',
    format($q$select (%L::uuid <> %L::uuid)::text || '|' || count(*)::text
              from public.paquete_grupos_entrega where unidad_id = %L and estado = 'pendiente'$q$, g3, g1, ua),
    'true|2');

  perform tests.igual('G-04', 'token: no nulo, 64 caracteres hex en minúsculas (formato de producción)',
    format($q$select string_agg((token is not null and token ~ '^[0-9a-f]{64}$')::text, ',' order by created_at)
              from public.paquete_grupos_entrega where id in (%L, %L)$q$, g1, g3),
    'true,true');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
do $$
declare
  i int;
begin
  if not (select si from grupos_reconciliados) then return; end if;
  for i in 1..300 loop
    perform public.crear_grupo_entrega_separado('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000');
  end loop;
  perform tests.igual('G-05', '300 grupos: 300 tokens distintos y ninguno coincide con un pickup_token',
    $q$select count(distinct token)::text || '|' ||
              (select count(*) from public.paquete_grupos_entrega g join public.paquetes p on p.pickup_token = g.token)::text
       from public.paquete_grupos_entrega
       where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' and token ~ '^[0-9a-f]{64}$'$q$,
    '300|0');
end $$;
rollback;

-- ── Flujo real de Guard: registrar → agrupar → escanear → entregar ─

begin;
delete from public.paquete_grupos_entrega where id = 'a4000000-0000-0000-0000-000000000000';
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
do $$
declare
  ta constant uuid := 'aaaaaaaa-0000-0000-0000-000000000000';
  ua constant uuid := 'a1000000-0000-0000-0000-000000000000';
  ubi constant uuid := 'a2000000-0000-0000-0000-000000000000';
  p1 uuid; p2 uuid; p3 uuid; g uuid; gsep uuid; v_token text;
begin
  if not (select si from grupos_reconciliados) then return; end if;

  -- Paquete 1: registrarPaquete + obtenerOCrearGrupoEntrega + ligarPaqueteAGrupo.
  insert into public.paquetes (tenant_id, unidad_id, ubicacion_id, recibido_por, estado_id)
  values (ta, ua, ubi, auth.uid(), 'recibido') returning id into p1;
  g := public.obtener_o_crear_grupo_entrega(ta, ua, null);
  update public.paquetes set grupo_entrega_id = g where id = p1;
  perform public.recalcular_grupo_entrega(g);

  -- Paquete 2: mismo grupo (opción predeterminada "existente").
  insert into public.paquetes (tenant_id, unidad_id, ubicacion_id, recibido_por, estado_id)
  values (ta, ua, ubi, auth.uid(), 'recibido') returning id into p2;
  perform tests.igual('G-06', 'Guard: el segundo paquete reutiliza el mismo grupo',
    format($q$select (public.obtener_o_crear_grupo_entrega(%L, %L, null) = %L::uuid)::text$q$, ta, ua, g), 'true');
  update public.paquetes set grupo_entrega_id = g where id = p2;
  perform public.recalcular_grupo_entrega(g);

  perform tests.igual('G-07', 'Guard: obtenerGrupoEntrega muestra 2 paquetes pendientes',
    format($q$select estado || '|' || cantidad_total || '|' || cantidad_entregada from public.paquete_grupos_entrega where id = %L$q$, g),
    'pendiente|2|0');

  -- Paquete 3: grupo separado.
  insert into public.paquetes (tenant_id, unidad_id, ubicacion_id, recibido_por, estado_id)
  values (ta, ua, ubi, auth.uid(), 'recibido') returning id into p3;
  gsep := public.crear_grupo_entrega_separado(ta, ua, null);
  update public.paquetes set grupo_entrega_id = gsep where id = p3;
  perform public.recalcular_grupo_entrega(gsep);
  perform tests.igual('G-08', 'Guard: grupo separado con su propio paquete',
    format($q$select cantidad_total::text from public.paquete_grupos_entrega where id = %L$q$, gsep), '1');

  -- Escaneo del QR (obtenerGrupoPorTokenConPaquetes).
  select token into v_token from public.paquete_grupos_entrega where id = g;
  perform tests.igual('G-09', 'Guard: escaneo por token encuentra el grupo y sus paquetes',
    format($q$select count(p.id)::text from public.paquete_grupos_entrega gr
              join public.unidades u on u.id = gr.unidad_id
              join public.paquetes p on p.grupo_entrega_id = gr.id
              where gr.token = %L$q$, v_token), '2');

  -- Entrega parcial y luego total (entregarGrupoPaquetes).
  perform public.entregar_grupo_paquetes(g, array[p1], auth.uid(), 'Residente Demo');
  perform tests.igual('G-10', 'entrega parcial del grupo: parcial 2/1',
    format($q$select estado || '|' || cantidad_total || '|' || cantidad_entregada from public.paquete_grupos_entrega where id = %L$q$, g),
    'parcial|2|1');
  perform public.entregar_grupo_paquetes(g, array[p2], auth.uid(), 'Residente Demo');
  perform tests.igual('G-11', 'entrega total del grupo: completado, paquetes entregados con historial',
    format($q$select gr.estado || '|' || gr.cantidad_entregada || '|' || (gr.fecha_entrega is not null)::text || '|' ||
                     (select count(*) from public.paquetes where grupo_entrega_id = gr.id and estado_id = 'entregado') || '|' ||
                     (select count(*) from public.paquete_historial h where h.paquete_id in (%L, %L) and h.estado_nuevo_id = 'entregado')
              from public.paquete_grupos_entrega gr where gr.id = %L$q$, p1, p2, g),
    'completado|2|true|2|2');
  perform tests.igual('G-12', 'tras completar, obtener_o_crear abre un grupo nuevo',
    format($q$select (public.obtener_o_crear_grupo_entrega(%L, %L, null) not in (%L::uuid))::text$q$, ta, ua, g), 'true');
end $$;
rollback;

-- ── Aislamiento A/B ───────────────────────────────────────────

begin;
select tests.como('00000000-0000-0000-0000-0000000000b9'); set local role authenticated;
do $$
begin
  if not (select si from grupos_reconciliados) then return; end if;
  perform tests.debe_fallar('G-13', 'guardia B no crea grupo en A (obtener_o_crear)',
    $q$select public.obtener_o_crear_grupo_entrega('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000')$q$,
    '42501');
  perform tests.debe_fallar('G-14', 'guardia B no crea grupo separado en A',
    $q$select public.crear_grupo_entrega_separado('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000')$q$,
    '42501');
  perform tests.igual('G-15', 'guardia B no encuentra el grupo de A por token',
    $q$select count(*)::text from public.paquete_grupos_entrega where token = 'tok-a'$q$, '0');
  perform tests.debe_fallar('G-16', 'guardia B no entrega el grupo de A',
    $q$select public.entregar_grupo_paquetes('a4000000-0000-0000-0000-000000000000', array['a3000000-0000-0000-0000-000000000000']::uuid[],
                                              auth.uid(), 'X')$q$,
    'P0001');
  perform tests.filas('G-17', 'guardia B no modifica el grupo de A',
    $q$update public.paquete_grupos_entrega set residente_id = null where id = 'a4000000-0000-0000-0000-000000000000'$q$, 0);
end $$;
rollback;

-- ── Seguridad de las funciones ────────────────────────────────

do $$
begin
  if not (select si from grupos_reconciliados) then return; end if;
  perform tests.igual('G-18', 'ambas: INVOKER, search_path vacío, EXECUTE solo authenticated',
    $q$select string_agg(p.proname || ':' || p.prosecdef || '|' || array_to_string(p.proconfig, ',') || '|' ||
                         has_function_privilege('anon', p.oid, 'EXECUTE') || ',' ||
                         has_function_privilege('authenticated', p.oid, 'EXECUTE') || ',' ||
                         has_function_privilege('service_role', p.oid, 'EXECUTE'), ' ; ' order by p.proname)
       from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('crear_grupo_entrega_separado', 'obtener_o_crear_grupo_entrega')$q$,
    'crear_grupo_entrega_separado:false|search_path=""|false,true,false ; obtener_o_crear_grupo_entrega:false|search_path=""|false,true,false');
end $$;

begin;
set local role anon;
do $$
begin
  if not (select si from grupos_reconciliados) then return; end if;
  perform tests.debe_fallar('G-19', 'anon no ejecuta obtener_o_crear_grupo_entrega',
    $q$select public.obtener_o_crear_grupo_entrega('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000')$q$,
    '42501');
end $$;
rollback;
