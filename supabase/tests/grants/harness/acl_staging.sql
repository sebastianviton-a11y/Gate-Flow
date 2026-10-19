-- ============================================================
-- SOLO PARA PRUEBAS. Se carga después de
-- ../security/harness/supabase_stub.sql y antes de las migraciones.
--
-- El stub reproduce los default privileges de los proyectos Supabase
-- antiguos (ALL a anon/authenticated/service_role). Esto los
-- reemplaza por los de un proyecto nuevo como staging
-- (sfuckzzqejerrifuypby, leído de pg_default_acl en octubre 2026):
--   tablas     → anon/authenticated/service_role = Dxtm
--                (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN)
--   secuencias → solo el dueño
--   funciones  → EXECUTE a PUBLIC (acl NULL, como en staging)
-- ============================================================

alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges in schema public
  grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
