-- ============================================================
-- 20261005180000_privilegios_fase_c.sql — fase C de 3
--
-- Requisitos (verificados en staging antes de aplicarla):
--   1. La fase A está aplicada (20260930000000).
--   2. La fase B (server actions con otorgar_membresia y sin
--      tenant_id/rol_clave en la metadata) está desplegada en Admin.
--   3. No quedan invitaciones pendientes emitidas por el código
--      anterior a B.
--
-- Efecto: la metadata de auth.users deja de crear membresías (E1
-- cerrado por completo, incluido el residuo de fase A: signUp con un
-- rol permitido en un tenant ajeno), se elimina has_role(), que ya
-- no usa ninguna política, y otorgar_membresia() queda limitada a los
-- roles que otorgan los flujos actuales: guardia (admin del
-- residencial o super_admin) y admin_residencial (solo super_admin).
-- Rollback: supabase/rollback/privilegios_fase_c.down.sql
-- ============================================================

-- Precondiciones: aborta sin cambiar nada si algo aún depende de
-- has_role() o si falta alguna pieza de la fase A.
do $$
begin
  if not exists (select 1 from pg_proc
                 where proname = 'otorgar_membresia' and pronamespace = 'public'::regnamespace) then
    raise exception 'Fase C abortada: la fase A no está aplicada (falta otorgar_membresia)';
  end if;

  if exists (select 1 from pg_policies
             where coalesce(qual, '') ~ '\mhas_role\(' or coalesce(with_check, '') ~ '\mhas_role\(') then
    raise exception 'Fase C abortada: hay políticas que aún usan has_role()';
  end if;

  if exists (select 1 from pg_proc p
             where p.prosrc ~ '\mhas_role\('
               and p.proname <> 'has_role'
               and p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)) then
    raise exception 'Fase C abortada: hay funciones que aún llaman a has_role()';
  end if;

  if exists (select 1 from pg_views
             where schemaname not in ('pg_catalog', 'information_schema')
               and definition ~ '\mhas_role\(') then
    raise exception 'Fase C abortada: hay vistas que aún usan has_role()';
  end if;
end;
$$;

drop trigger trg_vincular_membresia_heredada on auth.users;
drop function public.vincular_membresia_heredada();

-- Sin CASCADE: si algo no detectado arriba dependiera de has_role(),
-- el DROP falla y la migración entera se revierte.
drop function public.has_role(text[]);


-- otorgar_membresia: solo los roles que otorgan los flujos actuales.
--   guardia            ← admin_residencial de ESE residencial, o super_admin
--   admin_residencial  ← solo super_admin (flujo de Super Admin)
-- super_admin, admin_empresa, residente, supervisor, recepcion y
-- cualquier rol desconocido se rechazan (supervisor y recepcion no
-- tienen una app a la cual entrar). Misma firma: CREATE OR REPLACE
-- conserva el EXECUTE solo para service_role.
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

  if p_rol_clave not in ('admin_residencial', 'guardia') then
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

  -- admin_residencial solo lo otorga super_admin (flujo de Super Admin).
  if p_rol_clave = 'admin_residencial' then
    if not exists (
      select 1
      from public.user_tenants ut
      join public.roles r on r.id = ut.rol_id
      where ut.user_id = p_otorgado_por and ut.activo = true and r.clave = 'super_admin'
    ) then
      raise exception 'otorgar_membresia: solo super_admin puede otorgar admin_residencial' using errcode = '42501';
    end if;
  -- guardia: admin activo EN ese residencial, o super_admin.
  elsif not exists (
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
