-- ============================================================
-- Rollback de 20261014000000_documentos_legales.sql
-- Deja el catálogo como en 20261013000000.
--
-- Aborta sin cambiar nada si ya hay alguna versión de un documento,
-- algún requisito o alguna aceptación: revertir destruiría documentos
-- o evidencia legal. En ese caso se restaura el respaldo.
-- Sin datos, solo se descarta el catálogo fijo de cuatro documentos.
-- La auditoría que hubiera (altas y bajas de requisitos o borradores
-- ya borrados) se conserva.
-- ============================================================

do $$
declare
  v_versiones bigint;
  v_requisitos bigint;
  v_aceptaciones bigint;
begin
  select count(*) into v_versiones from public.documentos_legales_versiones;
  select count(*) into v_requisitos from public.requisitos_legales;
  select count(*) into v_aceptaciones from public.aceptaciones_legales;
  if v_versiones + v_requisitos + v_aceptaciones > 0 then
    raise exception 'rollback 20261014000000 abortado: % versiones, % requisitos y % aceptaciones. No se destruyen documentos ni evidencia: restaurar el respaldo en lugar de revertir.',
      v_versiones, v_requisitos, v_aceptaciones;
  end if;
end $$;

drop function public.descartar_aceptaciones_alta_fallida(uuid, uuid);
drop function public.registrar_aceptaciones(uuid, uuid[], text, boolean);
drop function public.documentos_pendientes(uuid);
drop function public.documento_legal_publicado(uuid);
drop function public.documentos_legales_vigentes(text);

drop table public.aceptaciones_legales;
drop table public.requisitos_legales;
drop table public.documentos_legales_versiones;
drop table public.documentos_legales;

drop function public.aceptaciones_legales_guardia();
drop function public.requisitos_legales_auditar();
drop function public.documentos_legales_versiones_auditar();
drop function public.documentos_legales_versiones_guardia();
drop function public.documentos_legales_catalogo_guardia();
drop function public.documentos_legales_impedir_truncate();
