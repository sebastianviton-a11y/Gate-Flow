-- Verificación posterior a las migraciones sobre datos con forma de
-- producción. Cada caso: NOTICE PASS|id|desc o FAIL|id|desc|detalle.
\set ON_ERROR_STOP 0
create or replace function pg_temp.ok(p_id text, p_cond boolean, p_desc text, p_det text default '') returns void language plpgsql as $$
begin
  if p_cond then raise notice 'PASS|%|%', p_id, p_desc; else raise notice 'FAIL|%|%|%', p_id, p_desc, p_det; end if;
end $$;
grant execute on function pg_temp.ok(text, boolean, text, text) to public;

-- D1: backfill de suscripciones para los residenciales existentes
select pg_temp.ok('D1', (select count(*) from public.suscripciones s join public.tenants t on t.id = s.tenant_id where t.nombre like 'ZZ %' and s.estado = 'active' and s.origen = 'alta_manual' and s.trial_ends_at is null and s.provider is null) = 3,
  'los 3 residenciales existentes quedan active + alta_manual, sin prueba ni proveedor',
  (select string_agg(estado || '/' || origen, ',') from public.suscripciones));
-- D2: siguen operativos (incluido el que tenía plan "trial")
create or replace function pg_temp.operativo_como(p_user uuid, p_tenant uuid) returns boolean language plpgsql as $$
declare r boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  r := public.tenant_operativo(p_tenant);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
select pg_temp.ok('D2', pg_temp.operativo_como('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a')
  and pg_temp.operativo_como('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000b')
  and pg_temp.operativo_como('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000c')
  and pg_temp.operativo_como('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000a'),
  'tenant_operativo = true para cada admin y el guardia en su residencial (también el de plan "trial")');
-- D3: país y plan intactos
select pg_temp.ok('D3', (select count(*) from public.tenants where nombre like 'ZZ %' and pais = 'MX') = 3 and (select count(*) from public.tenants where plan = 'trial') = 1, 'país MX y plan sin cambios');

-- Comportamiento con roles reales (como PostgREST: rol authenticated + JWT)
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select pg_temp.ok('D4', (select count(*) from public.paquetes) = 30, 'admin A ve solo sus 30 paquetes', (select count(*)::text from public.paquetes));
select pg_temp.ok('D5', (select count(*) from public.tenants) = 1, 'admin A ve solo su residencial');
select pg_temp.ok('D6', (select count(*) from public.suscripciones) = 1, 'admin A ve solo su suscripción');
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  insert into public.unidades (tenant_id, tipo, identificador) values ('a0000000-0000-4000-8000-00000000000a', 'casa', 'ZZ-NUEVA');
  perform pg_temp.ok('D7', true, 'admin A puede dar de alta una unidad en su residencial');
exception when others then perform pg_temp.ok('D7', false, 'admin A puede dar de alta una unidad en su residencial', sqlstate || ' ' || sqlerrm);
end $$;
do $$ begin
  insert into public.unidades (tenant_id, tipo, identificador) values ('a0000000-0000-4000-8000-00000000000b', 'casa', 'ZZ-AJENA');
  perform pg_temp.ok('D8', false, 'admin A NO puede escribir en el residencial B', 'se insertó');
exception when others then perform pg_temp.ok('D8', true, 'admin A NO puede escribir en el residencial B [' || sqlstate || ']');
end $$;
rollback;

-- Guardia de A: registra un paquete, lo agrupa y lo entrega
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$
declare v_paq uuid; v_uni uuid; v_grp uuid;
begin
  select id into v_uni from public.unidades where tenant_id = 'a0000000-0000-4000-8000-00000000000a' order by identificador limit 1;
  insert into public.paquetes (tenant_id, unidad_id, recibido_por, remitente, ubicacion_id)
  values ('a0000000-0000-4000-8000-00000000000a', v_uni, 'b0000000-0000-4000-8000-000000000004', 'ZZ post',
          (select id from public.ubicaciones where tenant_id = 'a0000000-0000-4000-8000-00000000000a' order by nombre limit 1)) returning id into v_paq;
  v_grp := public.obtener_o_crear_grupo_entrega('a0000000-0000-4000-8000-00000000000a', v_uni, null);
  update public.paquetes set grupo_entrega_id = v_grp where id = v_paq;
  perform public.entregar_paquete(v_paq, 'b0000000-0000-4000-8000-000000000004', 'ZZ Recibe');
  perform pg_temp.ok('D9', (select estado_id from public.paquetes where id = v_paq) = 'entregado'
    and (select count(*) from public.paquete_historial where paquete_id = v_paq) = 2,
    'guardia A registra, agrupa y entrega un paquete (historial 2 filas)');
exception when others then perform pg_temp.ok('D9', false, 'guardia A registra, agrupa y entrega un paquete', sqlstate || ' ' || sqlerrm);
end $$;
do $$ begin
  perform public.registrar_paquete_con_incidencia('a0000000-0000-4000-8000-00000000000a',
    (select id from public.unidades where tenant_id = 'a0000000-0000-4000-8000-00000000000a' order by identificador limit 1),
    null, 'ZZ', null, null, null, null, (select id from public.ubicaciones where tenant_id = 'a0000000-0000-4000-8000-00000000000a' order by nombre limit 1),
    null, 'b0000000-0000-4000-8000-000000000004', 'golpeado', 'sintética', 'leve');
  perform pg_temp.ok('D10', true, 'guardia A registra un paquete con incidencia (RPC de producción)');
exception when others then perform pg_temp.ok('D10', false, 'guardia A registra un paquete con incidencia', sqlstate || ' ' || sqlerrm);
end $$;
rollback;

-- Super admin ve todos los residenciales
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
select pg_temp.ok('D11', (select count(*) from public.tenants where nombre like 'ZZ %') = 3, 'super_admin ve los 3 residenciales');
rollback;

-- anon no lee nada de negocio
begin;
set local role anon;
do $$ begin
  perform 1 from public.paquetes limit 1;
  perform pg_temp.ok('D12', (select count(*) from public.paquetes) = 0, 'anon no ve paquetes');
exception when others then perform pg_temp.ok('D12', true, 'anon no puede leer paquetes [' || sqlstate || ']');
end $$;
rollback;

-- D13–D15: alta autónoma de prueba (registro) tras las migraciones: 30 días,
-- sin proveedor de cobro, admin del residencial nuevo y nada más.
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-4000-8000-0000000000e1', 'zz.alta.prueba@gateflow.invalid', '{"nombre_completo":"ZZ Alta Prueba"}');
set local role service_role;
create temp table _alta on commit drop as
  select public.crear_cuenta_prueba('c0000000-0000-4000-8000-0000000000e1', 'ZZ Residencial Alta', 'MX', 40, 'America/Mexico_City', true) as r;
reset role;
select pg_temp.ok('D13',
  (select count(*) from public.suscripciones s where s.tenant_id = ((select r from _alta)->>'tenant_id')::uuid
     and s.estado = 'trialing' and s.origen = 'registro_publico' and s.provider is null
     and s.trial_ends_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour') = 1
  and (select count(*) from public.user_tenants ut join public.roles r on r.id = ut.rol_id
         where ut.user_id = 'c0000000-0000-4000-8000-0000000000e1' and ut.activo and r.clave = 'admin_residencial') = 1
  and (select count(*) from public.user_tenants where user_id = 'c0000000-0000-4000-8000-0000000000e1') = 1
  and (select onboarding_completado from public.tenants where id = ((select r from _alta)->>'tenant_id')::uuid) = false,
  'registro: prueba de 30 días sin proveedor de cobro, solo admin de su residencial, onboarding pendiente');
select pg_temp.ok('D14', pg_temp.operativo_como('c0000000-0000-4000-8000-0000000000e1', ((select r from _alta)->>'tenant_id')::uuid)
  and not pg_temp.operativo_como('c0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-00000000000a'),
  'el residencial nuevo opera durante la prueba y su admin no opera en otro residencial');
update public.suscripciones set trial_started_at = now() - interval '31 days', trial_ends_at = now() - interval '1 day'
  where tenant_id = ((select r from _alta)->>'tenant_id')::uuid;
select pg_temp.ok('D15', not pg_temp.operativo_como('c0000000-0000-4000-8000-0000000000e1', ((select r from _alta)->>'tenant_id')::uuid)
  and (select count(*) from public.tenants where id = ((select r from _alta)->>'tenant_id')::uuid) = 1
  and (select estado from public.suscripciones where tenant_id = ((select r from _alta)->>'tenant_id')::uuid) = 'trialing'
  and (select provider from public.suscripciones where tenant_id = ((select r from _alta)->>'tenant_id')::uuid) is null,
  'al vencer la prueba deja de operar, conserva el residencial y no pasa a cobro (sigue sin proveedor)');
rollback;

-- D16: un admin no puede usar las acciones de Super Admin ni generar el enlace de residentes de otro residencial
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare v_ok_super boolean := false; v_ok_ajeno boolean := false; v_ok_propio boolean := false;
begin
  begin perform public.superadmin_extender_trial('a0000000-0000-4000-8000-00000000000a', (current_date + 60));
  exception when others then v_ok_super := true; end;
  begin perform public.residentes_enlace_generar('a0000000-0000-4000-8000-00000000000b');
  exception when others then v_ok_ajeno := true; end;
  begin perform public.residentes_enlace_generar('a0000000-0000-4000-8000-00000000000a'); v_ok_propio := true;
  exception when others then v_ok_propio := false; end;
  perform pg_temp.ok('D16', v_ok_super and v_ok_ajeno and v_ok_propio,
    'admin A: sin acciones de Super Admin, sin enlace de residentes de B, con enlace del suyo',
    format('super=%s ajeno=%s propio=%s', v_ok_super, v_ok_ajeno, v_ok_propio));
end $$;
rollback;

-- D17: documentos legales: la migración no publica nada; anon solo lee lo publicado (hoy, nada)
begin;
set local role anon;
select pg_temp.ok('D17', (select count(*) from public.documentos_legales_vigentes('MX')) = 0
  and (select count(*) from public.documentos_legales_vigentes('AR')) = 0,
  'sin documentos legales publicados tras migrar (las páginas muestran «pendiente»)');
rollback;
select pg_temp.ok('D18', (select count(*) from public.documentos_legales_versiones) = 0 and (select count(*) from public.aceptaciones_legales) = 0,
  'ninguna versión ni aceptación legal se crea sola');
