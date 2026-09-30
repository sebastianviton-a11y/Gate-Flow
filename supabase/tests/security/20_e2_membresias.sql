-- ============================================================
-- E2 — nadie puede fabricar membresías ni roles desde el cliente.
--   E2a: otorgar_membresia() solo para service_role, con lista blanca
--        de roles y otorgante validado en el tenant.
--   E2b: user_tenants no admite INSERT/DELETE ni cambios de rol
--        desde el navegador; solo UPDATE (activo) por un admin del
--        mismo tenant y nunca sobre una fila super_admin.
-- ============================================================

-- ── E2b: escritura directa sobre user_tenants (rol authenticated) ──

-- E2-1: un admin no puede insertar membresías.
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.debe_fallar('E2-1', 'admin_a no puede INSERT en user_tenants',
  $$insert into public.user_tenants (user_id, tenant_id, rol_id)
    select '00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000', id
    from public.roles where clave = 'guardia'$$, '42501');
rollback;

-- E2-2: un admin no puede promoverse a super_admin editando su fila.
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.debe_fallar('E2-2', 'admin_a no puede cambiar su rol_id a super_admin',
  $$update public.user_tenants set rol_id = (select id from public.roles where clave = 'super_admin')
    where user_id = '00000000-0000-0000-0000-00000000000a'$$, '42501');
rollback;

-- E2-3: ni mover una membresía a otro usuario.
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.debe_fallar('E2-3', 'admin_a no puede cambiar user_id de una membresía',
  $$update public.user_tenants set user_id = '00000000-0000-0000-0000-000000000099'
    where user_id = '00000000-0000-0000-0000-0000000000a9'$$, '42501');
rollback;

-- E2-4: un admin no puede borrar membresías.
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.debe_fallar('E2-4', 'admin_a no puede DELETE en user_tenants',
  $$delete from public.user_tenants where user_id = '00000000-0000-0000-0000-0000000000a9'$$, '42501');
rollback;

-- E2-5: sí puede activar/desactivar a un guardia de SU tenant (uso real de /usuarios).
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.filas('E2-5', 'admin_a puede cambiar activo de guard_a (su tenant)',
  $$update public.user_tenants set activo = false
    where user_id = '00000000-0000-0000-0000-0000000000a9' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 1);
rollback;

-- E2-6: no puede tocar membresías de otro tenant.
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.filas('E2-6', 'admin_a no puede cambiar activo de guard_b (tenant B)',
  $$update public.user_tenants set activo = false where user_id = '00000000-0000-0000-0000-0000000000b9'$$, 0);
rollback;

-- E2-7: un admin del tenant de plataforma no puede desactivar al super_admin.
begin;
select tests.como('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select tests.filas('E2-7', 'admin_p no puede tocar la fila super_admin de su tenant',
  $$update public.user_tenants set activo = false where user_id = '00000000-0000-0000-0000-000000000001'$$, 0);
rollback;

-- ── E2a: otorgar_membresia() ──────────────────────────────────
-- Códigos: 22023 = parámetro inválido (rol fuera de lista blanca,
-- tenant o usuario inexistente); 42501 = otorgante sin permiso.

-- E2-8: authenticated no puede ejecutarla.
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.debe_fallar('E2-8', 'authenticated no puede ejecutar otorgar_membresia',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
    'guardia', '00000000-0000-0000-0000-00000000000a')$$, '42501');
rollback;

-- E2-9: anon tampoco.
begin;
set local role anon;
select tests.debe_fallar('E2-9', 'anon no puede ejecutar otorgar_membresia',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
    'guardia', '00000000-0000-0000-0000-00000000000a')$$, '42501');
rollback;

-- E2-10: service_role, rol super_admin → rechazado.
begin;
select tests.como('00000000-0000-0000-0000-000000000001', 'service_role');
set local role service_role;
select tests.debe_fallar('E2-10', 'otorgar_membresia rechaza rol super_admin',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
    'super_admin', '00000000-0000-0000-0000-000000000001')$$, '22023');
rollback;

-- E2-11: roles fuera de la lista blanca (admin_empresa, residente) → rechazados.
begin;
select tests.como('00000000-0000-0000-0000-000000000001', 'service_role');
set local role service_role;
select tests.debe_fallar('E2-11a', 'otorgar_membresia rechaza admin_empresa',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
    'admin_empresa', '00000000-0000-0000-0000-000000000001')$$, '22023');
select tests.debe_fallar('E2-11b', 'otorgar_membresia rechaza residente',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
    'residente', '00000000-0000-0000-0000-000000000001')$$, '22023');
rollback;

-- E2-12: otorgante guardia → rechazado.
begin;
select tests.como('00000000-0000-0000-0000-000000000001', 'service_role');
set local role service_role;
select tests.debe_fallar('E2-12', 'otorgar_membresia rechaza otorgante guardia',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
    'guardia', '00000000-0000-0000-0000-0000000000a9')$$, '42501');
rollback;

-- E2-13: otorgante admin de OTRO tenant → rechazado.
begin;
select tests.como('00000000-0000-0000-0000-000000000001', 'service_role');
set local role service_role;
select tests.debe_fallar('E2-13', 'otorgar_membresia rechaza admin de otro tenant',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'bbbbbbbb-0000-0000-0000-000000000000',
    'guardia', '00000000-0000-0000-0000-00000000000a')$$, '42501');
rollback;

-- E2-14: otorgante admin en A pero guardia en B, otorgando en B → rechazado (E4 dentro de la RPC).
begin;
select tests.como('00000000-0000-0000-0000-000000000001', 'service_role');
set local role service_role;
select tests.debe_fallar('E2-14', 'otorgar_membresia rechaza a mixto otorgando en B (es guardia ahí)',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'bbbbbbbb-0000-0000-0000-000000000000',
    'guardia', '00000000-0000-0000-0000-0000000000ab')$$, '42501');
rollback;

-- E2-15: tenant o usuario inexistente → rechazado.
begin;
select tests.como('00000000-0000-0000-0000-000000000001', 'service_role');
set local role service_role;
select tests.debe_fallar('E2-15a', 'otorgar_membresia rechaza tenant inexistente',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'cccccccc-0000-0000-0000-000000000000',
    'guardia', '00000000-0000-0000-0000-000000000001')$$, '22023');
select tests.debe_fallar('E2-15b', 'otorgar_membresia rechaza usuario inexistente',
  $$select public.otorgar_membresia('dddddddd-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000',
    'guardia', '00000000-0000-0000-0000-000000000001')$$, '22023');
rollback;

-- E2-16: caso válido: admin_a otorga guardia en A → 'creada', membresía y auditoría.
begin;
select tests.como('00000000-0000-0000-0000-00000000000a', 'service_role');
set local role service_role;
select tests.igual('E2-16a', 'admin_a otorga guardia en A → creada',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
    'guardia', '00000000-0000-0000-0000-00000000000a')$$, 'creada');
reset role;
select tests.igual('E2-16b', 'la membresía existe con rol guardia',
  $$select r.clave from public.user_tenants ut join public.roles r on r.id = ut.rol_id
    where ut.user_id = '00000000-0000-0000-0000-000000000099' and ut.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 'guardia');
select tests.igual('E2-16c', 'queda registrada en audit_log',
  $$select count(*)::text from public.audit_log
    where accion = 'membresia.otorgada' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'
      and user_id = '00000000-0000-0000-0000-00000000000a'$$, '1');
rollback;

-- E2-17: repetir sobre una membresía existente → 'ya_existia' y el rol NO cambia.
begin;
select tests.como('00000000-0000-0000-0000-00000000000a', 'service_role');
set local role service_role;
select tests.igual('E2-17a', 'otorgar sobre membresía existente → ya_existia',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-000000000000',
    'admin_residencial', '00000000-0000-0000-0000-00000000000a')$$, 'ya_existia');
reset role;
select tests.igual('E2-17b', 'el rol existente de guard_a no cambió',
  $$select r.clave from public.user_tenants ut join public.roles r on r.id = ut.rol_id
    where ut.user_id = '00000000-0000-0000-0000-0000000000a9' and ut.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 'guardia');
rollback;

-- E2-18: super admin puede otorgar en cualquier tenant (alta de residencial / soporte).
begin;
select tests.como('00000000-0000-0000-0000-000000000001', 'service_role');
set local role service_role;
select tests.igual('E2-18', 'super_admin otorga admin_residencial en B → creada',
  $$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'bbbbbbbb-0000-0000-0000-000000000000',
    'admin_residencial', '00000000-0000-0000-0000-000000000001')$$, 'creada');
rollback;
