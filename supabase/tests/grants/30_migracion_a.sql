-- ============================================================
-- Migración A (privilegios fase A) sobre los grants de mínimo
-- privilegio. Solo corre si otorgar_membresia existe; antes de A no
-- reporta nada.
-- ============================================================

do $$
begin
  if to_regprocedure('public.otorgar_membresia(uuid,uuid,text,uuid)') is null then
    raise notice 'INFO|30_migracion_a omitida: la migración A no está aplicada';
  end if;
end $$;

begin;
set local role service_role;
do $$
begin
  if to_regprocedure('public.otorgar_membresia(uuid,uuid,text,uuid)') is null then return; end if;
  perform tests.igual('GA-01', 'service_role: otorgar_membresia crea la membresía (invitación de admin A)',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
                                       'guardia', '00000000-0000-0000-0000-00000000000a')$q$, 'creada');
  perform tests.igual('GA-02', 'service_role: la membresía queda con rol guardia',
    $q$select r.clave from public.user_tenants ut join public.roles r on r.id = ut.rol_id
       where ut.user_id = '00000000-0000-0000-0000-000000000099'$q$, 'guardia');
  perform tests.debe_fallar('GA-03', 'service_role sigue sin leer paquetes',
    'select count(*) from public.paquetes', '42501');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
do $$
begin
  if to_regprocedure('public.otorgar_membresia(uuid,uuid,text,uuid)') is null then return; end if;
  perform tests.debe_fallar('GA-04', 'authenticated no ejecuta otorgar_membresia',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
                                       'guardia', auth.uid())$q$, '42501');
  perform tests.debe_fallar('GA-05', 'admin A no cambia el rol de una membresía (solo activo)',
    $q$update public.user_tenants set rol_id = rol_id where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, '42501');
end $$;
rollback;
