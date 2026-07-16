-- ============================================================
-- supabase/seed-staging.sql
-- Datos demo para STAGING — nunca ejecutar contra un proyecto de
-- producción con datos reales. No incluye usuarios: las cuentas de
-- Supabase Auth se crean por separado (DEPLOY_STAGING.md §5) porque
-- requieren el sistema de Auth, no solo INSERT en una tabla. Este
-- script se ejecuta DESPUÉS de las migraciones y de seed.sql
-- (catálogos globales), y ANTES de vincular los usuarios demo.
-- ============================================================

do $$
declare
  v_tenant_id uuid;
  v_ubicacion_a uuid;
  v_ubicacion_b uuid;
  v_unidad_1 uuid;
  v_unidad_2 uuid;
  v_unidad_3 uuid;
  v_empresa_dhl uuid;
  v_tamano_mediano uuid;
  v_prioridad_normal uuid;
begin
  insert into public.tenants (nombre, tipo, ciudad, pais, plan, activo)
  values ('Residencial Demo GateFlow', 'residencial', 'Puerto Morelos', 'MX', 'trial', true)
  returning id into v_tenant_id;

  insert into public.ubicaciones (tenant_id, nombre, tipo_nodo) values
    (v_tenant_id, 'Estante A', 'estante') returning id into v_ubicacion_a;
  insert into public.ubicaciones (tenant_id, nombre, tipo_nodo) values
    (v_tenant_id, 'Locker 1', 'locker') returning id into v_ubicacion_b;

  insert into public.unidades (tenant_id, tipo, identificador, contacto_nombre, contacto_telefono) values
    (v_tenant_id, 'casa', 'Casa 12', 'María López (demo)', '9980000001') returning id into v_unidad_1;
  insert into public.unidades (tenant_id, tipo, identificador, contacto_nombre, contacto_telefono) values
    (v_tenant_id, 'departamento', 'Depto 302', 'Sofía Ramírez (demo)', '9980000002') returning id into v_unidad_2;
  insert into public.unidades (tenant_id, tipo, identificador, contacto_nombre, contacto_telefono) values
    (v_tenant_id, 'casa', 'Casa 45', 'Juan Pérez (demo)', '9980000003') returning id into v_unidad_3;

  select id into v_empresa_dhl from public.empresas_paqueteria where nombre = 'DHL' and tenant_id is null limit 1;
  select id into v_tamano_mediano from public.tamanos_paquete where clave = 'mediano' and tenant_id is null limit 1;
  select id into v_prioridad_normal from public.prioridades_paquete where clave = 'normal' and tenant_id is null limit 1;

  -- Los paquetes demo NO se insertan aquí a propósito: `recibido_por`
  -- exige un usuario real (FK a public.users), y todavía no existe
  -- ninguno en este punto de la secuencia — las cuentas de Auth se crean
  -- después (DEPLOY_STAGING.md §5), que es también donde se inserta el
  -- paquete demo, ya con un guardia real al que atribuirlo.

  raise notice 'Tenant demo creado: %', v_tenant_id;
  raise notice 'Guarda este ID (%) — lo necesitas en DEPLOY_STAGING.md §5 para vincular a los usuarios demo y crear el paquete de ejemplo.', v_tenant_id;
end $$;
