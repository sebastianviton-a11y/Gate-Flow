-- ============================================================
-- Ciclo de vida del trial a nivel de datos
-- (20261007000000_tenant_operativo.sql). Solo corre con la migración
-- aplicada (fase O del runner); en las demás fases no emite nada.
--
-- Cada caso cambia la suscripción como postgres dentro de su propia
-- transacción (ROLLBACK al final) y luego actúa como el usuario.
-- Fixtures: A (aaaa…) con admin_a (…000a) y guard_a (…00a9);
-- B (bbbb…) con admin_b/guard_b; mixto (…00ab) admin en A + guardia
-- en B; admin_ab (…00aa) admin en A y B; super (…0001) super_admin en
-- P (1111…); solo (…0099) sin membresía.
-- ============================================================

do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then
    raise notice 'INFO|80_tenant_operativo omitido: migración no aplicada';
  end if;
end $$;

-- Cambia la suscripción de un tenant (solo dentro de la transacción
-- del caso). 'trial_vencido' / 'trial_vigente' / 'sin' son atajos.
create or replace function tests.suscripcion(p_tenant uuid, p_estado text) returns void
language plpgsql as $$
begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  if p_estado = 'sin' then
    delete from public.suscripciones where tenant_id = p_tenant;
  elsif p_estado = 'trial_vencido' then
    update public.suscripciones
    set estado = 'trialing', trial_started_at = now() - interval '31 days', trial_ends_at = now() - interval '1 day'
    where tenant_id = p_tenant;
  elsif p_estado = 'trial_vigente' then
    update public.suscripciones
    set estado = 'trialing', trial_started_at = now() - interval '1 day', trial_ends_at = now() + interval '29 days'
    where tenant_id = p_tenant;
  else
    update public.suscripciones
    set estado = p_estado, trial_started_at = null, trial_ends_at = null
    where tenant_id = p_tenant;
  end if;
end $$;
grant execute on function tests.suscripcion(uuid, text) to postgres;

-- Fin de trial relativo a now() (frontera exacta).
create or replace function tests.fin_trial(p_tenant uuid, p_desde_ahora interval) returns void
language plpgsql as $$
begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  update public.suscripciones
  set estado = 'trialing', trial_started_at = now() - interval '30 days', trial_ends_at = now() + p_desde_ahora
  where tenant_id = p_tenant;
end $$;

-- Huella de los datos operativos de A (para comprobar que nada cambia).
create or replace function tests.huella_a() returns text
language sql as $$
  select md5(string_agg(x, '|' order by x)) from (
    select 'p' || p::text as x from public.paquetes p where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'
    union all select 'u' || u::text from public.unidades u where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'
    union all select 'b' || b::text from public.ubicaciones b where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'
    union all select 'g' || g::text from public.paquete_grupos_entrega g where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'
    union all select 'c' || c::text from public.calles c where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'
    union all select 't' || t::text from public.tenants t where id = 'aaaaaaaa-0000-0000-0000-000000000000'
  ) s;
$$;

-- ── Definición de la función ──────────────────────────────────
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.igual('TO-00a', 'tenant_operativo: DEFINER, search_path vacío, STABLE',
    $q$select prosecdef::text || '|' || coalesce(array_to_string(proconfig, ','), '-') || '|' || provolatile::text from pg_proc where oid = 'public.tenant_operativo(uuid)'::regprocedure$q$,
    'true|search_path=""|s');
  perform tests.igual('TO-00b', 'tenant_operativo: EXECUTE authenticated y service_role; no anon ni PUBLIC',
    $q$select 'anon=' || has_function_privilege('anon', 'public.tenant_operativo(uuid)', 'execute')
         || ',auth=' || has_function_privilege('authenticated', 'public.tenant_operativo(uuid)', 'execute')
         || ',svc=' || has_function_privilege('service_role', 'public.tenant_operativo(uuid)', 'execute')
         || ',public=' || exists (select 1 from aclexplode((select proacl from pg_proc where oid = 'public.tenant_operativo(uuid)'::regprocedure)) a where a.grantee = 0)$q$,
    'anon=false,auth=true,svc=true,public=false');
  perform tests.igual('TO-00c', 'las políticas nuevas son RESTRICTIVAS y solo de escritura',
    $q$select count(*) filter (where permissive = 'RESTRICTIVE' and cmd in ('INSERT','UPDATE','DELETE'))::text || '/' || count(*)::text
       from pg_policies where policyname like '%\_operativo\_%'$q$, '61/61');
  perform tests.igual('TO-00d', 'ninguna política existente cambió de definición (solo se agregan restrictivas)',
    $q$select count(*)::text from pg_policies where permissive = 'RESTRICTIVE' and policyname not like '%\_operativo\_%'$q$, '0');
end $$;

-- ── 32. tenant activo + suscripción active sí opera ───────────
begin;
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.igual('TO-32a', 'active: tenant_operativo(A) = true para el guardia de A',
    $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'true');
  perform tests.debe_funcionar('TO-32b', 'active: el guardia registra un paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
  perform tests.debe_funcionar('TO-32c', 'active: el guardia entrega un paquete (RPC)',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$);
  perform tests.igual('TO-32d', 'tenant_operativo de un tenant ajeno = false (sin fuga de estado)',
    $q$select public.tenant_operativo('bbbbbbbb-0000-0000-0000-000000000000')::text$q$, 'false');
  perform tests.igual('TO-32e', 'tenant_operativo(null) = false',
    $q$select public.tenant_operativo(null)::text$q$, 'false');
end $$;
rollback;

-- ── 33. trial vigente sí opera ────────────────────────────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vigente');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_funcionar('TO-33a', 'trial vigente: el guardia registra un paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
  perform tests.debe_funcionar('TO-33b', 'trial vigente: el guardia entrega (RPC)',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$);
end $$;
rollback;

-- ── 25. trial vencido: ningún INSERT operativo ────────────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.igual('TO-25a', 'trial vencido: tenant_operativo(A) = false',
    $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'false');
  perform tests.debe_fallar('TO-25b', 'trial vencido: guardia no registra paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
  perform tests.debe_fallar('TO-25c', 'trial vencido: guardia no crea incidencia',
    $q$insert into public.incidencias (tenant_id, paquete_id, tipo, reportada_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'otro', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
  perform tests.debe_fallar('TO-25d', 'trial vencido: guardia no sube fotografía de paquete',
    $q$insert into public.paquete_fotografias (tenant_id, paquete_id, tipo, storage_path) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'recepcion', 'x.jpg')$q$, '42501');
  perform tests.debe_fallar('TO-25e', 'trial vencido: guardia no guarda firma',
    $q$insert into public.paquete_firmas (tenant_id, paquete_id, tipo, firma_data, firmante_nombre) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 'entrega_residente', 'data', 'X')$q$, '42501');
  perform tests.debe_fallar('TO-25f', 'trial vencido: guardia no crea notificación',
    $q$insert into public.notificaciones (tenant_id, canal, destinatario_nombre) values ('aaaaaaaa-0000-0000-0000-000000000000', 'whatsapp', 'X')$q$, '42501');
  perform tests.debe_fallar('TO-25g', 'trial vencido: no sube evidencia a storage',
    $q$insert into storage.objects (bucket_id, name) values ('evidencia', 'aaaaaaaa-0000-0000-0000-000000000000/foto.jpg')$q$, '42501');
  perform tests.debe_fallar('TO-25h', 'trial vencido: no crea grupo de entrega (RPC)',
    $q$select public.crear_grupo_entrega_separado('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', null)$q$, '42501');
end $$;
rollback;

begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_fallar('TO-25i', 'trial vencido: admin no crea unidad',
    $q$insert into public.unidades (tenant_id, tipo, identificador) values ('aaaaaaaa-0000-0000-0000-000000000000', 'casa', 'Nueva')$q$, '42501');
  perform tests.debe_fallar('TO-25j', 'trial vencido: admin no crea ubicación',
    $q$insert into public.ubicaciones (tenant_id, nombre, tipo_nodo) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Nueva', 'estante')$q$, '42501');
  perform tests.debe_fallar('TO-25k', 'trial vencido: admin no crea calle',
    $q$insert into public.calles (tenant_id, nombre) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Nueva')$q$, '42501');
  perform tests.debe_fallar('TO-25l', 'trial vencido: admin no sube logo',
    $q$insert into storage.objects (bucket_id, name) values ('logos', 'aaaaaaaa-0000-0000-0000-000000000000/logo.png')$q$, '42501');
  perform tests.debe_fallar('TO-25m', 'trial vencido: admin no crea tamaño de paquete',
    $q$insert into public.tamanos_paquete (tenant_id, clave, nombre) values ('aaaaaaaa-0000-0000-0000-000000000000', 'nuevo', 'Nuevo')$q$, '42501');
end $$;
rollback;

-- ── 26. trial vencido: ningún UPDATE operativo ────────────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.filas('TO-26a', 'trial vencido: admin no edita paquetes',
    $q$update public.paquetes set notas = 'cambio' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.filas('TO-26b', 'trial vencido: admin no edita unidades',
    $q$update public.unidades set identificador = 'X' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.filas('TO-26c', 'trial vencido: admin no edita la configuración del residencial',
    $q$update public.tenants set nombre = 'X' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.filas('TO-26d', 'trial vencido: admin no edita ubicaciones',
    $q$update public.ubicaciones set nombre = 'X' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.filas('TO-26e', 'trial vencido: admin no edita grupos de entrega',
    $q$update public.paquete_grupos_entrega set token = 'x' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.filas('TO-26f', 'trial vencido: admin no edita plantillas',
    $q$update public.plantillas_notificacion set contenido = 'X' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.igual('TO-26g', 'trial vencido: el admin SIGUE LEYENDO los paquetes de A (lecturas no se bloquean)',
    $q$select (count(*) > 0)::text from public.paquetes where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'true');
  perform tests.igual('TO-26h', 'trial vencido: el admin sigue leyendo su suscripción',
    $q$select estado from public.suscripciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'trialing');
end $$;
rollback;

-- ── 27. trial vencido: ningún DELETE operativo ────────────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.filas('TO-27a', 'trial vencido: admin no borra paquetes',
    $q$delete from public.paquetes where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.filas('TO-27b', 'trial vencido: admin no borra ubicaciones',
    $q$delete from public.ubicaciones where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.filas('TO-27c', 'trial vencido: admin no borra grupos de entrega',
    $q$delete from public.paquete_grupos_entrega where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
  perform tests.filas('TO-27d', 'trial vencido: admin no borra calles',
    $q$delete from public.calles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
end $$;
rollback;

-- ── 28. trial vencido: RPC de entrega ─────────────────────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_fallar('TO-28a', 'trial vencido: entregar_paquete falla con error explícito',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$, '42501');
  perform tests.debe_fallar('TO-28b', 'trial vencido: entregar_grupo_paquetes falla',
    $q$select public.entregar_grupo_paquetes('a4000000-0000-0000-0000-000000000000', array['a3000000-0000-0000-0000-000000000000']::uuid[], '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$, '42501');
  perform tests.igual('TO-28c', 'trial vencido: el paquete sigue sin entregar',
    $q$select (estado_id <> 'entregado')::text from public.paquetes where id = 'a3000000-0000-0000-0000-000000000000'$q$, 'true');
end $$;
rollback;

-- ── 29/30. past_due, canceled y expired ───────────────────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'past_due');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_fallar('TO-29a', 'past_due: guardia no registra paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
  perform tests.debe_fallar('TO-29b', 'past_due: guardia no entrega',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$, '42501');
  perform tests.filas('TO-29c', 'past_due: admin/guardia no edita paquetes',
    $q$update public.paquetes set notas = 'x' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
end $$;
rollback;

begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'canceled');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_fallar('TO-30a', 'canceled: guardia no registra paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
  perform tests.debe_fallar('TO-30b', 'canceled: guardia no entrega',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$, '42501');
  perform tests.filas('TO-30c', 'canceled: admin/guardia no edita paquetes',
    $q$update public.paquetes set notas = 'x' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
end $$;
rollback;

begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'expired');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_fallar('TO-30ba', 'expired: guardia no registra paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
  perform tests.debe_fallar('TO-30bb', 'expired: guardia no entrega',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$, '42501');
  perform tests.filas('TO-30bc', 'expired: admin/guardia no edita paquetes',
    $q$update public.paquetes set notas = 'x' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 0);
end $$;
rollback;

-- ── 31. sin suscripción: falla cerrado ────────────────────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'sin');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.igual('TO-31a', 'sin suscripción: tenant_operativo = false',
    $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'false');
  perform tests.debe_fallar('TO-31b', 'sin suscripción: guardia no registra paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
end $$;
rollback;

-- ── 34. super_admin conserva su excepción ─────────────────────
begin;
select tests.suscripcion('11111111-0000-0000-0000-000000000000', 'trial_vencido');
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.igual('TO-34a', 'super_admin: tenant_operativo(A vencido) = true',
    $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'true');
  perform tests.debe_funcionar('TO-34b', 'super_admin: sigue escribiendo en su tenant aunque esté vencido',
    $q$insert into public.ubicaciones (tenant_id, nombre, tipo_nodo) values ('11111111-0000-0000-0000-000000000000', 'Soporte', 'estante')$q$);
  perform tests.igual('TO-34c', 'super_admin: sigue leyendo los paquetes de A vencido',
    $q$select (count(*) > 0)::text from public.paquetes where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'true');
end $$;
rollback;

-- ── 35. service_role no queda roto ────────────────────────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
set local role service_role;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_funcionar('TO-35a', 'service_role escribe en un tenant vencido (procesos internos)',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
  perform tests.filas('TO-35b', 'service_role actualiza en un tenant vencido',
    $q$update public.paquetes set notas = 'interno' where id = 'a3000000-0000-0000-0000-000000000000'$q$, 1);
end $$;
rollback;

-- ── 36. tenant suspendido (suscripción active) ────────────────
begin;
update public.tenants set estado_servicio = 'suspendido' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.igual('TO-36a', 'suspendido + active: tenant_operativo = false',
    $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'false');
  perform tests.debe_fallar('TO-36b', 'suspendido: guardia no registra paquete',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
  perform tests.debe_fallar('TO-36c', 'suspendido: guardia no entrega',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$, '42501');
end $$;
rollback;

-- tenants.estado_servicio = cancelado no se redefine: con suscripción
-- active sigue operando igual que antes de esta migración.
begin;
update public.tenants set estado_servicio = 'cancelado' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_funcionar('TO-36d', 'tenant cancelado + active: comportamiento sin cambios (opera)',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
end $$;
rollback;

-- ── 37. sin bypass moviendo tenant_id ─────────────────────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_funcionar('TO-37a', 'admin de A (vencido) y B (activo): sí opera en B',
    $q$insert into public.ubicaciones (tenant_id, nombre, tipo_nodo) values ('bbbbbbbb-0000-0000-0000-000000000000', 'Nueva B', 'estante')$q$);
  perform tests.debe_fallar('TO-37b', 'no puede insertar en A vencido aunque opere B',
    $q$insert into public.ubicaciones (tenant_id, nombre, tipo_nodo) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Nueva A', 'estante')$q$, '42501');
  perform tests.debe_fallar('TO-37c', 'no puede mover una fila de B (activo) a A (vencido)',
    $q$update public.ubicaciones set tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000' where id = 'b2000000-0000-0000-0000-000000000000'$q$);
  perform tests.filas('TO-37d', 'no puede mover una fila de A (vencido) a B (activo)',
    $q$update public.ubicaciones set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000' where id = 'a2000000-0000-0000-0000-000000000000'$q$, 0);
  perform tests.debe_fallar('TO-37e', 'no puede crear una casa (sin tenant_id) en una unidad de A vencido',
    $q$insert into public.casas (unidad_id, numero) values ('a1000000-0000-0000-0000-000000000000', '1')$q$, '42501');
end $$;
rollback;

begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-0000000000ab');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_funcionar('TO-37f', 'mixto (admin en A vencido, guardia en B activo): opera B',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000ab')$q$);
  perform tests.debe_fallar('TO-37g', 'mixto: no opera A vencido',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000ab')$q$, '42501');
end $$;
rollback;

-- ── 38. vencer no modifica datos ──────────────────────────────
begin;
create temp table huella_antes on commit drop as select tests.huella_a() as h;
grant select on huella_antes to authenticated;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  begin update public.paquetes set notas = 'x' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'; exception when others then null; end;
  begin delete from public.unidades where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'; exception when others then null; end;
  begin update public.tenants set nombre = 'x' where id = 'aaaaaaaa-0000-0000-0000-000000000000'; exception when others then null; end;
end $$;
reset role;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.igual('TO-38', 'vencer + intentos de escritura: los datos de A quedan idénticos',
    $q$select (tests.huella_a() = (select h from huella_antes))::text$q$, 'true');
end $$;
rollback;

-- ── 39. reactivar vuelve a permitir operar ────────────────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_fallar('TO-39a', 'vencido: no entrega',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$, '42501');
end $$;
reset role;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'active');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_funcionar('TO-39b', 'reactivado (active): entrega el MISMO paquete que existía',
    $q$select public.entregar_paquete('a3000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'Vecino')$q$);
  perform tests.igual('TO-39c', 'reactivado: el paquete conserva su id y queda entregado',
    $q$select estado_id from public.paquetes where id = 'a3000000-0000-0000-0000-000000000000'$q$, 'entregado');
end $$;
rollback;

-- ── 22. frontera exacta en la base ────────────────────────────
begin;
select tests.fin_trial('aaaaaaaa-0000-0000-0000-000000000000', interval '0');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.igual('TO-22a', 'frontera: now() = trial_ends_at → no operativo',
    $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'false');
end $$;
reset role;
select tests.fin_trial('aaaaaaaa-0000-0000-0000-000000000000', interval '1 millisecond');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.igual('TO-22b', 'frontera: 1 ms antes del fin → operativo',
    $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text$q$, 'true');
end $$;
rollback;

-- ── Lo que queda fuera a propósito sigue funcionando ──────────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.filas('TO-40a', 'vencido: el admin todavía puede desactivar a un guardia (revocar acceso)',
    $q$update public.user_tenants set activo = false where user_id = '00000000-0000-0000-0000-0000000000a9' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 1);
  perform tests.filas('TO-40b', 'vencido: el admin edita su propio perfil',
    $q$update public.users set nombre_completo = 'Admin A' where id = '00000000-0000-0000-0000-00000000000a'$q$, 1);
end $$;
rollback;

-- ── 50. tenant_operativo evalúa exactamente p_tenant_id ───────
begin;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.igual('TO-50a', 'admin de A y B: tenant_operativo(A vencido) = false y (B active) = true, en la misma sesión',
    $q$select public.tenant_operativo('aaaaaaaa-0000-0000-0000-000000000000')::text || '|' || public.tenant_operativo('bbbbbbbb-0000-0000-0000-000000000000')::text$q$, 'false|true');
  perform tests.igual('TO-50b', 'tenant inexistente o ajeno → false',
    $q$select public.tenant_operativo('cccccccc-0000-0000-0000-000000000000')::text || '|' || public.tenant_operativo('11111111-0000-0000-0000-000000000000')::text$q$, 'false|false');
end $$;
rollback;

-- ── 56. el mismo guardia en dos residenciales activos ─────────
begin;
insert into public.user_tenants (user_id, tenant_id, rol_id)
select '00000000-0000-0000-0000-0000000000a9', 'bbbbbbbb-0000-0000-0000-000000000000', r.id from public.roles r where r.clave = 'guardia';
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_funcionar('TO-56a', 'guardia en A y B (activos): registra en A',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
  perform tests.debe_funcionar('TO-56b', 'guardia en A y B (activos): registra en B',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
end $$;
reset role;
select tests.suscripcion('aaaaaaaa-0000-0000-0000-000000000000', 'trial_vencido');
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regprocedure('public.tenant_operativo(uuid)') is null then return; end if;
  perform tests.debe_fallar('TO-56d', 'A vence: el guardia ya no registra en A',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
  perform tests.debe_funcionar('TO-56e', 'A vence: el guardia sigue registrando en B',
    $q$insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9')$q$);
end $$;
rollback;
