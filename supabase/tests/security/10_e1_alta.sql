-- ============================================================
-- E1 — la metadata de auth.users (controlable por quien hace un
-- signUp público) no debe poder elegir tenant ni rol.
--
-- Depende de la fase (GUC tests.fase, lo fija run-local.sh):
--   0 = esquema actual (sin corrección) — se espera que FALLE
--   A = migración A: trigger transitorio con lista blanca de roles
--   C = migración C: la metadata ya no crea membresías nunca
-- ============================================================

-- E1-1: signUp con rol super_admin → nunca crea membresía (A y C).
begin;
set local role supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000001', 'e1-1@test.local',
   '{"tenant_id":"aaaaaaaa-0000-0000-0000-000000000000","rol_clave":"super_admin"}');
reset role;
select tests.igual('E1-1', 'signUp con metadata rol_clave=super_admin no crea membresía',
  $$select count(*)::text from public.user_tenants where user_id = 'e1000000-0000-0000-0000-000000000001'$$, '0');
rollback;

-- E1-2: signUp con admin_empresa / residente (fuera de la lista blanca) → nunca.
begin;
set local role supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000002', 'e1-2a@test.local',
   '{"tenant_id":"aaaaaaaa-0000-0000-0000-000000000000","rol_clave":"admin_empresa"}'),
  ('e1000000-0000-0000-0000-000000000003', 'e1-2b@test.local',
   '{"tenant_id":"aaaaaaaa-0000-0000-0000-000000000000","rol_clave":"residente"}');
reset role;
select tests.igual('E1-2', 'signUp con admin_empresa/residente no crea membresía',
  $$select count(*)::text from public.user_tenants
    where user_id in ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003')$$, '0');
rollback;

-- E1-3: el perfil en public.users se crea siempre (todas las fases).
begin;
set local role supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000004', 'e1-3@test.local', '{"nombre_completo":"Persona Nueva"}');
reset role;
select tests.igual('E1-3', 'el trigger crea el perfil en public.users',
  $$select nombre_completo from public.users where id = 'e1000000-0000-0000-0000-000000000004'$$, 'Persona Nueva');
rollback;

-- E1-4: invitación "heredada" (código actual: metadata con tenant y rol
-- permitido). Fase A: debe seguir creando la membresía (compatibilidad).
-- Fase C: la metadata ya no tiene efecto.
begin;
set local role supabase_auth_admin;
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000005', 'e1-4@test.local', now(),
   '{"tenant_id":"aaaaaaaa-0000-0000-0000-000000000000","rol_clave":"guardia"}');
reset role;
select tests.igual('E1-4', 'invitación con metadata (código actual): membresía solo en fase A',
  $$select count(*)::text from public.user_tenants where user_id = 'e1000000-0000-0000-0000-000000000005'$$,
  case current_setting('tests.fase', true) when 'C' then '0' else '1' end);
rollback;

-- E1-5: signUp público con rol PERMITIDO en un tenant ajeno.
-- Fase A: residuo documentado (lo cierra desactivar el signup público
-- y, definitivamente, la fase C). Fase C: 0.
begin;
set local role supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000006', 'e1-5@test.local',
   '{"tenant_id":"bbbbbbbb-0000-0000-0000-000000000000","rol_clave":"admin_residencial"}');
reset role;
select tests.igual('E1-5', 'signUp con rol permitido en tenant ajeno (residuo de fase A; 0 en fase C)',
  $$select count(*)::text from public.user_tenants where user_id = 'e1000000-0000-0000-0000-000000000006'$$,
  case current_setting('tests.fase', true) when 'C' then '0' else '1' end);
rollback;
