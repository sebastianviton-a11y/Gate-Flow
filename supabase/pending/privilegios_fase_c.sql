-- ============================================================
-- privilegios_fase_c.sql — PENDIENTE (fase C de 3)
--
-- NO está en supabase/migrations/ a propósito: `supabase db push`
-- la aplicaría antes de tiempo. Se mueve a migrations/ con un
-- timestamp nuevo (p. ej. 2026MMDDhhmmss_privilegios_fase_c.sql)
-- solo cuando se cumpla TODO lo siguiente:
--   1. La fase A está aplicada.
--   2. La fase B (server actions con otorgar_membresia y sin
--      tenant_id/rol_clave en la metadata) está desplegada en Admin.
--   3. Ya no quedan invitaciones pendientes emitidas por el código
--      anterior (sus usuarios ya aceptaron, o se re-invitaron con B):
--      una invitación vieja aún no aceptada ya tiene su fila en
--      auth.users, así que no depende de este trigger; el riesgo es
--      solo reenviar una invitación vieja desde el código anterior.
--
-- Efecto: la metadata de auth.users deja de crear membresías (E1
-- cerrado por completo, incluido el residuo de fase A: signUp con un
-- rol permitido en un tenant ajeno) y se elimina has_role(), que ya
-- no usa ninguna política.
-- Rollback: supabase/rollback/privilegios_fase_c.down.sql
-- ============================================================

-- Precondiciones: aborta sin cambiar nada si algo aún depende de
-- has_role() o si falta alguna pieza de la fase A.
do $$
begin
  if not exists (select 1 from pg_proc
                 where proname = 'otorgar_membresia' and pronamespace = 'public'::regnamespace) then
    raise exception 'Fase C abortada: la fase A no está aplicada (falta otorgar_membresia)';
  end if;

  if exists (select 1 from pg_policies
             where coalesce(qual, '') ~ '\mhas_role\(' or coalesce(with_check, '') ~ '\mhas_role\(') then
    raise exception 'Fase C abortada: hay políticas que aún usan has_role()';
  end if;

  if exists (select 1 from pg_proc p
             where p.prosrc ~ '\mhas_role\('
               and p.proname <> 'has_role'
               and p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)) then
    raise exception 'Fase C abortada: hay funciones que aún llaman a has_role()';
  end if;

  if exists (select 1 from pg_views
             where schemaname not in ('pg_catalog', 'information_schema')
               and definition ~ '\mhas_role\(') then
    raise exception 'Fase C abortada: hay vistas que aún usan has_role()';
  end if;
end;
$$;

drop trigger trg_vincular_membresia_heredada on auth.users;
drop function public.vincular_membresia_heredada();

-- Sin CASCADE: si algo no detectado arriba dependiera de has_role(),
-- el DROP falla y la migración entera se revierte.
drop function public.has_role(text[]);
