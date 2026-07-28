-- ============================================================
-- 20260729000000_incidencias_historial.sql
--
-- Verificado antes de escribir esto (no supuesto): incidencias ya
-- se relaciona correctamente con paquetes via paquete_id (FK real),
-- incidencia_fotografias ya existe con su propia RLS via join a
-- incidencias, y el bucket privado "evidencia" ya existe. Solo hacen
-- falta 2 cosas reales, ambas aditivas -- no se toca ni se duplica
-- nada de lo que ya existe.
-- ============================================================

-- 1. Campo que pedia la especificacion y no existia: comentario al
--    resolver una incidencia (distinto de la descripcion original).
alter table public.incidencias add column comentario_resolucion text;

-- 2. incidencia_fotografias.incidencia_id y incidencias.paquete_id son
--    llaves foraneas -- Postgres NO las indexa automaticamente (solo
--    indexa las primary keys). Sin este indice, contar incidencias
--    por paquete en la pantalla de Buscar paquete (punto 9: "no hacer
--    una consulta independiente por cada paquete") seria lento a
--    medida que crece la tabla.
create index if not exists idx_incidencias_paquete on public.incidencias (paquete_id);
create index if not exists idx_incidencia_fotografias_incidencia on public.incidencia_fotografias (incidencia_id);
