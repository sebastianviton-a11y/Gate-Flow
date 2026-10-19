-- ============================================================
-- supabase/tests/security/harness/supabase_stub.sql
--
-- SOLO PARA PRUEBAS sobre un Postgres "pelado" (no Supabase). Emula
-- lo mínimo de la plataforma que usan las migraciones del repo y los
-- tests de seguridad:
--   * roles anon / authenticated / service_role (BYPASSRLS) /
--     supabase_auth_admin (el rol con el que GoTrue inserta en auth.users)
--   * auth.users, auth.uid(), auth.role() leyendo el JWT de la sesión
--   * storage.buckets, storage.objects, storage.foldername()
--   * los default privileges que Supabase aplica en el schema public
--
-- NUNCA aplicar esto contra un proyecto Supabase real (ya trae todo
-- esto, con más detalle). Con `supabase start` no hace falta.
-- ============================================================

-- Los roles son de todo el cluster: se crean solo si no existen, para
-- poder recrear la base de pruebas en el mismo servidor.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $$;
grant anon, authenticated, service_role, supabase_auth_admin to postgres;

-- ── auth ──────────────────────────────────────────────────────
create schema auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  invited_at timestamptz,
  created_at timestamptz not null default now()
);
grant all on auth.users to supabase_auth_admin, service_role;

-- Igual que Supabase: el "sub" y el "role" salen de los claims del JWT
-- que PostgREST coloca en request.jwt.claims para cada petición.
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )::text
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role, supabase_auth_admin;

-- ── storage ───────────────────────────────────────────────────
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- Misma implementación que Supabase: todos los segmentos del path
-- menos el último (el nombre del archivo).
create function storage.foldername(name text) returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- ── public: default privileges de Supabase ────────────────────
-- Supabase concede ALL a anon/authenticated/service_role sobre todo lo
-- que se crea en public; la seguridad real la pone RLS. Reproducirlo
-- aquí es lo que permite probar que los REVOKE explícitos de la
-- migración A funcionan de verdad.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
