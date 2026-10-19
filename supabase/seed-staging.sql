-- ============================================================
-- supabase/seed-staging.sql
-- Datos FICTICIOS para el proyecto Supabase de STAGING.
--
-- Nunca contra producción: el bloque de guarda de abajo aborta si la
-- base ya contiene tenants, empresas o usuarios que no sean los de
-- este seed. Se ejecuta DESPUÉS de las migraciones y de seed.sql
-- (catálogos globales). Es idempotente (UUIDs fijos + ON CONFLICT).
--
-- No crea usuarios: las cuentas se crean por Auth (invitaciones desde
-- Admin, o el super admin inicial desde el dashboard) — ver
-- docs/operations/STAGING_SETUP.md.
--
--   Empresa E   "Empresa Demo GateFlow (ficticia)"
--   Tenant  P   "Plataforma GateFlow (staging)"  — membresía del super admin
--   Tenant  A   "Residencial Demo A (ficticio)"
--   Tenant  B   "Residencial Demo B (ficticio)"  — pruebas entre tenants
-- Nombres y teléfonos son inventados (prefijo 555, no asignado).
-- ============================================================

do $$
begin
  if exists (select 1 from public.tenants
             where id not in ('5a000000-0000-4000-8000-000000000000',
                              '5a000000-0000-4000-8000-00000000000a',
                              '5a000000-0000-4000-8000-00000000000b'))
     or exists (select 1 from public.empresas
                where id <> 'e5000000-0000-4000-8000-000000000001')
  then
    raise exception 'seed-staging.sql abortado: la base ya tiene datos que no son de este seed. '
      'Solo se ejecuta sobre un proyecto de staging recién migrado.';
  end if;
end $$;

insert into public.empresas (id, nombre, ciudad, estado_geografico, pais, observaciones) values
  ('e5000000-0000-4000-8000-000000000001', 'Empresa Demo GateFlow (ficticia)', 'Puerto Morelos', 'Quintana Roo', 'MX',
   'Datos ficticios de staging')
on conflict (id) do nothing;

insert into public.tenants (id, nombre, tipo, ciudad, estado_geografico, pais, plan, estado_servicio,
                            empresa_id, onboarding_completado, observaciones) values
  ('5a000000-0000-4000-8000-000000000000', 'Plataforma GateFlow (staging)', 'residencial', 'Puerto Morelos',
   'Quintana Roo', 'MX', 'piloto', 'piloto', 'e5000000-0000-4000-8000-000000000001', true,
   'Tenant técnico del super admin de staging'),
  ('5a000000-0000-4000-8000-00000000000a', 'Residencial Demo A (ficticio)', 'residencial', 'Puerto Morelos',
   'Quintana Roo', 'MX', 'piloto', 'piloto', 'e5000000-0000-4000-8000-000000000001', true,
   'Datos ficticios de staging'),
  ('5a000000-0000-4000-8000-00000000000b', 'Residencial Demo B (ficticio)', 'condominio', 'Cancún',
   'Quintana Roo', 'MX', 'piloto', 'piloto', 'e5000000-0000-4000-8000-000000000001', true,
   'Datos ficticios de staging')
on conflict (id) do nothing;

insert into public.ubicaciones (id, tenant_id, nombre, tipo_nodo) values
  ('5a100000-0000-4000-8000-00000000000a', '5a000000-0000-4000-8000-00000000000a', 'Estante A', 'estante'),
  ('5a100000-0000-4000-8000-0000000000a2', '5a000000-0000-4000-8000-00000000000a', 'Locker 1', 'locker'),
  ('5a100000-0000-4000-8000-00000000000b', '5a000000-0000-4000-8000-00000000000b', 'Estante B', 'estante')
on conflict (id) do nothing;

insert into public.unidades (id, tenant_id, tipo, identificador, contacto_nombre, contacto_telefono) values
  ('5a200000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-00000000000a', 'casa', 'Casa 12',
   'Residente Demo Uno', '5550000001'),
  ('5a200000-0000-4000-8000-0000000000a2', '5a000000-0000-4000-8000-00000000000a', 'departamento', 'Depto 302',
   'Residente Demo Dos', '5550000002'),
  ('5a200000-0000-4000-8000-0000000000a3', '5a000000-0000-4000-8000-00000000000a', 'casa', 'Casa 45',
   'Residente Demo Tres', '5550000003'),
  ('5a200000-0000-4000-8000-0000000000b1', '5a000000-0000-4000-8000-00000000000b', 'departamento', 'Torre 1 - 101',
   'Residente Demo Cuatro', '5550000004')
on conflict (id) do nothing;

do $$
begin
  raise notice 'Staging: empresa E, tenants P/A/B, % ubicaciones y % unidades ficticias.',
    (select count(*) from public.ubicaciones), (select count(*) from public.unidades);
end $$;
