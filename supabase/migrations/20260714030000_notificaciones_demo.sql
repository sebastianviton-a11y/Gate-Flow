-- ============================================================
-- 20260714030000_notificaciones_demo.sql
-- Hallazgo real al conectar "Registrar → Notificar" al flujo de demo:
-- `notificaciones.destinatario_user_id` es NOT NULL, pero la mayoría de
-- residentes en un piloto real no tienen cuenta formal todavía (mismo
-- caso que unidades.contacto_nombre, migración anterior). Además nunca
-- existió policy de INSERT para `authenticated` — la tabla solo tenía
-- SELECT, así que el flujo de registro no podía crear la notificación.
-- ============================================================

alter table public.notificaciones
  alter column destinatario_user_id drop not null,
  add column destinatario_nombre text,
  add column destinatario_telefono text,
  add constraint chk_destinatario_presente check (
    destinatario_user_id is not null or destinatario_nombre is not null
  );

comment on column public.notificaciones.destinatario_nombre is
  'Nombre del destinatario cuando no tiene cuenta formal — mismo patrón que unidades.contacto_nombre.';

-- INSERT: un guardia/admin puede crear una notificación para un paquete
-- de SU tenant — igual que el resto de tablas del módulo, sin excepción
-- especial.
create policy notificaciones_insert on public.notificaciones
  for insert with check (tenant_id in (select public.current_tenant_ids()));
