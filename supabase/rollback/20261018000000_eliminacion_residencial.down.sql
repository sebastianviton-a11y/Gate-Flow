-- Rollback de 20261018000000_eliminacion_residencial.sql.
-- Aborta si ya hay eliminaciones registradas: ese registro es la
-- auditoría de borrados reales y no se descarta con un rollback.
begin;

do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.eliminaciones_residencial;
  if v_n > 0 then
    raise exception 'rollback abortado: hay % eliminaciones registradas en public.eliminaciones_residencial', v_n;
  end if;
end $$;

drop function public.eliminacion_residencial_completar(uuid);
drop function public.eliminacion_residencial_ejecutar(uuid, text, text);
drop function public.eliminacion_residencial_simular(uuid, text);
drop function public.eliminacion_residencial_archivos(uuid);
drop function public.eliminacion_residencial_cuenta_referenciada(uuid);
drop function public.eliminacion_residencial_cuentas(uuid);
drop function public.eliminacion_residencial_conteo(uuid);
drop function public.eliminacion_residencial_servicio(uuid);
drop table public.eliminaciones_residencial;

commit;
