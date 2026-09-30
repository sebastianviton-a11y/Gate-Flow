-- ============================================================
-- Fixtures de los tests de seguridad. Se cargan UNA vez, como
-- postgres, sobre una base recién migrada (nunca contra un proyecto
-- con datos reales).
--
--   Tenants: P (plataforma), A, B — todos de la empresa E.
--   Usuarios:
--     super     super_admin en P
--     admin_p   admin_residencial en P (para probar que no toca filas super_admin)
--     admin_a   admin_residencial en A
--     guard_a   guardia en A
--     admin_b   admin_residencial en B
--     guard_b   guardia en B
--     mixto     admin_residencial en A  +  guardia en B      (caso E4a)
--     admin_ab  admin_residencial en A  +  admin en B        (caso E4b)
--     solo      sin ninguna membresía
-- ============================================================

insert into public.empresas (id, nombre) values ('e0000000-0000-0000-0000-000000000001', 'Empresa Test');

insert into public.tenants (id, nombre, tipo, empresa_id, onboarding_completado) values
  ('11111111-0000-0000-0000-000000000000', 'Plataforma', 'residencial', 'e0000000-0000-0000-0000-000000000001', true),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Residencial A', 'residencial', 'e0000000-0000-0000-0000-000000000001', true),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Residencial B', 'residencial', 'e0000000-0000-0000-0000-000000000001', true);

-- Los usuarios se crean como lo hace GoTrue (rol supabase_auth_admin),
-- así el trigger de alta crea public.users igual que en producción.
set role supabase_auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'super@test.local'),
  ('00000000-0000-0000-0000-0000000000f1', 'admin_p@test.local'),
  ('00000000-0000-0000-0000-00000000000a', 'admin_a@test.local'),
  ('00000000-0000-0000-0000-0000000000a9', 'guard_a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'admin_b@test.local'),
  ('00000000-0000-0000-0000-0000000000b9', 'guard_b@test.local'),
  ('00000000-0000-0000-0000-0000000000ab', 'mixto@test.local'),
  ('00000000-0000-0000-0000-0000000000aa', 'admin_ab@test.local'),
  ('00000000-0000-0000-0000-000000000099', 'solo@test.local');
reset role;

insert into public.user_tenants (user_id, tenant_id, rol_id)
select v.u::uuid, v.t::uuid, r.id
from (values
  ('00000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000000', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000f1', '11111111-0000-0000-0000-000000000000', 'admin_residencial'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'admin_residencial'),
  ('00000000-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-000000000000', 'guardia'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'admin_residencial'),
  ('00000000-0000-0000-0000-0000000000b9', 'bbbbbbbb-0000-0000-0000-000000000000', 'guardia'),
  ('00000000-0000-0000-0000-0000000000ab', 'aaaaaaaa-0000-0000-0000-000000000000', 'admin_residencial'),
  ('00000000-0000-0000-0000-0000000000ab', 'bbbbbbbb-0000-0000-0000-000000000000', 'guardia'),
  ('00000000-0000-0000-0000-0000000000aa', 'aaaaaaaa-0000-0000-0000-000000000000', 'admin_residencial'),
  ('00000000-0000-0000-0000-0000000000aa', 'bbbbbbbb-0000-0000-0000-000000000000', 'admin_residencial')
) as v(u, t, rol)
join public.roles r on r.clave = v.rol;

-- Datos operativos por tenant.
insert into public.unidades (id, tenant_id, tipo, identificador) values
  ('a1000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'casa', 'Casa A1'),
  ('b1000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'casa', 'Casa B1');

insert into public.ubicaciones (id, tenant_id, nombre, tipo_nodo) values
  ('a2000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'Estante A', 'estante'),
  ('b2000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'Estante B', 'estante');

insert into public.paquetes (id, tenant_id, unidad_id, recibido_por, ubicacion_id) values
  ('a3000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9', 'a2000000-0000-0000-0000-000000000000'),
  ('b3000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b9', 'b2000000-0000-0000-0000-000000000000');

insert into public.paquete_grupos_entrega (id, tenant_id, unidad_id, token) values
  ('a4000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'tok-a'),
  ('b4000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', 'tok-b');

insert into public.tamanos_paquete (id, tenant_id, clave, nombre) values
  ('a5000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'xl_a', 'XL de A'),
  ('b5000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'xl_b', 'XL de B');

insert into public.plantillas_notificacion (tenant_id, tipo, contenido) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'recordatorio', 'Plantilla A'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'recordatorio', 'Plantilla B');

insert into public.calles (id, tenant_id, nombre) values
  ('a6000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'Calle A');

insert into public.audit_log (tenant_id, user_id, accion, entidad) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'fixture.a', 'tenants'),
  ('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b', 'fixture.b', 'tenants');
