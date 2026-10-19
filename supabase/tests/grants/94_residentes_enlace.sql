-- ============================================================
-- Residentes por enlace (20261011) con los grants de staging: nadie
-- escribe las tablas de residentes directo; la revisión pasa solo por
-- las funciones, que validan el rol en el residencial. Los casos
-- completos están en tests/security/94_residentes_enlace.sql.
-- ============================================================

do $$
begin
  if to_regclass('public.residentes_solicitudes') is null then
    raise notice 'INFO|94_residentes_enlace (grants) omitido: migración no aplicada';
  end if;
end $$;

begin;
do $$ begin
  if to_regclass('public.residentes_solicitudes') is null then return; end if;
  execute $q$insert into public.residentes_unidades (id, tenant_id, unidad_id, origen, nombre, apellido, telefono)
    values ('ec100000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000',
            'enlace', 'Zz', 'Aprobada', '529981119100')$q$;
end $$;

-- Guardia de A.
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
do $$ begin
  if to_regclass('public.residentes_solicitudes') is null then return; end if;
  perform tests.igual('GR-01', 'staging: el guardia ve a la persona aprobada (destinataria) de su residencial',
    $q$select count(*)::text from public.residentes_unidades where origen = 'enlace'$q$, '1');
  perform tests.debe_fallar('GR-02', 'staging: el guardia no modifica residentes escribiendo la tabla',
    $q$update public.residentes_unidades set nombre = 'Otro' where id = 'ec100000-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('GR-03', 'staging: el guardia no agrega residentes escribiendo la tabla',
    $q$insert into public.residentes_unidades (tenant_id, unidad_id, origen, nombre, apellido, telefono)
       values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'enlace', 'Zz', 'Nueva', '529981119101')$q$, '42501');
  perform tests.debe_fallar('GR-04', 'staging: el guardia no borra residentes',
    $q$delete from public.residentes_unidades where id = 'ec100000-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('GR-05', 'staging: el guardia no crea solicitudes ni enlaces',
    $q$insert into public.residentes_enlaces (tenant_id, token) values ('aaaaaaaa-0000-0000-0000-000000000000', repeat('f', 64))$q$, '42501');
  perform tests.debe_fallar('GR-06', 'staging: el guardia no ve la revisión (la función valida el rol)',
    $q$select public.residentes_solicitudes_revision('aaaaaaaa-0000-0000-0000-000000000000')$q$, '42501');
end $$;
reset role;

-- Admin de A: también solo por funciones.
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  if to_regclass('public.residentes_solicitudes') is null then return; end if;
  perform tests.debe_fallar('GR-07', 'staging: el admin no escribe residentes_unidades directo (usa las funciones)',
    $q$update public.residentes_unidades set nombre = 'Otro' where id = 'ec100000-0000-0000-0000-000000000000'$q$, '42501');
  perform tests.debe_fallar('GR-08', 'staging: el admin no escribe solicitudes directo',
    $q$insert into public.residentes_solicitudes (tenant_id, enlace_id, nombre, apellido, direccion, telefono)
       values ('aaaaaaaa-0000-0000-0000-000000000000', gen_random_uuid(), 'Zz', 'X', 'Casa', '529981119102')$q$, '42501');
  perform tests.debe_fallar('GR-09', 'staging: anon/authenticated no llaman la función pública de envío',
    $q$select public.residentes_solicitud_crear(repeat('f', 64), 'Zz', 'X', 'Casa', '529981119102', null)$q$, '42501');
end $$;
reset role;
rollback;
