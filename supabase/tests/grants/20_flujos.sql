-- ============================================================
-- Flujos reales de Admin/Guard con los grants de mínimo privilegio.
-- Cada caso: su transacción, rol de la API + JWT simulado, ROLLBACK.
-- Las consultas replican lo que PostgREST ejecuta para las llamadas
-- del código (los embebidos son joins que exigen SELECT en ambas
-- tablas).
--
--   super    00000000-…-000000000001  super_admin en P
--   admin_a  00000000-…-00000000000a  admin en A
--   guard_a  00000000-…-0000000000a9  guardia en A
--   admin_b  00000000-…-00000000000b  admin en B
-- ============================================================

-- ── Sesión: middleware y get-session.ts ───────────────────────

begin;
select tests.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
select tests.igual('F-01', 'middleware: user_tenants → tenants(onboarding, estado) sin 403',
  $$select t.onboarding_completado::text || '/' || t.estado_servicio
    from public.user_tenants ut join public.tenants t on t.id = ut.tenant_id
    where ut.user_id = auth.uid() and ut.activo limit 1$$,
  'true/piloto');
rollback;

begin;
select tests.como('00000000-0000-0000-0000-000000000001'); set local role authenticated;
select tests.igual('F-02', 'get-session super admin: tenant UUID real y rol super_admin (sin demo-tenant)',
  $$select t.id::text || '|' || r.clave
    from public.user_tenants ut
    join public.roles r on r.id = ut.rol_id
    join public.tenants t on t.id = ut.tenant_id
    where ut.user_id = auth.uid() and ut.activo limit 1$$,
  '11111111-0000-0000-0000-000000000000|super_admin');
rollback;

begin;
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
select tests.igual('F-03', 'get-session guardia A: tenant A y rol guardia',
  $$select t.id::text || '|' || r.clave
    from public.user_tenants ut
    join public.roles r on r.id = ut.rol_id
    join public.tenants t on t.id = ut.tenant_id
    where ut.user_id = auth.uid() and ut.activo limit 1$$,
  'aaaaaaaa-0000-0000-0000-000000000000|guardia');
rollback;

-- ── Dashboard ─────────────────────────────────────────────────

begin;
select tests.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
select tests.igual('F-04', 'dashboard A: v_dashboard_resumen con tenant UUID devuelve su fila',
  $$select count(*)::text from public.v_dashboard_resumen
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, '1');
select tests.debe_funcionar('F-05', 'dashboard A: v_dashboard_por_prioridad y v_dashboard_por_ubicacion',
  $$select (select count(*) from public.v_dashboard_por_prioridad where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000')
         + (select count(*) from public.v_dashboard_por_ubicacion where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000')$$);
select tests.igual('F-06', 'dashboard A: actividad reciente (paquete_historial → paquetes → unidades)',
  $$select count(*)::text from public.paquete_historial h
    join public.paquetes p on p.id = h.paquete_id
    left join public.unidades u on u.id = p.unidad_id
    where p.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, '1');
select tests.igual('F-07', 'catálogos del formulario de registro legibles',
  $$select ((select count(*) from public.empresas_paqueteria) > 0
         and (select count(*) from public.tamanos_paquete) > 0
         and (select count(*) from public.prioridades_paquete) > 0)::text$$, 'true');
rollback;

-- ── Aislamiento entre residenciales ───────────────────────────

begin;
select tests.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
select tests.igual('X-01', 'admin A no ve el resumen del dashboard de B',
  $$select count(*)::text from public.v_dashboard_resumen where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, '0');
select tests.igual('X-02', 'admin A no ve paquetes de B',
  $$select count(*)::text from public.paquetes where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, '0');
select tests.igual('X-03', 'admin A solo ve su tenant',
  $$select string_agg(id::text, ',') from public.tenants$$, 'aaaaaaaa-0000-0000-0000-000000000000');
select tests.igual('X-04', 'admin A no ve membresías de B',
  $$select count(*)::text from public.user_tenants where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, '0');
select tests.filas('X-05', 'admin A no actualiza unidades de B',
  $$update public.unidades set notas = 'x' where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 0);
select tests.filas('X-06', 'admin A sí actualiza unidades de A',
  $$update public.unidades set notas = 'x' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 1);
rollback;

begin;
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
select tests.igual('X-07', 'guardia A no ve historial de B',
  $$select count(*)::text from public.paquete_historial where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, '0');
select tests.filas('X-08', 'guardia A no borra ubicaciones (RLS solo admin)',
  $$delete from public.ubicaciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 0);
rollback;

begin;
select tests.como('00000000-0000-0000-0000-000000000001'); set local role authenticated;
select tests.igual('X-09', 'super admin ve todos los tenants',
  $$select count(*)::text from public.tenants$$, '3');
rollback;

-- ── Vistas materializadas (sin RLS) ───────────────────────────

begin;
select tests.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
select tests.debe_fallar('MV-01', 'authenticated no lee mv_dashboard_diario',
  'select count(*) from public.mv_dashboard_diario', '42501');
rollback;

begin;
select tests.como('00000000-0000-0000-0000-000000000001'); set local role authenticated;
select tests.debe_fallar('MV-02', 'ni siquiera super admin (authenticated) lee mv_dashboard_top_empresas',
  'select count(*) from public.mv_dashboard_top_empresas', '42501');
rollback;

begin;
set local role service_role;
select tests.debe_funcionar('MV-03', 'service_role lee mv_dashboard_diario',
  'select count(*) from public.mv_dashboard_diario');
select tests.debe_funcionar('MV-04', 'service_role lee mv_dashboard_top_empresas',
  'select count(*) from public.mv_dashboard_top_empresas');
rollback;

-- ── anon: nada ────────────────────────────────────────────────

begin;
set local role anon;
select tests.debe_fallar('A-01', 'anon no lee tenants', 'select count(*) from public.tenants', '42501');
select tests.debe_fallar('A-02', 'anon no lee user_tenants', 'select count(*) from public.user_tenants', '42501');
select tests.debe_fallar('A-03', 'anon no lee paquetes', 'select count(*) from public.paquetes', '42501');
select tests.debe_fallar('A-04', 'anon no lee v_dashboard_resumen', 'select count(*) from public.v_dashboard_resumen', '42501');
select tests.debe_fallar('A-05', 'anon no lee mv_dashboard_diario', 'select count(*) from public.mv_dashboard_diario', '42501');
rollback;

-- ── Operaciones que la app no usa: denegadas ──────────────────

begin;
select tests.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
select tests.debe_fallar('D-01', 'authenticated no puede TRUNCATE (saltaría RLS)',
  'truncate public.paquetes', '42501');
select tests.debe_fallar('D-02', 'authenticated no borra paquetes (sin DELETE)',
  $$delete from public.paquetes where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, '42501');
select tests.debe_fallar('D-03', 'authenticated no lee audit_log por la API',
  'select count(*) from public.audit_log', '42501');
select tests.debe_fallar('D-04', 'authenticated no escribe catálogos (tamanos_paquete)',
  $$insert into public.tamanos_paquete (tenant_id, clave, nombre) values ('aaaaaaaa-0000-0000-0000-000000000000', 'z', 'Z')$$, '42501');
rollback;

-- ── Escrituras que la app sí usa ──────────────────────────────

begin;
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
select tests.debe_funcionar('W-01', 'guardia: generar_codigo_gateflow() usa codigo_gateflow_seq',
  'select public.generar_codigo_gateflow()');
rollback;

begin;
-- Sin grupo abierto para la unidad, la RPC inserta uno nuevo y el
-- trigger fn_asignar_codigo_grupo toma paquete_grupos_entrega_codigo_seq.
-- PENDIENTE mientras el repo use gen_random_bytes() con
-- search_path = public (en Supabase pgcrypto vive en "extensions"):
-- falla con 42883 igual que en staging. Producción lo corrigió a mano
-- con gen_random_uuid(); la corrección espera aprobación.
delete from public.paquete_grupos_entrega where id = 'a4000000-0000-0000-0000-000000000000';
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
do $$
begin
  perform public.obtener_o_crear_grupo_entrega('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000');
  perform tests.pass('W-02', 'guardia: obtener_o_crear_grupo_entrega inserta grupo (INVOKER + secuencia)');
exception when undefined_function then
  perform tests.pendiente('W-02', 'obtener_o_crear_grupo_entrega: gen_random_bytes no resuelve con search_path = public [42883]');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
select tests.debe_funcionar('W-03', 'admin: alta, edición y baja de ubicación propia',
  $$with i as (insert into public.ubicaciones (tenant_id, nombre, tipo_nodo)
               values ('aaaaaaaa-0000-0000-0000-000000000000', 'Locker T', 'locker') returning id)
    select id from i$$);
select tests.filas('W-04', 'admin: borra la ubicación creada',
  $$delete from public.ubicaciones where nombre = 'Locker T'$$, 1);
select tests.filas('W-05', 'admin: activa/desactiva miembro de su residencial',
  $$update public.user_tenants set activo = activo
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' and user_id = '00000000-0000-0000-0000-0000000000a9'$$, 1);
select tests.filas('W-06', 'usuario: actualiza su propio perfil',
  $$update public.users set nombre_completo = 'Admin A' where id = auth.uid()$$, 1);
select tests.debe_funcionar('W-07', 'admin: registra notificación de su residencial',
  $$insert into public.notificaciones (tenant_id, canal, destinatario_nombre) values ('aaaaaaaa-0000-0000-0000-000000000000', 'whatsapp', 'Residente A')$$);
rollback;

-- ── service_role: solo lo que usan las server actions ─────────

begin;
set local role service_role;
select tests.debe_funcionar('S-01', 'service_role: lee user_tenants (actualizar-nombre-usuario)',
  $$select id from public.user_tenants where user_id = '00000000-0000-0000-0000-0000000000a9'$$);
select tests.filas('S-02', 'service_role: actualiza el nombre de un miembro',
  $$update public.users set nombre_completo = 'Guardia A' where id = '00000000-0000-0000-0000-0000000000a9'$$, 1);
select tests.debe_fallar('S-03', 'service_role no lee paquetes (no lo usa)',
  'select count(*) from public.paquetes', '42501');
select tests.debe_fallar('S-04', 'service_role no puede TRUNCATE',
  'truncate public.user_tenants', '42501');
rollback;

-- ── Registrar paquete: trigger de historial ───────────────────
-- fn_registrar_historial_paquete escribe paquete_historial (sin
-- INSERT para authenticated, a propósito). Antes de la
-- reconciliación es SECURITY INVOKER y falla con 42501; después es
-- SECURITY DEFINER y el registro funciona.
begin;
select tests.como('00000000-0000-0000-0000-0000000000a9'); set local role authenticated;
do $$
declare
  v_definer boolean := (select prosecdef from pg_proc where oid = 'public.fn_registrar_historial_paquete()'::regprocedure);
begin
  insert into public.paquetes (tenant_id, unidad_id, recibido_por)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', auth.uid());
  if v_definer then
    perform tests.pass('K-01', 'guardia registra paquete; el historial lo escribe el trigger DEFINER');
  else
    perform tests.fail('K-01', 'registrar paquete con trigger INVOKER', 'funcionó sin INSERT en paquete_historial');
  end if;
exception when insufficient_privilege then
  if not v_definer and sqlerrm like '%paquete_historial%' then
    perform tests.pendiente('K-01', 'registrar paquete se detiene en paquete_historial (trigger INVOKER) [42501]');
  else
    perform tests.fail('K-01', 'registrar paquete', sqlerrm);
  end if;
end $$;
rollback;
