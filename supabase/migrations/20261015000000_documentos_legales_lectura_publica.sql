-- ============================================================
-- 20261015000000_documentos_legales_lectura_publica.sql
--
-- Fase 2 de la implementación legal (docs/operations/LEGAL.md): lectura
-- PÚBLICA y controlada de los documentos ya publicados, para las páginas
-- /terminos, /privacidad y /acuerdo-datos de Admin (accesibles sin
-- sesión: se enlazan desde /registro, /aceptar-invitacion y la landing).
--
-- Qué cambia (y solo esto):
--   * Nueva función documentos_legales_historial(clave, país): las
--     versiones PUBLICADAS o RETIRADAS de un documento para un país, sin
--     su texto, con su situación calculada en el servidor (vigente,
--     programada, anterior o retirada). El navegador nunca decide cuál
--     está vigente.
--   * EXECUTE para anon y authenticated en las tres lecturas de
--     documentos publicados: documentos_legales_vigentes(país),
--     documento_legal_publicado(version_id) y la nueva de historial.
--     Justificación: el texto legal publicado es público por naturaleza
--     y las páginas deben leerse sin iniciar sesión. Las tres son
--     SECURITY DEFINER de solo lectura y solo devuelven versiones con
--     publicado_en (nunca un borrador ni un aprobado sin publicar), ni
--     quién aprobó, ni nada de aceptaciones, usuarios o residenciales.
--
-- Qué NO cambia: ninguna tabla, columna, política ni trigger; las
-- cuatro tablas legales siguen sin ningún privilegio para la API;
-- documentos_pendientes, registrar_aceptaciones y
-- descartar_aceptaciones_alta_fallida siguen sin EXECUTE para nadie;
-- service_role no recibe nada.
-- Rollback: supabase/rollback/20261015000000_documentos_legales_lectura_publica.down.sql
-- ============================================================

-- Versiones publicadas o retiradas de un documento para un país (sin el
-- texto: el texto de cada una se lee con documento_legal_publicado).
--   vigente     la publicada más reciente ya en vigor (la misma que
--               devuelve documentos_legales_vigentes)
--   programada  publicada con vigencia futura
--   anterior    publicada, reemplazada por una posterior
--   retirada    retirada (también si se retiró antes de entrar en vigor)
create function public.documentos_legales_historial(p_clave text, p_pais text)
returns table (
  version_id uuid,
  version text,
  jurisdiccion text,
  estado text,
  situacion text,
  vigente_desde timestamptz,
  publicado_en timestamptz,
  retirado_en timestamptz,
  resumen_cambios text,
  contenido_sha256 text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_vigente uuid;
begin
  if p_pais is null or p_pais not in ('MX', 'AR') then
    raise exception 'documentos_legales_historial: país no válido' using errcode = '22023';
  end if;
  if p_clave is null or not exists (select 1 from public.documentos_legales d where d.clave = p_clave) then
    raise exception 'documentos_legales_historial: documento no válido' using errcode = '22023';
  end if;

  select v.id into v_vigente
  from public.documentos_legales_versiones v
  where v.documento_clave = p_clave and v.jurisdiccion = p_pais
    and v.estado = 'publicado' and v.vigente_desde <= now()
  order by v.vigente_desde desc, v.publicado_en desc
  limit 1;

  return query
  select v.id, v.version, v.jurisdiccion, v.estado,
         case
           when v.id = v_vigente then 'vigente'
           when v.estado = 'retirado' then 'retirada'
           when v.vigente_desde > now() then 'programada'
           else 'anterior'
         end,
         v.vigente_desde, v.publicado_en, v.retirado_en, v.resumen_cambios, v.contenido_sha256
  from public.documentos_legales_versiones v
  where v.documento_clave = p_clave and v.jurisdiccion = p_pais
    and v.estado in ('publicado', 'retirado') and v.publicado_en is not null
  order by v.vigente_desde desc, v.publicado_en desc;
end;
$$;

revoke execute on function public.documentos_legales_historial(text, text) from public, anon, authenticated, service_role;

-- Lectura pública controlada: solo las tres funciones de documentos
-- publicados. Las tablas siguen cerradas.
grant execute on function public.documentos_legales_vigentes(text) to anon, authenticated;
grant execute on function public.documento_legal_publicado(uuid) to anon, authenticated;
grant execute on function public.documentos_legales_historial(text, text) to anon, authenticated;
