-- ============================================================
-- ROLLBACK de la fase C (privilegios_fase_c.sql)
--
-- Recrea has_role() y el trigger transitorio de la fase A,
-- idénticos a como quedaron tras la fase A. Debe ejecutarse ANTES
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

commit;
