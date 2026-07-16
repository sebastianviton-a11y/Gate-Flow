-- ============================================================
-- supabase/seed.sql
-- Datos semilla — catálogos globales que debe tener todo proyecto
-- GateFlow, independientemente de qué tenants existan. Se ejecuta
-- automáticamente con `supabase db reset`, o manualmente con
-- `psql -f supabase/seed.sql` contra un proyecto ya migrado.
-- ============================================================

-- Roles del sistema (BUSINESS_RULES BR-45 a BR-49).
insert into public.roles (clave, nombre, descripcion) values
  ('super_admin', 'Super Admin', 'Gestión de la plataforma a nivel multi-tenant'),
  ('admin_residencial', 'Administrador', 'Gestiona un residencial: catálogos, usuarios, reportes'),
  ('guardia', 'Guardia', 'Registra y entrega paquetes en portería'),
  ('residente', 'Residente', 'Recibe notificaciones y confirma entregas de sus paquetes')
on conflict (clave) do nothing;

-- Permisos granulares (04-API.md, CLAUDE.md §5).
insert into public.permisos (clave, modulo, descripcion) values
  ('paquetes.crear', 'paquetes', 'Registrar la recepción de un paquete'),
  ('paquetes.entregar', 'paquetes', 'Marcar un paquete como entregado'),
  ('paquetes.ver', 'paquetes', 'Consultar paquetes del tenant'),
  ('incidencias.crear', 'paquetes', 'Reportar una incidencia sobre un paquete'),
  ('incidencias.resolver', 'paquetes', 'Cerrar/resolver una incidencia'),
  ('usuarios.gestionar', 'usuarios', 'Alta, edición y baja de usuarios del tenant'),
  ('configuracion.gestionar', 'configuracion', 'Editar catálogos propios del tenant'),
  ('reportes.ver', 'reportes', 'Ver dashboard y reportes ejecutivos')
on conflict (clave) do nothing;

-- rol_permisos: asignación por defecto.
insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id from public.roles r, public.permisos p
where
  (r.clave = 'guardia' and p.clave in ('paquetes.crear', 'paquetes.entregar', 'paquetes.ver', 'incidencias.crear'))
  or (r.clave = 'admin_residencial' and p.clave in (
    'paquetes.crear', 'paquetes.entregar', 'paquetes.ver', 'incidencias.crear', 'incidencias.resolver',
    'usuarios.gestionar', 'configuracion.gestionar', 'reportes.ver'
  ))
  or (r.clave = 'super_admin')
on conflict do nothing;

-- Estados de paquete (03-DATABASE.md §15, ciclo de vida BR-16).
insert into public.estados_paquete (id, nombre, orden, color_hex) values
  ('pendiente', 'Pendiente de recepción', 1, '#94A3B8'),
  ('recibido', 'Recibido en portería', 2, '#3B82F6'),
  ('notificado', 'Residente notificado', 3, '#F59E0B'),
  ('entregado', 'Entregado al residente', 4, '#22C55E'),
  ('rechazado', 'Rechazado por residente', 5, '#EF4444'),
  ('devuelto', 'Devuelto a paquetería', 6, '#6B7280')
on conflict (id) do nothing;

-- Tamaños de paquete — catálogo global (tenant_id NULL).
insert into public.tamanos_paquete (tenant_id, clave, nombre, color_hex, orden) values
  (null, 'pequeno', 'Pequeño', '#94A3B8', 1),
  (null, 'mediano', 'Mediano', '#3B82F6', 2),
  (null, 'grande', 'Grande', '#F59E0B', 3),
  (null, 'extra_grande', 'Extra Grande', '#EF4444', 4)
on conflict do nothing;

-- Prioridades de paquete — catálogo global (tenant_id NULL).
insert into public.prioridades_paquete (tenant_id, clave, nombre, color_hex, orden) values
  (null, 'normal', 'Normal', '#94A3B8', 1),
  (null, 'urgente', 'Urgente', '#F59E0B', 2),
  (null, 'medicamento', 'Medicamento', '#EF4444', 3),
  (null, 'documento', 'Documento', '#3B82F6', 4),
  (null, 'perecedero', 'Perecedero', '#22C55E', 5),
  (null, 'confidencial', 'Confidencial', '#6B21A8', 6)
on conflict do nothing;

-- Empresas de paquetería — catálogo global (tenant_id NULL).
insert into public.empresas_paqueteria (tenant_id, nombre) values
  (null, 'DHL'),
  (null, 'FedEx'),
  (null, 'Estafeta'),
  (null, 'Amazon'),
  (null, 'UPS'),
  (null, 'Correos de México'),
  (null, 'Otro')
on conflict do nothing;
