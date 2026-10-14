-- ============================================================
-- Rollback de 20261015000000_documentos_legales_lectura_publica.sql
-- Deja el catálogo como en 20261014000000: sin lectura pública.
--
-- No toca datos (versiones, requisitos ni aceptaciones): solo quita los
-- EXECUTE de anon/authenticated y la función de historial. Las páginas
-- legales vuelven a mostrar el estado "pendiente".
-- ============================================================

revoke execute on function public.documentos_legales_vigentes(text) from anon, authenticated;
revoke execute on function public.documento_legal_publicado(uuid) from anon, authenticated;
drop function public.documentos_legales_historial(text, text);
