-- ============================================================
-- E4a — los permisos de admin se evalúan DENTRO del tenant.
-- Usuario "mixto": admin_residencial en A, guardia en B.
-- En B debe comportarse como guardia; en A, como admin.
-- ============================================================

-- ── En B (donde es guardia): todo lo de admin debe estar denegado ──
begin;
select tests.como('00000000-0000-0000-0000-0000000000ab');
set local role authenticated;

select tests.debe_fallar('E4-B01', 'mixto no puede INSERT unidades en B',
  $$insert into public.unidades (tenant_id, tipo, identificador)
    values ('bbbbbbbb-0000-0000-0000-000000000000', 'casa', 'Intrusa')$$, '42501');
select tests.filas('E4-B02', 'mixto no puede UPDATE unidades de B',
  $$update public.unidades set identificador = 'X' where id = 'b1000000-0000-0000-0000-000000000000'$$, 0);
select tests.filas('E4-B03', 'mixto no puede DELETE unidades de B',
  $$delete from public.unidades where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 0);
select tests.filas('E4-B04', 'mixto no puede UPDATE del tenant B',
  $$update public.tenants set nombre = 'Hackeado' where id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 0);
select tests.debe_fallar('E4-B05', 'mixto no puede INSERT ubicaciones en B',
  $$insert into public.ubicaciones (tenant_id, nombre, tipo_nodo)
    values ('bbbbbbbb-0000-0000-0000-000000000000', 'X', 'estante')$$, '42501');
select tests.filas('E4-B06', 'mixto no puede DELETE ubicaciones de B',
  $$delete from public.ubicaciones where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 0);
select tests.filas('E4-B07', 'mixto no puede DELETE paquetes de B',
  $$delete from public.paquetes where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 0);
select tests.filas('E4-B08', 'mixto no puede DELETE grupos de entrega de B',
  $$delete from public.paquete_grupos_entrega where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 0);
select tests.debe_fallar('E4-B09', 'mixto no puede INSERT tamanos_paquete en B',
  $$insert into public.tamanos_paquete (tenant_id, clave, nombre)
    values ('bbbbbbbb-0000-0000-0000-000000000000', 'x', 'X')$$, '42501');
select tests.filas('E4-B10', 'mixto no puede UPDATE tamanos_paquete de B',
  $$update public.tamanos_paquete set nombre = 'X' where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 0);
select tests.debe_fallar('E4-B11', 'mixto no puede INSERT prioridades_paquete en B',
  $$insert into public.prioridades_paquete (tenant_id, clave, nombre)
    values ('bbbbbbbb-0000-0000-0000-000000000000', 'x', 'X')$$, '42501');
select tests.debe_fallar('E4-B12', 'mixto no puede INSERT empresas_paqueteria en B',
  $$insert into public.empresas_paqueteria (tenant_id, nombre)
    values ('bbbbbbbb-0000-0000-0000-000000000000', 'X')$$, '42501');
select tests.debe_fallar('E4-B13', 'mixto no puede INSERT plantillas_notificacion en B',
  $$insert into public.plantillas_notificacion (tenant_id, tipo, contenido)
    values ('bbbbbbbb-0000-0000-0000-000000000000', 'paquete_recibido', 'X')$$, '42501');
select tests.filas('E4-B14', 'mixto no puede UPDATE plantillas_notificacion de B',
  $$update public.plantillas_notificacion set contenido = 'X' where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 0);
select tests.igual('E4-B15', 'mixto no ve audit_log de B',
  $$select count(*)::text from public.audit_log where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, '0');
select tests.debe_fallar('E4-B16', 'mixto no puede subir logo a la carpeta de B',
  $$insert into storage.objects (bucket_id, name) values ('logos', 'bbbbbbbb-0000-0000-0000-000000000000/logo.png')$$, '42501');
select tests.filas('E4-B17', 'mixto no puede cambiar activo de guard_b (tenant B)',
  $$update public.user_tenants set activo = false where user_id = '00000000-0000-0000-0000-0000000000b9'$$, 0);
rollback;

-- ── En A (donde es admin): todo lo de admin debe funcionar ──
begin;
select tests.como('00000000-0000-0000-0000-0000000000ab');
set local role authenticated;

select tests.debe_funcionar('E4-A01', 'mixto puede INSERT unidades en A',
  $$insert into public.unidades (tenant_id, tipo, identificador)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'casa', 'Nueva A')$$);
select tests.filas('E4-A02', 'mixto puede UPDATE del tenant A',
  $$update public.tenants set nombre = 'Residencial A (editado)' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 1);
select tests.debe_funcionar('E4-A03', 'mixto puede INSERT ubicaciones en A',
  $$insert into public.ubicaciones (tenant_id, nombre, tipo_nodo)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'Nueva', 'estante')$$);
select tests.debe_funcionar('E4-A04', 'mixto puede INSERT tamanos_paquete en A',
  $$insert into public.tamanos_paquete (tenant_id, clave, nombre)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'y', 'Y')$$);
select tests.debe_funcionar('E4-A05', 'mixto puede INSERT plantillas_notificacion en A',
  $$insert into public.plantillas_notificacion (tenant_id, tipo, contenido)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'paquete_recibido', 'Hola')$$);
select tests.igual('E4-A06', 'mixto ve audit_log de A',
  $$select (count(*) > 0)::text from public.audit_log where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 'true');
select tests.debe_funcionar('E4-A07', 'mixto puede subir logo a la carpeta de A',
  $$insert into storage.objects (bucket_id, name) values ('logos', 'aaaaaaaa-0000-0000-0000-000000000000/logo.png')$$);
select tests.filas('E4-A08', 'mixto puede cambiar activo de guard_a (tenant A)',
  $$update public.user_tenants set activo = false where user_id = '00000000-0000-0000-0000-0000000000a9'$$, 1);
select tests.filas('E4-A09', 'mixto puede DELETE grupo de entrega de A',
  $$delete from public.paquete_grupos_entrega where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 1);
rollback;

-- E4-A10: DELETE de paquete en A (en transacción propia: arrastra historial).
begin;
select tests.como('00000000-0000-0000-0000-0000000000ab');
set local role authenticated;
select tests.filas('E4-A10', 'mixto puede DELETE paquetes de A',
  $$delete from public.paquetes where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 1);
rollback;

-- ── E4b vía política: mixto no puede mover una fila de A a B ──
begin;
select tests.como('00000000-0000-0000-0000-0000000000ab');
set local role authenticated;
select tests.debe_fallar('E4-X01', 'mixto no puede mover una unidad de A a B',
  $$update public.unidades set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    where id = 'a1000000-0000-0000-0000-000000000000'$$);
rollback;
