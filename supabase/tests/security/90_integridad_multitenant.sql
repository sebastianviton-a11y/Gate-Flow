-- ============================================================
-- Integridad referencial multi-tenant
-- (20261007100000_integridad_multitenant.sql). Solo corre con la
-- migración aplicada (fase I del runner).
--
-- Fixtures: A (aaaa…) y B (bbbb…); unidad A a1…, unidad B b1…;
-- ubicación A a2…, B b2…; paquete A a3…, B b3…; grupo A a4…, B b4…;
-- tamaño A a5…, B b5…; calle A a6…. guard_a (…00a9) guardia en A;
-- admin_ab (…00aa) admin en A y en B.
-- ============================================================

do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then
    raise notice 'INFO|90_integridad_multitenant omitido: migración no aplicada';
  end if;
end $$;

-- ── 67. los datos existentes cumplen la regla ─────────────────
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.igual('MT-67', 'ninguna referencia cruzada entre tenants en los datos (las FK compuestas validaron todo)',
    $q$select count(*)::text from pg_constraint where conname like 'fk\_mt\_%' and not convalidated$q$, '0');
  perform tests.igual('MT-67b', '15 FK compuestas y 5 UNIQUE (id, tenant_id)',
    $q$select (select count(*) from pg_constraint where conname like 'fk\_mt\_%')::text || '|' || (select count(*) from pg_constraint where conname like 'uq\_mt\_%')::text$q$, '15|5');
  perform tests.igual('MT-67c', 'las FK originales siguen intactas (mismas acciones de borrado)',
    $q$select string_agg(conname || ':' || confdeltype::text, ',' order by conname) from pg_constraint
       where conname in ('paquetes_unidad_id_fkey','paquetes_grupo_entrega_id_fkey','notificaciones_paquete_id_fkey','incidencias_paquete_id_fkey','ubicaciones_padre_id_fkey')$q$,
    'incidencias_paquete_id_fkey:c,notificaciones_paquete_id_fkey:n,paquetes_grupo_entrega_id_fkey:n,paquetes_unidad_id_fkey:a,ubicaciones_padre_id_fkey:n');
  perform tests.igual('MT-67d', 'funciones de trigger DEFINER, search_path vacío y sin EXECUTE para la API',
    $q$select string_agg(p.proname || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-') || ':'
         || has_function_privilege('authenticated', p.oid, 'execute')::text || has_function_privilege('anon', p.oid, 'execute')::text, ',' order by p.proname)
       from pg_proc p where p.proname in ('fn_mt_catalogos_paquete','fn_mt_casas','fn_mt_departamentos')$q$,
    'fn_mt_casas:true:search_path="":falsefalse,fn_mt_catalogos_paquete:true:search_path="":falsefalse,fn_mt_departamentos:true:search_path="":falsefalse');
end $$;

-- ── 56c / 65. usuario con membresía en A y B no cruza referencias ─
begin;
insert into public.user_tenants (user_id, tenant_id, rol_id)
select '00000000-0000-0000-0000-0000000000a9', 'bbbbbbbb-0000-0000-0000-000000000000', r.id from public.roles r where r.clave = 'guardia';
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_fallar('TO-56c', 'guardia en A y B: paquete de B con unidad de A → RECHAZADO',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '23503');
  perform tests.debe_funcionar('MT-61', 'paquete de A con unidad de A → permitido',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
  perform tests.debe_funcionar('MT-62', 'paquete de B con unidad de B → permitido',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
  perform tests.debe_fallar('MT-65a', 'paquete de B con ubicación de A → rechazado',
    $q$insert into public.paquetes (tenant_id, unidad_id, ubicacion_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '23503');
  perform tests.debe_fallar('MT-65b', 'paquete de B en grupo de entrega de A → rechazado',
    $q$insert into public.paquetes (tenant_id, unidad_id, grupo_entrega_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', 'a4000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '23503');
  perform tests.debe_fallar('MT-65c', 'paquete de B con tamaño propio de A → rechazado',
    $q$insert into public.paquetes (tenant_id, unidad_id, tamano_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', 'a5000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '23503');
  perform tests.debe_funcionar('MT-65d', 'paquete de B con tamaño propio de B → permitido',
    $q$insert into public.paquetes (tenant_id, unidad_id, tamano_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', 'b5000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
  perform tests.debe_fallar('MT-65e', 'incidencia de B sobre paquete de A → rechazada',
    $q$insert into public.incidencias (tenant_id, paquete_id, tipo, reportada_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'otro', '00000000-0000-0000-0000-0000000000a9')$q$, '23503');
  perform tests.debe_fallar('MT-65f', 'notificación de B sobre paquete de A → rechazada',
    $q$insert into public.notificaciones (tenant_id, paquete_id, canal, destinatario_nombre) values ('bbbbbbbb-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'whatsapp', 'X')$q$, '23503');
  perform tests.debe_fallar('MT-65g', 'firma de B sobre paquete de A → rechazada',
    $q$insert into public.paquete_firmas (tenant_id, paquete_id, tipo, firma_data, firmante_nombre) values ('bbbbbbbb-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'entrega_residente', 'd', 'X')$q$, '23503');
  perform tests.debe_fallar('MT-65h', 'fotografía de B sobre paquete de A → rechazada',
    $q$insert into public.paquete_fotografias (tenant_id, paquete_id, tipo, storage_path) values ('bbbbbbbb-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'recepcion', 'x.jpg')$q$, '23503');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_fallar('MT-65i', 'admin de A y B: grupo de entrega de B con unidad de A → rechazado',
    $q$insert into public.paquete_grupos_entrega (tenant_id, unidad_id, token) values ('bbbbbbbb-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'tok-cruzado')$q$, '23503');
  perform tests.debe_fallar('MT-65j', 'admin de A y B: residente de B en unidad de A → rechazado',
    $q$insert into public.residentes_unidades (tenant_id, user_id, unidad_id, tipo_relacion) values ('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000aa', 'a1000000-0000-0000-0000-000000000000', 'propietario')$q$, '23503');
  perform tests.debe_fallar('MT-65k', 'admin de A y B: ubicación de B con padre de A → rechazada',
    $q$insert into public.ubicaciones (tenant_id, nombre, tipo_nodo, padre_id) values ('bbbbbbbb-0000-0000-0000-000000000000', 'Hija', 'estante', 'a2000000-0000-0000-0000-000000000000')$q$, '23503');
  perform tests.debe_funcionar('MT-65l', 'admin de A y B: ubicación de B con padre de B → permitida',
    $q$insert into public.ubicaciones (tenant_id, nombre, tipo_nodo, padre_id) values ('bbbbbbbb-0000-0000-0000-000000000000', 'Hija', 'estante', 'b2000000-0000-0000-0000-000000000000')$q$);
  perform tests.debe_fallar('MT-65m', 'admin de A y B: manzana de B en calle de A → rechazada',
    $q$insert into public.manzanas (tenant_id, numero, calle_id) values ('bbbbbbbb-0000-0000-0000-000000000000', 'M1', 'a6000000-0000-0000-0000-000000000000')$q$, '23503');
  perform tests.debe_fallar('MT-65n', 'admin de A y B: casa de la unidad B en calle de A → rechazada',
    $q$insert into public.casas (unidad_id, calle_id, numero) values ('b1000000-0000-0000-0000-000000000000', 'a6000000-0000-0000-0000-000000000000', '1')$q$, '23503');
  perform tests.debe_funcionar('MT-65o', 'admin de A y B: casa de la unidad A en calle de A → permitida',
    $q$insert into public.casas (unidad_id, calle_id, numero) values ('a1000000-0000-0000-0000-000000000000', 'a6000000-0000-0000-0000-000000000000', '1')$q$);
end $$;
rollback;

-- departamentos: el edificio debe ser del tenant de la unidad.
begin;
insert into public.edificios (id, tenant_id, nombre) values ('b7000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'Torre B');
select tests.como('00000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_fallar('MT-65p', 'departamento de la unidad A en edificio de B → rechazado',
    $q$insert into public.departamentos (unidad_id, edificio_id, numero) values ('a1000000-0000-0000-0000-000000000000', 'b7000000-0000-0000-0000-000000000000', '101')$q$, '23503');
  perform tests.debe_funcionar('MT-65q', 'departamento de la unidad B en edificio de B → permitido',
    $q$insert into public.departamentos (unidad_id, edificio_id, numero) values ('b1000000-0000-0000-0000-000000000000', 'b7000000-0000-0000-0000-000000000000', '101')$q$);
end $$;
rollback;

-- Catálogo global (tenant_id NULL): sigue sirviendo a todos.
begin;
insert into public.tamanos_paquete (id, tenant_id, clave, nombre) values ('99000000-0000-0000-0000-000000000000', null, 'global_test', 'Global');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_funcionar('MT-65r', 'tamaño global (tenant_id NULL) sigue disponible para cualquier tenant',
    $q$insert into public.paquetes (tenant_id, unidad_id, tamano_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '99000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
end $$;
rollback;

-- ── 63. UPDATE a una unidad de otro tenant ────────────────────
begin;
select tests.como('00000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_fallar('MT-63a', 'admin de A y B: mover el paquete de A a la unidad de B → rechazado',
    $q$update public.paquetes set unidad_id = 'b1000000-0000-0000-0000-000000000000' where id = 'a3000000-0000-0000-0000-000000000000'$q$, '23503');
  perform tests.debe_fallar('MT-63b', 'admin de A y B: mover el paquete de A a la ubicación de B → rechazado',
    $q$update public.paquetes set ubicacion_id = 'b2000000-0000-0000-0000-000000000000' where id = 'a3000000-0000-0000-0000-000000000000'$q$, '23503');
  perform tests.debe_fallar('MT-63c', 'admin de A y B: grupo de A a la unidad de B → rechazado',
    $q$update public.paquete_grupos_entrega set unidad_id = 'b1000000-0000-0000-0000-000000000000' where id = 'a4000000-0000-0000-0000-000000000000'$q$, '23503');
end $$;
rollback;

-- ── 64. cambiar tenant_id conservando la unidad de otro tenant ─
begin;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_fallar('MT-64a', 'paquete de A pasado a B con la unidad de A → rechazado (incluso como owner)',
    $q$update public.paquetes set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000' where id = 'a3000000-0000-0000-0000-000000000000'$q$);
  perform tests.debe_fallar('MT-64b', 'incidencia/registro hijo: tenant_id inmutable y FK compuesta',
    $q$update public.paquete_grupos_entrega set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000' where id = 'a4000000-0000-0000-0000-000000000000'$q$);
end $$;
rollback;

-- La FK compuesta por sí sola (sin el trigger de inmutabilidad) también
-- impide el cambio: se desactiva el trigger SOLO dentro de la
-- transacción de prueba (ROLLBACK).
begin;
alter table public.paquete_grupos_entrega disable trigger user;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_fallar('MT-64c', 'sin el trigger de inmutabilidad: la FK compuesta rechaza tenant_id ≠ tenant de la unidad',
    $q$update public.paquete_grupos_entrega set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000' where id = 'a4000000-0000-0000-0000-000000000000'$q$, '23503');
end $$;
rollback;

-- ── 66. service_role (y el owner) tampoco crean inconsistencias ─
begin;
set local role service_role;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_fallar('MT-66a', 'service_role: paquete de B con unidad de A → rechazado',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '23503');
  perform tests.debe_fallar('MT-66b', 'service_role: paquete de B con tamaño de A → rechazado',
    $q$insert into public.paquetes (tenant_id, unidad_id, tamano_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', 'a5000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '23503');
  perform tests.debe_funcionar('MT-66c', 'service_role: paquete de B con unidad de B → permitido',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
end $$;
rollback;

begin;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_fallar('MT-66d', 'owner (postgres): paquete de B con unidad de A → rechazado',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '23503');
end $$;
rollback;

-- Borrados siguen igual (ON DELETE de las FK originales).
begin;
do $$ begin
  if to_regprocedure('public.fn_mt_casas()') is null then return; end if;
  perform tests.debe_funcionar('MT-69a', 'borrar un grupo de entrega deja grupo_entrega_id en NULL en sus paquetes (SET NULL intacto)',
    $q$update public.paquetes set grupo_entrega_id = 'a4000000-0000-0000-0000-000000000000' where id = 'a3000000-0000-0000-0000-000000000000';
       delete from public.paquete_grupos_entrega where id = 'a4000000-0000-0000-0000-000000000000'$q$);
  perform tests.igual('MT-69b', 'el paquete sigue existiendo con grupo NULL',
    $q$select coalesce(grupo_entrega_id::text, 'null') from public.paquetes where id = 'a3000000-0000-0000-0000-000000000000'$q$, 'null');
end $$;
rollback;
