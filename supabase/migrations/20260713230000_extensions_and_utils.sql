-- ============================================================
-- 20260713230000_extensions_and_utils.sql
-- Extensiones y funciones utilitarias compartidas por todas las
-- migraciones siguientes. Fuente: 02-ARCHITECTURE.md, 03-DATABASE.md.
-- ============================================================

create extension if not exists "pgcrypto";

-- Trigger genérico para mantener updated_at al día en cualquier tabla
-- que lo tenga (CLAUDE.md §10: "toda tabla relevante debe tener
-- created_at y, cuando corresponda, updated_at").
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
