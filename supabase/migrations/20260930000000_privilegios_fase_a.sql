-- ============================================================
-- 20260930000000_privilegios_fase_a.sql
--
-- Cierra los riesgos de privilegios E1, E2 y E4 (fase A de 3).
-- Es compatible con el código actual de Admin: las invitaciones
-- siguen funcionando igual mientras la fase B (server actions que
-- usan otorgar_membresia) no esté desplegada.
--
--   E1  La metadata de auth.users (controlable por quien hace un
--       signUp público) ya no puede otorgar super_admin,
--       admin_empresa ni residente. El vínculo por metadata queda en
--       un trigger TRANSITORIO con lista blanca; la fase C lo borra.
--   E2a otorgar_membresia(): única vía para crear membresías, solo
--       para service_role, con lista blanca de roles y otorgante
--       validado DENTRO del tenant.
--   E2b user_tenants: desde el navegador solo UPDATE (activo), por un
--       admin del mismo tenant y nunca sobre una fila super_admin.
--   E4a Permisos de admin evaluados en el tenant de la fila
--       (has_role_in_tenant) en vez de "admin en cualquier tenant".
--   E4b tenant_id inmutable en las 19 tablas tenant-scoped (paquetes
--       ya lo tiene en trg_paquetes_proteger_campos).
--
-- Todas las funciones nuevas o reescritas usan search_path = '' y
-- referencias calificadas.
-- Rollback: supabase/rollback/20260930000000_privilegios_fase_a.down.sql
-- ============================================================


-- ── 1. Helpers existentes: search_path vacío ──────────────────
-- Mismas firmas y cuerpos (ya calificados); CREATE OR REPLACE
-- conserva los grants actuales.
create or replace function public.current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tenant_id
  from public.user_tenants
  where user_id = auth.uid() and activo = true;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_tenants ut
    join public.roles r on r.id = ut.rol_id
    where ut.user_id = auth.uid() and ut.activo = true and r.clave = 'super_admin'
  );
$$;


-- ── 2. has_role_in_tenant (E4a) ───────────────────────────────
-- A diferencia de has_role(), exige que el rol sea en EL tenant de la
-- fila. Solo responde sobre auth.uid(): no filtra datos de terceros.
-- CREATE OR REPLACE: producción ya tiene una versión manual (misma
-- firma y lógica, pero search_path = public y EXECUTE para PUBLIC/
-- anon/service_role). Esta la reemplaza; los REVOKE/GRANT de abajo
-- dejan los permisos explícitos sea cual sea el estado previo.
create or replace function public.has_role_in_tenant(p_tenant_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_tenants ut
    join public.roles r on r.id = ut.rol_id
    where ut.user_id = auth.uid()
      and ut.tenant_id = p_tenant_id
      and ut.activo = true
      and r.clave = any(p_roles)
  );
$$;

revoke execute on function public.has_role_in_tenant(uuid, text[]) from public, anon, service_role;
grant execute on function public.has_role_in_tenant(uuid, text[]) to authenticated;


-- ── 3. Políticas: has_role() → has_role_in_tenant() (E4a) ──────
-- ALTER POLICY conserva nombre, comando y roles. Las políticas de
-- UPDATE de admin también verifican el rol en el WITH CHECK.

alter policy tenants_update_admin on public.tenants
  using (id in (select public.current_tenant_ids())
         and public.has_role_in_tenant(id, array['admin_residencial', 'super_admin']))
  with check (id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(id, array['admin_residencial', 'super_admin']));

alter policy unidades_insert_admin on public.unidades
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));
alter policy unidades_update_admin on public.unidades
  using (tenant_id in (select public.current_tenant_ids())
         and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']))
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));
alter policy unidades_delete_admin on public.unidades
  using (tenant_id in (select public.current_tenant_ids())
         and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));

alter policy ubicaciones_insert_admin on public.ubicaciones
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));
alter policy ubicaciones_update_admin on public.ubicaciones
  using (tenant_id in (select public.current_tenant_ids())
         and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']))
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));
alter policy ubicaciones_delete_admin on public.ubicaciones
  using (tenant_id in (select public.current_tenant_ids())
         and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));

-- paquetes_update: el guardia sigue pudiendo actualizar paquetes no
-- entregados; solo el admin DEL TENANT puede tocar uno entregado.
alter policy paquetes_update on public.paquetes
  using (tenant_id in (select public.current_tenant_ids())
         and (public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin'])
              or estado_id <> 'entregado'))
  with check (tenant_id in (select public.current_tenant_ids()));
alter policy paquetes_delete_admin on public.paquetes
  using (tenant_id in (select public.current_tenant_ids())
         and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));

alter policy grupos_entrega_update on public.paquete_grupos_entrega
  using (tenant_id in (select public.current_tenant_ids())
         and (public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin'])
              or estado <> 'completado'))
  with check (tenant_id in (select public.current_tenant_ids()));
alter policy grupos_entrega_delete_admin on public.paquete_grupos_entrega
  using (tenant_id in (select public.current_tenant_ids())
         and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));

alter policy tamanos_paquete_write_admin on public.tamanos_paquete
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));
alter policy tamanos_paquete_update_admin on public.tamanos_paquete
  using (tenant_id in (select public.current_tenant_ids())
         and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']))
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));

alter policy prioridades_paquete_write_admin on public.prioridades_paquete
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));
alter policy prioridades_paquete_update_admin on public.prioridades_paquete
  using (tenant_id in (select public.current_tenant_ids())
         and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']))
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));

alter policy empresas_paqueteria_write_admin on public.empresas_paqueteria
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));

alter policy plantillas_notificacion_write_admin on public.plantillas_notificacion
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));
alter policy plantillas_notificacion_update_admin on public.plantillas_notificacion
  using (tenant_id in (select public.current_tenant_ids())
         and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']))
  with check (tenant_id in (select public.current_tenant_ids())
              and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']));

alter policy audit_log_read_admin on public.audit_log
  using ((tenant_id in (select public.current_tenant_ids())
          and public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']))
         or public.is_super_admin());

-- Logos: el tenant es la primera carpeta de la ruta del objeto.
alter policy logos_insert_admin_propio_tenant on storage.objects
  with check (bucket_id = 'logos'
              and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
              and public.has_role_in_tenant((storage.foldername(name))[1]::uuid,
                                            array['admin_residencial', 'super_admin']));
alter policy logos_update_admin_propio_tenant on storage.objects
  using (bucket_id = 'logos'
         and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
         and public.has_role_in_tenant((storage.foldername(name))[1]::uuid,
                                       array['admin_residencial', 'super_admin']));
alter policy logos_delete_admin_propio_tenant on storage.objects
  using (bucket_id = 'logos'
         and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
         and public.has_role_in_tenant((storage.foldername(name))[1]::uuid,
                                       array['admin_residencial', 'super_admin']));


-- ── 4. user_tenants desde el cliente: solo UPDATE (activo) (E2b) ─
-- El único uso real desde el navegador es activar/desactivar un
-- usuario en /usuarios. Altas y cambios de rol van por
-- otorgar_membresia() (service_role).
drop policy user_tenants_write_admin on public.user_tenants;

revoke insert, update, delete, truncate on public.user_tenants from anon, authenticated;
grant update (activo) on public.user_tenants to authenticated;

create policy user_tenants_update_activo_admin on public.user_tenants
  for update to authenticated
  using (
    public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin'])
    and not exists (select 1 from public.roles r where r.id = rol_id and r.clave = 'super_admin')
  )
  with check (
    public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin'])
    and not exists (select 1 from public.roles r where r.id = rol_id and r.clave = 'super_admin')
  );


-- ── 5. otorgar_membresia (E2a) ────────────────────────────────
-- SECURITY INVOKER: corre con los privilegios de service_role, que es
-- el único que puede ejecutarla. Nunca cambia el rol de una membresía
-- existente.
create function public.otorgar_membresia(
  p_user_id uuid,
  p_tenant_id uuid,
  p_rol_clave text,
  p_otorgado_por uuid
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_rol_id uuid;
  v_membresia_id uuid;
begin
  if p_user_id is null or p_tenant_id is null or p_rol_clave is null or p_otorgado_por is null then
    raise exception 'otorgar_membresia: faltan parámetros' using errcode = '22023';
  end if;

  if p_rol_clave not in ('admin_residencial', 'guardia', 'recepcion', 'supervisor') then
    raise exception 'otorgar_membresia: el rol % no se puede otorgar', p_rol_clave using errcode = '22023';
  end if;

  select r.id into v_rol_id from public.roles r where r.clave = p_rol_clave;
  if v_rol_id is null then
    raise exception 'otorgar_membresia: el rol % no existe', p_rol_clave using errcode = '22023';
  end if;

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'otorgar_membresia: el residencial % no existe', p_tenant_id using errcode = '22023';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'otorgar_membresia: el usuario % no existe', p_user_id using errcode = '22023';
  end if;

  -- El otorgante debe ser admin activo EN ese residencial, o super_admin.
  if not exists (
    select 1
    from public.user_tenants ut
    join public.roles r on r.id = ut.rol_id
    where ut.user_id = p_otorgado_por
      and ut.activo = true
      and ((ut.tenant_id = p_tenant_id and r.clave = 'admin_residencial') or r.clave = 'super_admin')
  ) then
    raise exception 'otorgar_membresia: el otorgante no administra este residencial' using errcode = '42501';
  end if;

  insert into public.user_tenants (user_id, tenant_id, rol_id, activo)
  values (p_user_id, p_tenant_id, v_rol_id, true)
  on conflict (user_id, tenant_id) do nothing
  returning id into v_membresia_id;

  if v_membresia_id is null then
    return 'ya_existia';
  end if;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_nuevos)
  values (p_tenant_id, p_otorgado_por, 'membresia.otorgada', 'user_tenants', v_membresia_id,
          jsonb_build_object('user_id', p_user_id, 'rol_clave', p_rol_clave));

  return 'creada';
end;
$$;

revoke execute on function public.otorgar_membresia(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.otorgar_membresia(uuid, uuid, text, uuid) to service_role;

-- Lo que otorgar_membresia lee y escribe como service_role. Con los
-- grants de mínimo privilegio (20260729100000) service_role ya tiene
-- SELECT en users y user_tenants; esto agrega el resto. En un
-- proyecto con los grants amplios de Supabase es un no-op.
grant select on public.roles, public.tenants to service_role;
grant insert on public.user_tenants, public.audit_log to service_role;


-- ── 6. tenant_id inmutable (E4b) ──────────────────────────────
-- Invariante de integridad, no de permisos: aplica a todos los roles,
-- incluidos service_role y postgres. paquetes conserva su trigger
-- propio (trg_paquetes_proteger_campos), que ya lo cubre.
create function public.fn_tenant_id_inmutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id no puede modificarse (tabla %)', tg_table_name;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_tenant_id_inmutable() from public, anon, authenticated;

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
    execute format(
      'create trigger %I before update of tenant_id on public.%I '
      'for each row execute function public.fn_tenant_id_inmutable()',
      'trg_' || t || '_tenant_id_inmutable', t);
  end loop;
end;
$$;


-- ── 7. Alta de usuarios: perfil y membresía separados (E1) ─────
-- handle_new_auth_user queda en su forma final: solo crea el perfil.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  return new;
end;
$$;

-- TRANSITORIO (lo borra la fase C): mantiene las invitaciones del
-- código actual, que viajan como metadata {tenant_id, rol_clave}, pero
-- ya solo para roles de la lista blanca. Corre después del perfil
-- porque los triggers del mismo evento se disparan en orden
-- alfabético (trg_handle_… < trg_vincular_…).
create function public.vincular_membresia_heredada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_rol_clave text;
  v_rol_id uuid;
begin
  v_rol_clave := new.raw_user_meta_data->>'rol_clave';
  if v_rol_clave is null
     or v_rol_clave not in ('admin_residencial', 'guardia', 'recepcion', 'supervisor') then
    return new;
  end if;

  v_tenant_id := (new.raw_user_meta_data->>'tenant_id')::uuid;
  if v_tenant_id is null then
    return new;
  end if;

  select r.id into v_rol_id from public.roles r where r.clave = v_rol_clave;
  if v_rol_id is not null then
    insert into public.user_tenants (user_id, tenant_id, rol_id, activo)
    values (new.id, v_tenant_id, v_rol_id, true)
    on conflict (user_id, tenant_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger trg_vincular_membresia_heredada
  after insert on auth.users
  for each row execute function public.vincular_membresia_heredada();

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.vincular_membresia_heredada() from public, anon, authenticated;
