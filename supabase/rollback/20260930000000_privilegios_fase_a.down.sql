-- ============================================================
-- ROLLBACK de 20260930000000_privilegios_fase_a.sql
--
-- Devuelve el esquema EXACTO previo a la fase A (políticas, grants,
-- funciones y triggers). Reabre E1/E2/E4: úsese solo si la fase A
-- rompe algo en producción y como paso previo a corregirla.
--
-- Orden obligatorio:
--   * Si la fase C está aplicada, primero
--     supabase/rollback/<C>.down.sql (recrea has_role() y el trigger
--     transitorio, que este script espera encontrar).
--   * Si la fase B (código) está desplegada, revertirla ANTES:
--     el código de B llama a otorgar_membresia(), que aquí se borra.
--
-- No es una migración: se ejecuta a mano (psql / SQL editor) y
-- después se borra la fila de la migración A en
-- supabase_migrations.schema_migrations (ver supabase/rollback/README.md).
-- ============================================================

begin;

-- ── 7. Alta de usuarios: vuelve a un solo trigger ─────────────
drop trigger trg_vincular_membresia_heredada on auth.users;
drop function public.vincular_membresia_heredada();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_rol_clave text;
  v_rol_id uuid;
begin
  insert into public.users (id, nombre_completo, email, telefono, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre_completo', new.email, 'Usuario'),
    new.email,
    new.phone,
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  v_tenant_id := (new.raw_user_meta_data->>'tenant_id')::uuid;
  v_rol_clave := new.raw_user_meta_data->>'rol_clave';

  if v_tenant_id is not null and v_rol_clave is not null then
    select id into v_rol_id from public.roles where clave = v_rol_clave;
    if v_rol_id is not null then
      insert into public.user_tenants (user_id, tenant_id, rol_id, activo)
      values (new.id, v_tenant_id, v_rol_id, true)
      on conflict (user_id, tenant_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

grant execute on function public.handle_new_auth_user() to public, anon, authenticated;

-- ── 6. tenant_id inmutable ────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'audit_log', 'calles', 'edificios', 'empresas_paqueteria', 'incidencias', 'manzanas',
    'notificaciones', 'paquete_firmas', 'paquete_fotografias', 'paquete_grupos_entrega',
    'paquete_historial', 'paquete_ubicacion_historial', 'plantillas_notificacion',
    'prioridades_paquete', 'residentes_unidades', 'tamanos_paquete', 'ubicaciones',
    'unidades', 'user_tenants'
  ]
  loop
    execute format('drop trigger %I on public.%I', 'trg_' || t || '_tenant_id_inmutable', t);
  end loop;
end;
$$;

drop function public.fn_tenant_id_inmutable();

-- ── 5. otorgar_membresia ──────────────────────────────────────
drop function public.otorgar_membresia(uuid, uuid, text, uuid);

-- ── 4. user_tenants ───────────────────────────────────────────
drop policy user_tenants_update_activo_admin on public.user_tenants;

revoke update (activo) on public.user_tenants from authenticated;
grant insert, update, delete, truncate on public.user_tenants to anon, authenticated;

create policy user_tenants_write_admin on public.user_tenants
  for all using (
    public.has_role(array['admin_residencial', 'super_admin'])
    and tenant_id in (select public.current_tenant_ids())
  )
  with check (
    public.has_role(array['admin_residencial', 'super_admin'])
    and tenant_id in (select public.current_tenant_ids())
  );

-- ── 3. Políticas: de vuelta a has_role() ──────────────────────
-- DROP + CREATE (no ALTER) porque varias no tenían WITH CHECK.
drop policy tenants_update_admin on public.tenants;
create policy tenants_update_admin on public.tenants
  for update using (id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));

drop policy unidades_insert_admin on public.unidades;
create policy unidades_insert_admin on public.unidades
  for insert with check (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));
drop policy unidades_update_admin on public.unidades;
create policy unidades_update_admin on public.unidades
  for update using (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']))
  with check (tenant_id in (select public.current_tenant_ids()));
drop policy unidades_delete_admin on public.unidades;
create policy unidades_delete_admin on public.unidades
  for delete using (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));

drop policy ubicaciones_insert_admin on public.ubicaciones;
create policy ubicaciones_insert_admin on public.ubicaciones
  for insert with check (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));
drop policy ubicaciones_update_admin on public.ubicaciones;
create policy ubicaciones_update_admin on public.ubicaciones
  for update using (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']))
  with check (tenant_id in (select public.current_tenant_ids()));
drop policy ubicaciones_delete_admin on public.ubicaciones;
create policy ubicaciones_delete_admin on public.ubicaciones
  for delete using (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));

drop policy paquetes_update on public.paquetes;
create policy paquetes_update on public.paquetes
  for update using (tenant_id in (select public.current_tenant_ids())
                    and (public.has_role(array['admin_residencial', 'super_admin']) or estado_id <> 'entregado'))
  with check (tenant_id in (select public.current_tenant_ids()));
drop policy paquetes_delete_admin on public.paquetes;
create policy paquetes_delete_admin on public.paquetes
  for delete using (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));

drop policy grupos_entrega_update on public.paquete_grupos_entrega;
create policy grupos_entrega_update on public.paquete_grupos_entrega
  for update using (tenant_id in (select public.current_tenant_ids())
                    and (public.has_role(array['admin_residencial', 'super_admin']) or estado <> 'completado'))
  with check (tenant_id in (select public.current_tenant_ids()));
drop policy grupos_entrega_delete_admin on public.paquete_grupos_entrega;
create policy grupos_entrega_delete_admin on public.paquete_grupos_entrega
  for delete using (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));

drop policy tamanos_paquete_write_admin on public.tamanos_paquete;
create policy tamanos_paquete_write_admin on public.tamanos_paquete
  for insert with check (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));
drop policy tamanos_paquete_update_admin on public.tamanos_paquete;
create policy tamanos_paquete_update_admin on public.tamanos_paquete
  for update using (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));

drop policy prioridades_paquete_write_admin on public.prioridades_paquete;
create policy prioridades_paquete_write_admin on public.prioridades_paquete
  for insert with check (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));
drop policy prioridades_paquete_update_admin on public.prioridades_paquete;
create policy prioridades_paquete_update_admin on public.prioridades_paquete
  for update using (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));

drop policy empresas_paqueteria_write_admin on public.empresas_paqueteria;
create policy empresas_paqueteria_write_admin on public.empresas_paqueteria
  for insert with check (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));

drop policy plantillas_notificacion_write_admin on public.plantillas_notificacion;
create policy plantillas_notificacion_write_admin on public.plantillas_notificacion
  for insert with check (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));
drop policy plantillas_notificacion_update_admin on public.plantillas_notificacion;
create policy plantillas_notificacion_update_admin on public.plantillas_notificacion
  for update using (tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']));

drop policy audit_log_read_admin on public.audit_log;
create policy audit_log_read_admin on public.audit_log
  for select using ((tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin']))
                    or public.is_super_admin());

drop policy logos_insert_admin_propio_tenant on storage.objects;
create policy logos_insert_admin_propio_tenant on storage.objects
  for insert with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
    and public.has_role(array['admin_residencial', 'super_admin'])
  );
drop policy logos_update_admin_propio_tenant on storage.objects;
create policy logos_update_admin_propio_tenant on storage.objects
  for update using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
    and public.has_role(array['admin_residencial', 'super_admin'])
  );
drop policy logos_delete_admin_propio_tenant on storage.objects;
create policy logos_delete_admin_propio_tenant on storage.objects
  for delete using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
    and public.has_role(array['admin_residencial', 'super_admin'])
  );

-- ── 2. has_role_in_tenant ─────────────────────────────────────
drop function public.has_role_in_tenant(uuid, text[]);

-- ── 1. Helpers existentes: search_path original ───────────────
alter function public.current_tenant_ids() set search_path = public;
alter function public.is_super_admin() set search_path = public;

commit;
