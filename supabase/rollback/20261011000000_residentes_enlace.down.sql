-- ============================================================
-- Rollback de 20261011000000_residentes_enlace.sql
-- Deja el catálogo como en 20261009000000.
--
-- Aborta sin cambiar nada si la función ya se usó con datos de
-- personas: solicitudes recibidas, residentes sin cuenta, viviendas sin
-- tipo (creadas al aprobar) o paquetes con el destinatario registrado.
-- Volver atrás borraría esos datos o obligaría a inventar un tipo: en
-- ese caso se restaura el respaldo.
-- Los enlaces no tienen datos personales: se descartan.
-- ============================================================

do $$
declare
  v_solicitudes bigint;
  v_residentes bigint;
  v_sin_tipo bigint;
  v_paquetes bigint;
begin
  select count(*) into v_solicitudes from public.residentes_solicitudes;
  select count(*) into v_residentes from public.residentes_unidades where user_id is null;
  select count(*) into v_sin_tipo from public.unidades where tipo is null;
  select count(*) into v_paquetes from public.paquetes
   where destinatario_nombre is not null or destinatario_telefono is not null or destinatario_residente_id is not null;
  if v_solicitudes + v_residentes + v_sin_tipo + v_paquetes > 0 then
    raise exception 'rollback 20261011000000 abortado: % solicitudes, % residentes sin cuenta, % viviendas sin tipo y % paquetes con destinatario. Restaurar el respaldo en lugar de revertir.',
      v_solicitudes, v_residentes, v_sin_tipo, v_paquetes;
  end if;
end $$;

drop trigger trg_paquetes_destinatario_vivienda on public.paquetes;
drop function public.fn_residente_paquete_destinatario();
drop index public.idx_paquetes_destinatario_residente;
alter table public.paquetes
  drop constraint chk_paquete_destinatario_telefono,
  drop constraint chk_paquete_destinatario_nombre,
  drop column destinatario_residente_id,
  drop column destinatario_telefono,
  drop column destinatario_nombre;

drop function public.residentes_adicional_quitar(uuid);
drop function public.residentes_adicional_actualizar(uuid, text, text, text);
drop function public.residentes_solicitud_rechazar(uuid, text);
drop function public.residentes_solicitud_aprobar(uuid, text, text, text, text, uuid, boolean);
drop function public.residentes_solicitudes_revision(uuid);
drop function public.residentes_enlace_desactivar(uuid);
drop function public.residentes_enlace_generar(uuid);
drop function public.fn_residentes_exigir_admin(uuid);
drop function public.residentes_solicitud_crear(text, text, text, text, text, text);
drop function public.residentes_enlace_publico(text);
drop function public.fn_residente_coincidencias(uuid, text, text, text, text, text, uuid);
drop function public.fn_tenant_servicio_vigente(uuid);
drop function public.fn_direccion_clave(text);
drop function public.fn_telefono_canonico(text, text);
drop function public.fn_residente_telefono_valido(text, text);
drop function public.fn_residente_direccion_valida(text);
drop function public.fn_residente_nombre_valido(text);
drop function public.fn_residente_texto_limpio(text);

alter table public.residentes_unidades drop constraint fk_residentes_unidades_solicitud;
drop table public.residentes_solicitudes;
drop table public.residentes_enlaces;

drop index public.idx_residentes_unidades_tenant_telefono;
drop index public.uq_residentes_unidades_unidad_telefono;
alter table public.residentes_unidades
  drop constraint chk_residente_telefono,
  drop constraint chk_residente_apellido,
  drop constraint chk_residente_nombre,
  drop constraint chk_residente_identidad,
  drop constraint chk_residente_origen,
  drop column solicitud_id,
  drop column origen,
  drop column telefono,
  drop column apellido,
  drop column nombre,
  alter column tipo_relacion set not null,
  alter column user_id set not null;

comment on column public.unidades.tipo is null;
alter table public.unidades alter column tipo set not null;
