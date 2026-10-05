-- ============================================================
-- ROLLBACK de la fase C (privilegios_fase_c.sql)
--
-- Recrea has_role() y el trigger transitorio de la fase A, y devuelve
-- otorgar_membresia() a su versión de la fase A, todo idéntico a como
-- quedó tras la fase A. Debe ejecutarse ANTES
-- de revertir la fase B (código) o la fase A.
--
-- Se ejecuta a mano (psql / SQL editor) y después se borra la fila
-- de la migración C en supabase_migrations.schema_migrations
-- (ver supabase/rollback/README.md).
-- ============================================================

begin;

-- has_role(): definición y grants originales (migración
-- 20260713230400_rls_policies.sql + privilegios por defecto).
create function public.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_tenants ut
    join public.roles r on r.id = ut.rol_id
    where ut.user_id = auth.uid() and ut.activo = true and r.clave = any(p_roles)
  );
$$;

grant execute on function public.has_role(text[]) to public, anon, authenticated, service_role;

-- Trigger transitorio (igual que en la fase A).
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

revoke execute on function public.vincular_membresia_heredada() from public, anon, authenticated;

-- otorgar_membresia: versión de la fase A (lista blanca con recepcion y
-- supervisor, y un admin del residencial puede otorgar
-- admin_residencial). CREATE OR REPLACE conserva sus grants.
create or replace function public.otorgar_membresia(
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

commit;
