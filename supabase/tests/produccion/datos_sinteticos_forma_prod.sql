-- ============================================================
-- SOLO ENSAYO LOCAL. Datos SINTÉTICOS con la forma y el volumen de
-- producción (conteos agregados leídos el 2026-10-08), sin ningún dato
-- real: 2 empresas, 3 residenciales MX (2 "piloto", 1 "trial"),
-- 8 usuarios (3 admin, 2 guardias, 1 super_admin, 2 sin membresía,
-- 1 sin confirmar), ~92 unidades, 12 ubicaciones, ~68 paquetes con
-- historial, grupos, fotos, firmas, incidencias y notificaciones.
-- ============================================================
begin;

insert into public.empresas (id, nombre, plan, estado_servicio) values
  ('e0000000-0000-4000-8000-000000000001', 'ZZ Empresa Sintética 1', 'piloto', 'piloto'),
  ('e0000000-0000-4000-8000-000000000002', 'ZZ Empresa Sintética 2', 'piloto', 'piloto');

insert into public.tenants (id, nombre, tipo, pais, plan, estado_servicio, empresa_id, onboarding_completado) values
  ('a0000000-0000-4000-8000-00000000000a', 'ZZ Residencial A', 'residencial', 'MX', 'piloto', 'piloto', 'e0000000-0000-4000-8000-000000000001', true),
  ('a0000000-0000-4000-8000-00000000000b', 'ZZ Residencial B', 'residencial', 'MX', 'piloto', 'piloto', 'e0000000-0000-4000-8000-000000000001', true),
  ('a0000000-0000-4000-8000-00000000000c', 'ZZ Residencial C', 'residencial', 'MX', 'trial', 'piloto', 'e0000000-0000-4000-8000-000000000002', false);

-- auth.users → trigger handle_new_auth_user crea public.users
insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-4000-8000-000000000001', 'admin.a@gateflow.invalid', '{"nombre_completo":"ZZ Admin A"}'),
  ('b0000000-0000-4000-8000-000000000002', 'admin.b@gateflow.invalid', '{"nombre_completo":"ZZ Admin B"}'),
  ('b0000000-0000-4000-8000-000000000003', 'admin.c@gateflow.invalid', '{"nombre_completo":"ZZ Admin C"}'),
  ('b0000000-0000-4000-8000-000000000004', 'guardia.a@gateflow.invalid', '{"nombre_completo":"ZZ Guardia A"}'),
  ('b0000000-0000-4000-8000-000000000005', 'guardia.b@gateflow.invalid', '{"nombre_completo":"ZZ Guardia B"}'),
  ('b0000000-0000-4000-8000-000000000006', 'super@gateflow.invalid', '{"nombre_completo":"ZZ Super"}'),
  ('b0000000-0000-4000-8000-000000000007', 'sin.membresia@gateflow.invalid', '{}'),
  ('b0000000-0000-4000-8000-000000000008', 'sin.confirmar@gateflow.invalid', '{}');

insert into public.user_tenants (user_id, tenant_id, rol_id, activo)
select u, t, (select id from public.roles where clave = r), true from (values
  ('b0000000-0000-4000-8000-000000000001'::uuid, 'a0000000-0000-4000-8000-00000000000a'::uuid, 'admin_residencial'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000b', 'admin_residencial'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000c', 'admin_residencial'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000a', 'guardia'),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-00000000000b', 'guardia'),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-00000000000a', 'super_admin')
) v(u, t, r);

-- 4 ubicaciones por residencial
insert into public.ubicaciones (tenant_id, nombre, tipo_nodo)
select t.id, 'ZZ Ubicación ' || n, 'zona'
from public.tenants t cross join generate_series(1, 4) n where t.nombre like 'ZZ %';

-- unidades: 40 + 40 + 12 = 92
insert into public.unidades (tenant_id, tipo, identificador, contacto_nombre, contacto_telefono)
select t.id, case when n % 3 = 0 then 'departamento' else 'casa' end, 'ZZ-' || n,
       'ZZ Contacto ' || n, '998 000 ' || lpad(n::text, 4, '0')
from public.tenants t cross join lateral generate_series(1, case t.nombre when 'ZZ Residencial C' then 12 else 40 end) n
where t.nombre like 'ZZ %';

-- paquetes: 30 + 30 + 8 = 68, recibidos por el guardia (o el admin en C)
insert into public.paquetes (tenant_id, unidad_id, recibido_por, remitente, ubicacion_id, notas)
select u.tenant_id, u.id,
  case u.tenant_id when 'a0000000-0000-4000-8000-00000000000a' then 'b0000000-0000-4000-8000-000000000004'::uuid
                   when 'a0000000-0000-4000-8000-00000000000b' then 'b0000000-0000-4000-8000-000000000005'::uuid
                   else 'b0000000-0000-4000-8000-000000000003'::uuid end,
  'ZZ Remitente', (select id from public.ubicaciones x where x.tenant_id = u.tenant_id order by nombre limit 1), 'sintético'
from (select u.*, row_number() over (partition by tenant_id order by identificador) rn from public.unidades u where identificador like 'ZZ-%') u
where rn <= case u.tenant_id when 'a0000000-0000-4000-8000-00000000000c' then 8 else 30 end;

-- grupos de entrega (24) con la función de producción, y paquetes asignados
do $$
declare r record; g uuid; i int := 0;
begin
  for r in select p.id, p.tenant_id, p.unidad_id from public.paquetes p order by p.created_at, p.id loop
    i := i + 1;
    exit when i > 24;
    g := public.obtener_o_crear_grupo_entrega(r.tenant_id, r.unidad_id, null);
    update public.paquetes set grupo_entrega_id = g where id = r.id;
  end loop;
end $$;

-- 38 entregados con la función de producción (historial + notificación)
do $$
declare r record; i int := 0;
begin
  for r in select p.id, p.recibido_por from public.paquetes p order by p.id loop
    i := i + 1;
    exit when i > 38;
    perform public.entregar_paquete(r.id, r.recibido_por, 'ZZ Quien recibe');
  end loop;
end $$;

insert into public.paquete_firmas (tenant_id, paquete_id, tipo, firma_data, firmante_nombre)
select tenant_id, id, 'entrega_residente', 'data:image/png;base64,ZZ', 'ZZ Firmante' from public.paquetes where estado_id = 'entregado';

insert into public.paquete_fotografias (tenant_id, paquete_id, tipo, storage_path)
select tenant_id, id, 'recepcion', tenant_id || '/zz/' || id || '.jpg' from public.paquetes order by id limit 27;

insert into public.incidencias (tenant_id, paquete_id, tipo, descripcion, nivel_danio, reportada_por)
select tenant_id, id, case when n % 2 = 0 then 'golpeado' else 'mojado' end, 'sintética', case when n % 3 = 0 then 'leve' else null end, recibido_por
from (select p.*, row_number() over (order by id) n from public.paquetes p) p where n <= 16;

insert into public.notificaciones (tenant_id, paquete_id, destinatario_nombre, canal, plantilla, contenido, estado_envio)
select tenant_id, id, 'ZZ Contacto', 'whatsapp', 'paquete_recibido', 'sintética', 'enviado' from public.paquetes order by id limit 67;

insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id)
select tenant_id, recibido_por, 'crear', 'paquete', id from public.paquetes order by id limit 28;

commit;
