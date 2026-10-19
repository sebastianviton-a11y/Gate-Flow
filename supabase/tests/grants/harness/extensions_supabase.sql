-- ============================================================
-- SOLO PARA PRUEBAS. Como en Supabase, las extensiones viven en el
-- schema "extensions" y el search_path de la base es
-- "$user", public, extensions. Sin esto pgcrypto cae en public y una
-- función con `set search_path = public` que llama a
-- gen_random_bytes() funciona en local pero falla en Supabase
-- (42883) — exactamente lo que pasó en staging con
-- obtener_o_crear_grupo_entrega.
-- Se carga antes de las migraciones (su `create extension if not
-- exists pgcrypto` queda como no-op).
-- ============================================================

create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

do $$
begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;
