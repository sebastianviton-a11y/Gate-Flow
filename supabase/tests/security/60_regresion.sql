-- ============================================================
-- Regresión: lo que hoy funciona debe seguir funcionando igual
-- (en todas las fases). Cubre el uso real de Admin y Guard.
-- ============================================================

-- ── Guardia en su tenant ──
begin;
select tests.como('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
select tests.igual('R-01', 'guard_a ve las unidades de A',
  $$select count(*)::text from public.unidades where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, '1');
select tests.igual('R-02', 'guard_a no ve unidades de B',
  $$select count(*)::text from public.unidades where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, '0');
-- R-03 (INSERT de paquete por el guardia) se omite: falla ANTES de
-- estos cambios porque fn_registrar_historial_paquete no es SECURITY
-- DEFINER y paquete_historial no tiene política INSERT. Es un hallazgo
-- previo, fuera del alcance de E1/E2/E4; se reporta aparte.
select tests.filas('R-04', 'guard_a actualiza un paquete no entregado de A',
  $$update public.paquetes set notas = 'revisado' where id = 'a3000000-0000-0000-0000-000000000000'$$, 1);
select tests.debe_fallar('R-05', 'guard_a no puede crear unidades',
  $$insert into public.unidades (tenant_id, tipo, identificador)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'casa', 'X')$$, '42501');
select tests.filas('R-06', 'guard_a no puede borrar paquetes',
  $$delete from public.paquetes where id = 'a3000000-0000-0000-0000-000000000000'$$, 0);
select tests.filas('R-07', 'guard_a actualiza un grupo de entrega pendiente de A',
  $$update public.paquete_grupos_entrega set estado = estado where id = 'a4000000-0000-0000-0000-000000000000'$$, 1);
select tests.igual('R-08', 'guard_a no ve audit_log',
  $$select count(*)::text from public.audit_log$$, '0');
select tests.filas('R-09', 'guard_a no puede cambiar activo de nadie',
  $$update public.user_tenants set activo = false where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 0);
rollback;

-- ── Admin en su tenant ──
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.debe_funcionar('R-10', 'admin_a crea una unidad en A',
  $$insert into public.unidades (tenant_id, tipo, identificador)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'casa', 'Casa A2')$$);
select tests.filas('R-11', 'admin_a edita una unidad de A',
  $$update public.unidades set identificador = 'Casa A1 (edit)' where id = 'a1000000-0000-0000-0000-000000000000'$$, 1);
select tests.filas('R-12', 'admin_a edita su residencial',
  $$update public.tenants set nombre = 'Residencial A*' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 1);
select tests.filas('R-13', 'admin_a edita un tamaño propio',
  $$update public.tamanos_paquete set nombre = 'XL' where id = 'a5000000-0000-0000-0000-000000000000'$$, 1);
select tests.filas('R-14', 'admin_a edita la plantilla de A',
  $$update public.plantillas_notificacion set contenido = 'Nueva' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 1);
select tests.debe_funcionar('R-15', 'admin_a crea una prioridad en A',
  $$insert into public.prioridades_paquete (tenant_id, clave, nombre)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'vip', 'VIP')$$);
select tests.debe_funcionar('R-16', 'admin_a crea una paquetería en A',
  $$insert into public.empresas_paqueteria (tenant_id, nombre) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Local')$$);
select tests.igual('R-17', 'admin_a ve los miembros de A (usuarios)',
  $$select count(*)::text from public.user_tenants where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, '4');
select tests.igual('R-18', 'admin_a ve audit_log de A y no de B',
  $$select string_agg(distinct tenant_id::text, ',') from public.audit_log$$, 'aaaaaaaa-0000-0000-0000-000000000000');
select tests.debe_funcionar('R-19', 'admin_a sube el logo de A',
  $$insert into storage.objects (bucket_id, name) values ('logos', 'aaaaaaaa-0000-0000-0000-000000000000/logo.png')$$);
rollback;

-- R-20: admin_a desactiva y reactiva a un guardia (usuarios-client.tsx).
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.filas('R-20a', 'admin_a desactiva a guard_a',
  $$update public.user_tenants set activo = false where user_id = '00000000-0000-0000-0000-0000000000a9'
    and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 1);
select tests.filas('R-20b', 'admin_a reactiva a guard_a',
  $$update public.user_tenants set activo = true where user_id = '00000000-0000-0000-0000-0000000000a9'
    and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 1);
rollback;

-- ── Super admin ──
begin;
select tests.como('00000000-0000-0000-0000-000000000001');
set local role authenticated;
select tests.igual('R-21', 'super ve todos los tenants',
  $$select count(*)::text from public.tenants$$, '3');
select tests.igual('R-22', 'super ve unidades de B',
  $$select count(*)::text from public.unidades where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, '1');
select tests.igual('R-23', 'super ve audit_log de todos',
  $$select count(distinct tenant_id)::text from public.audit_log$$, '2');
select tests.debe_funcionar('R-24', 'super crea un tenant',
  $$insert into public.tenants (nombre, tipo, empresa_id)
    values ('Nuevo', 'residencial', 'e0000000-0000-0000-0000-000000000001')$$);
select tests.debe_fallar('R-25', 'super no escribe unidades en B (sin membresía ahí, como hoy)',
  $$insert into public.unidades (tenant_id, tipo, identificador)
    values ('bbbbbbbb-0000-0000-0000-000000000000', 'casa', 'X')$$, '42501');
rollback;

-- ── Usuario sin membresías ──
begin;
select tests.como('00000000-0000-0000-0000-000000000099');
set local role authenticated;
select tests.igual('R-26', 'solo no ve tenants',
  $$select count(*)::text from public.tenants$$, '0');
select tests.igual('R-27', 'solo no ve paquetes',
  $$select count(*)::text from public.paquetes$$, '0');
select tests.igual('R-28', 'solo ve su propio perfil',
  $$select count(*)::text from public.users where id = '00000000-0000-0000-0000-000000000099'$$, '1');
rollback;

-- ── service_role (server actions) sigue sin RLS ──
begin;
select tests.como('00000000-0000-0000-0000-000000000001', 'service_role');
set local role service_role;
select tests.igual('R-29', 'service_role lee todas las membresías',
  $$select (count(*) >= 10)::text from public.user_tenants$$, 'true');
rollback;

-- ── anon (sin sesión) ──
-- Tras la fase A, has_role_in_tenant() no es ejecutable por anon: una
-- lectura anónima de audit_log pasa de "0 filas" a 42501. Ninguna app
-- lee audit_log sin sesión; ambos resultados son "sin acceso".
begin;
set local role anon;
select tests.igual('R-30', 'anon no ve tenants',
  $$select count(*)::text from public.tenants$$, '0');
select tests.filas('R-31', 'anon no ve audit_log (0 filas o 42501)',
  $$select * from public.audit_log$$, 0);
rollback;
