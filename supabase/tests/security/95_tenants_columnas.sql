-- ============================================================
-- Columnas protegidas de public.tenants
-- (20261008000000_tenants_columnas_protegidas.sql). Solo corre con la
-- migración aplicada (fase P del runner).
--
-- Fixtures: P (1111…) plataforma, A (aaaa…), B (bbbb…). super (…0001)
-- super_admin solo en P; admin_a (…000a) admin_residencial en A;
-- guard_a (…00a9) guardia en A; admin_b (…000b) admin en B.
-- ============================================================

do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then
    raise notice 'INFO|95_tenants_columnas omitido: migración no aplicada';
  end if;
end $$;

-- ── Catálogo ──────────────────────────────────────────────────
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.igual('TC-00a', 'authenticated actualiza solo las 6 columnas que edita la UI del admin_residencial',
    $q$select string_agg(attname, ',' order by attname) from pg_attribute
       where attrelid = 'public.tenants'::regclass and attnum > 0 and not attisdropped
         and has_column_privilege('authenticated', 'public.tenants', attname, 'UPDATE')$q$,
    'configuracion,correo,direccion,nombre,onboarding_completado,telefono');
  perform tests.igual('TC-00b', 'sin UPDATE a nivel de tabla para authenticated',
    $q$select has_table_privilege('authenticated', 'public.tenants', 'UPDATE')::text$q$, 'false');
  perform tests.igual('TC-00c', 'funciones de Super Admin: DEFINER, search_path vacío, EXECUTE solo authenticated',
    $q$select string_agg(p.proname || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-') || ':'
         || has_function_privilege('authenticated', p.oid, 'execute')::text || has_function_privilege('anon', p.oid, 'execute')::text
         || has_function_privilege('service_role', p.oid, 'execute')::text, ',' order by p.proname)
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'superadmin\_%'$q$,
    'superadmin_actualizar_plan_residencial:true:search_path="":truefalsefalse,superadmin_actualizar_residencial:true:search_path="":truefalsefalse,superadmin_cambiar_estado_servicio:true:search_path="":truefalsefalse');
end $$;

-- ── 1–8. admin_residencial ────────────────────────────────────
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.filas('TC-01', 'admin_residencial actualiza nombre, dirección, teléfono, correo, configuración y onboarding de su residencial',
    $q$update public.tenants set nombre = 'A editado', direccion = 'Calle 1', telefono = '555', correo = 'a@test.local',
         configuracion = '{"horarioRecepcion":"9-18"}', onboarding_completado = true
       where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 1);
  perform tests.debe_fallar('TC-02', 'admin_residencial NO cambia pais',
    $q$update public.tenants set pais = 'AR' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-03', 'NO cambia estado_servicio',
    $q$update public.tenants set estado_servicio = 'activo' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-04', 'NO cambia empresa_id',
    $q$update public.tenants set empresa_id = 'e0000000-0000-0000-0000-000000000001' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-05', 'NO cambia plan',
    $q$update public.tenants set plan = 'enterprise' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-06', 'NO cambia plan_precio',
    $q$update public.tenants set plan_precio = 0 where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-07a', 'NO cambia plan_fecha_inicio',
    $q$update public.tenants set plan_fecha_inicio = '2030-01-01' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-07b', 'NO cambia plan_fecha_renovacion',
    $q$update public.tenants set plan_fecha_renovacion = '2030-01-01' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  -- 8. Lo que enviaría PostgREST (PATCH /tenants) con el JWT del admin:
  -- una sola columna protegida hace fallar toda la sentencia.
  perform tests.debe_fallar('TC-08a', 'PATCH mezclando permitida + protegida falla completo',
    $q$update public.tenants set nombre = 'X', estado_servicio = 'activo' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-08b', 'NO cambia id', $q$update public.tenants set id = gen_random_uuid() where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-08c', 'NO cambia created_at', $q$update public.tenants set created_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-08d', 'NO cambia updated_at', $q$update public.tenants set updated_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-08e', 'NO cambia activo', $q$update public.tenants set activo = false where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-08f', 'NO cambia tipo', $q$update public.tenants set tipo = 'residencial' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-08g', 'NO cambia timezone', $q$update public.tenants set timezone = 'UTC' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-08h', 'NO cambia observaciones de Super Admin', $q$update public.tenants set observaciones = 'x' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-08i', 'NO cambia contacto de Super Admin', $q$update public.tenants set admin_contacto_email = 'x@x' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-08j', 'NO cambia ciudad / estado_geografico', $q$update public.tenants set ciudad = 'x', estado_geografico = 'y' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.filas('TC-08k', 'columna permitida en un residencial ajeno → 0 filas (RLS intacta)',
    $q$update public.tenants set nombre = 'Hackeado' where id = 'bbbbbbbb-0000-0000-0000-000000000000'$q$, 0);
  perform tests.debe_fallar('TC-08l', 'admin_residencial no puede usar las funciones de Super Admin',
    $q$select public.superadmin_cambiar_estado_servicio('aaaaaaaa-0000-0000-0000-000000000000', 'activo')$q$, '42501');
  perform tests.debe_fallar('TC-08m', 'ni el plan',
    $q$select public.superadmin_actualizar_plan_residencial('aaaaaaaa-0000-0000-0000-000000000000', 'enterprise', 0, null, null)$q$, '42501');
end $$;
rollback;

-- Ningún intento rechazado dejó rastro (se verifica como postgres).
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.igual('TC-08n', 'el residencial A conserva pais, estado, empresa y plan',
    $q$select pais || '|' || estado_servicio || '|' || empresa_id::text || '|' || plan from public.tenants where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$,
    'MX|piloto|e0000000-0000-0000-0000-000000000001|trial');
end $$;

-- ── 9. guardia ────────────────────────────────────────────────
begin;
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.filas('TC-09a', 'guardia: columna permitida en su residencial → 0 filas (no es admin)',
    $q$update public.tenants set nombre = 'G' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.debe_fallar('TC-09b', 'guardia: columna protegida → rechazado',
    $q$update public.tenants set estado_servicio = 'activo' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('TC-09c', 'guardia: funciones de Super Admin → rechazado',
    $q$select public.superadmin_actualizar_residencial('aaaaaaaa-0000-0000-0000-000000000000', 'G', null, null, null, null, null, null)$q$, '42501');
end $$;
rollback;

-- anon: sin EXECUTE sobre las funciones.
begin;
set local role anon;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.debe_fallar('TC-09d', 'anon no ejecuta las funciones de Super Admin',
    $q$select public.superadmin_cambiar_estado_servicio('aaaaaaaa-0000-0000-0000-000000000000', 'activo')$q$, '42501');
end $$;
rollback;

-- ── 10. super_admin, mediante las funciones ───────────────────
-- super solo tiene membresía en P: las funciones no dependen de ella.
begin;
select tests.como('00000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.debe_fallar('TC-10a', 'super_admin tampoco tiene UPDATE abierto sobre columnas protegidas',
    $q$update public.tenants set estado_servicio = 'activo' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_funcionar('TC-10b', 'super_admin cambia estado_servicio de A',
    $q$select public.superadmin_cambiar_estado_servicio('aaaaaaaa-0000-0000-0000-000000000000', 'activo')$q$);
  perform tests.debe_funcionar('TC-10c', 'super_admin actualiza el plan comercial de A',
    $q$select public.superadmin_actualizar_plan_residencial('aaaaaaaa-0000-0000-0000-000000000000', 'business', 1500, '2026-01-01', '2027-01-01')$q$);
  perform tests.debe_funcionar('TC-10d', 'super_admin actualiza datos generales de A',
    $q$select public.superadmin_actualizar_residencial('aaaaaaaa-0000-0000-0000-000000000000', '  A por SA ', 'Mérida', 'Yucatán', 'Ana', 'ana@test.local', '999', 'nota')$q$);
  perform tests.debe_fallar('TC-10e', 'estado_servicio inválido → rechazado por el CHECK',
    $q$select public.superadmin_cambiar_estado_servicio('aaaaaaaa-0000-0000-0000-000000000000', 'gratis')$q$, '23514');
  perform tests.debe_fallar('TC-10f', 'plan inválido → rechazado por el CHECK',
    $q$select public.superadmin_actualizar_plan_residencial('aaaaaaaa-0000-0000-0000-000000000000', 'gratis', null, null, null)$q$, '23514');
  perform tests.debe_fallar('TC-10g', 'precio negativo → rechazado',
    $q$select public.superadmin_actualizar_plan_residencial('aaaaaaaa-0000-0000-0000-000000000000', 'pro', -1, null, null)$q$, '22023');
  perform tests.debe_fallar('TC-10h', 'nombre vacío → rechazado',
    $q$select public.superadmin_actualizar_residencial('aaaaaaaa-0000-0000-0000-000000000000', '  ', null, null, null, null, null, null)$q$, '22023');
  perform tests.debe_fallar('TC-10i', 'residencial inexistente → rechazado (no "0 filas" silencioso)',
    $q$select public.superadmin_cambiar_estado_servicio('99999999-0000-0000-0000-000000000000', 'activo')$q$, '22023');
  perform tests.debe_fallar('TC-10j', 'tenant_id nulo → rechazado',
    $q$select public.superadmin_cambiar_estado_servicio(null, 'activo')$q$, '22023');
end $$;
reset role;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.igual('TC-10k', 'los cambios de super_admin quedaron aplicados',
    $q$select nombre || '|' || ciudad || '|' || estado_servicio || '|' || plan || '|' || plan_precio::text || '|' || plan_fecha_renovacion::text
       from public.tenants where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$,
    'A por SA|Mérida|activo|business|1500|2027-01-01');
  perform tests.igual('TC-10l', 'auditoría: 3 acciones de super_admin, sin contacto ni observaciones en claro',
    $q$select count(*)::text || '|' || bool_and(user_id = '00000000-0000-0000-0000-000000000001')::text || '|'
         || bool_or(coalesce(datos_nuevos::text, '') like '%ana@test.local%' or coalesce(datos_nuevos::text, '') like '%nota%')::text
       from public.audit_log where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' and accion like 'superadmin.%'$q$,
    '3|true|false');
  perform tests.igual('TC-10m', 'auditoría de datos generales lista las columnas cambiadas',
    $q$select datos_nuevos->>'columnas' from public.audit_log where accion = 'superadmin.residencial_editado' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$,
    '["admin_contacto_email", "admin_contacto_nombre", "admin_contacto_telefono", "ciudad", "estado_geografico", "nombre", "observaciones"]');
end $$;
rollback;

-- ── 11. service_role sin cambios ──────────────────────────────
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.igual('TC-11', 'service_role conserva exactamente sus privilegios sobre tenants (sin columnas nuevas)',
    $q$select (select count(*) from pg_attribute a where a.attrelid = 'public.tenants'::regclass and a.attacl::text like '%service_role%')::text$q$, '0');
end $$;

-- ── 12. residencial suspendido: comportamiento actual ─────────
begin;
update public.tenants set estado_servicio = 'suspendido' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.filas('TC-12a', 'suspendido: admin_residencial no edita ni columnas permitidas (0 filas, igual que antes)',
    $q$update public.tenants set nombre = 'X' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.debe_fallar('TC-12b', 'suspendido: no puede reactivarse a sí mismo',
    $q$update public.tenants set estado_servicio = 'activo' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
end $$;
select tests.como('00000000-0000-0000-0000-000000000001');
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.debe_funcionar('TC-12c', 'super_admin reactiva el residencial suspendido',
    $q$select public.superadmin_cambiar_estado_servicio('aaaaaaaa-0000-0000-0000-000000000000', 'activo')$q$);
end $$;
select tests.como('00000000-0000-0000-0000-00000000000a');
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.filas('TC-12d', 'reactivado: el admin vuelve a editar columnas permitidas',
    $q$update public.tenants set nombre = 'A de nuevo' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 1);
end $$;
rollback;

-- ── 13. trial: el ciclo de vida no cambia ─────────────────────
begin;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
end $$;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.igual('TC-13a', 'trial vencido: tenant_operativo sigue en false', $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'false');
  perform tests.filas('TC-13b', 'trial vencido: el admin no edita (0 filas, igual que antes)',
    $q$update public.tenants set nombre = 'X' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.debe_fallar('TC-13c', 'trial vencido: tampoco puede tocar columnas de plataforma para "reactivarse"',
    $q$update public.tenants set estado_servicio = 'activo', plan = 'enterprise' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
end $$;
reset role;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  update public.suscripciones set trial_ends_at = now() + interval '10 days' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
end $$;
set local role authenticated;
do $$ begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  perform tests.igual('TC-13d', 'trial vigente: tenant_operativo en true', $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'true');
  perform tests.filas('TC-13e', 'trial vigente: el admin edita columnas permitidas',
    $q$update public.tenants set configuracion = '{}' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 1);
end $$;
rollback;

-- ── 14. registro público ──────────────────────────────────────
-- crear_cuenta_prueba (DEFINER, service_role) escribe columnas que el
-- cliente ya no puede tocar: debe seguir funcionando.
begin;
set role supabase_auth_admin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'nuevo_tc@test.local');
reset role;
set local role service_role;
do $$
declare v jsonb;
begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is null then return; end if;
  begin
    v := public.crear_cuenta_prueba('00000000-0000-0000-0000-0000000000c1', 'Residencial TC', 'AR', 40, null, true);
    perform tests.pass('TC-14', 'registro público: crear_cuenta_prueba sigue creando residencial + trial (pais ' ||
      (select t.pais from public.tenants t where t.id = (v->>'tenant_id')::uuid) || ')');
  exception when others then
    perform tests.fail('TC-14', 'registro público: crear_cuenta_prueba', sqlstate || ': ' || sqlerrm);
  end;
end $$;
rollback;
