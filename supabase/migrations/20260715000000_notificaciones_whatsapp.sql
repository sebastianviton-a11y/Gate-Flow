-- ============================================================
-- 20260715000000_notificaciones_whatsapp.sql
-- Plantillas configurables por la administración + notificación
-- automática de entrega. Sigue el mismo patrón "catálogo global +
-- override por tenant" ya usado en empresas_paqueteria/tamanos/
-- prioridades (03-DATABASE.md) — consistencia deliberada, no un patrón
-- nuevo para este caso.
-- ============================================================

create table public.plantillas_notificacion (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade, -- NULL = plantilla por defecto de GateFlow
  tipo text not null check (tipo in ('paquete_recibido', 'paquete_entregado', 'recordatorio')),
  contenido text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_plantilla_global on public.plantillas_notificacion (tipo) where tenant_id is null;
create unique index uq_plantilla_tenant on public.plantillas_notificacion (tenant_id, tipo) where tenant_id is not null;
create trigger trg_plantillas_updated_at before update on public.plantillas_notificacion
  for each row execute function public.set_updated_at();

comment on column public.plantillas_notificacion.contenido is
  'Placeholders admitidos: {residente}, {residencial}, {unidad}, {codigo}, {fecha}, {hora}. Renderizados por packages/notificaciones — ver plantillas.ts.';

-- RLS: mismo patrón que catálogos con tenant_id nullable.
alter table public.plantillas_notificacion enable row level security;

create policy plantillas_notificacion_read on public.plantillas_notificacion
  for select using (tenant_id is null or tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());

create policy plantillas_notificacion_write_admin on public.plantillas_notificacion
  for insert with check (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

create policy plantillas_notificacion_update_admin on public.plantillas_notificacion
  for update using (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

-- Plantillas por defecto de GateFlow (tenant_id NULL) — el administrador
-- las ve y puede sobreescribirlas con una fila propia; nunca edita estas.
insert into public.plantillas_notificacion (tenant_id, tipo, contenido) values
  (null, 'paquete_recibido',
   'Hola {residente} 👋, tu paquete llegó a {residencial} el {fecha} a las {hora}. Código: {codigo}. Puedes recogerlo en recepción.'),
  (null, 'paquete_entregado',
   'Confirmamos: tu paquete {codigo} de {residencial} fue entregado el {fecha} a las {hora}. ¡Gracias por confiar en nosotros!'),
  (null, 'recordatorio',
   'Recordatorio: sigues teniendo un paquete pendiente de recoger en {residencial} (código {codigo}). Te esperamos en recepción.');

-- ── Notificación automática de entrega ──────────────────────
-- Se agrega dentro de entregar_paquete() para que sea imposible olvidarla
-- sin importar qué cliente llame a la función — "todo lo demás ocurre
-- automáticamente", tal como se pidió, no depende de que el frontend
-- recuerde crear la fila.
create or replace function public.entregar_paquete(
  p_paquete_id uuid,
  p_entregado_por uuid,
  p_entregado_a_nombre text
)
returns public.paquetes
language plpgsql
security invoker
as $$
declare
  v_paquete public.paquetes;
  v_destinatario_nombre text;
  v_destinatario_user_id uuid;
begin
  select * into v_paquete from public.paquetes where id = p_paquete_id for update;

  if not found then
    raise exception 'Paquete % no existe', p_paquete_id;
  end if;

  if v_paquete.estado_id = 'entregado' then
    raise exception 'El paquete % ya fue entregado el %', v_paquete.codigo_gateflow, v_paquete.fecha_entrega
      using errcode = 'P0001';
  end if;

  perform set_config('app.allow_delivery_update', 'true', true);

  update public.paquetes
  set
    estado_id = 'entregado',
    entregado_por = p_entregado_por,
    entregado_a_nombre = p_entregado_a_nombre,
    fecha_entrega = now()
  where id = p_paquete_id
  returning * into v_paquete;

  -- Resolver a quién notificar: residente formal si existe, si no, el
  -- contacto informal de la unidad (mismo criterio que registrarPaquete
  -- en TypeScript, packages/paquetes/src/mutations.ts).
  select u.nombre_completo, u.id into v_destinatario_nombre, v_destinatario_user_id
  from public.users u where u.id = v_paquete.residente_id;

  if v_destinatario_nombre is null then
    select un.contacto_nombre into v_destinatario_nombre
    from public.unidades un where un.id = v_paquete.unidad_id;
    v_destinatario_user_id := null;
  end if;

  if v_destinatario_nombre is not null then
    insert into public.notificaciones (
      tenant_id, paquete_id, destinatario_user_id, destinatario_nombre, canal, plantilla, contenido, estado_envio
    ) values (
      v_paquete.tenant_id, v_paquete.id, v_destinatario_user_id, v_destinatario_nombre, 'whatsapp',
      'paquete_entregado',
      format('Confirmamos: tu paquete %s fue entregado el %s.', v_paquete.codigo_gateflow, to_char(now(), 'DD/MM/YYYY HH24:MI')),
      'pendiente'
    );
  end if;

  return v_paquete;
end;
$$;
