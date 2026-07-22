-- ============================================================
-- 20260725000000_onboarding_invitaciones.sql
--
-- Prepara la base para el flujo de activacion por invitacion:
-- 1. Rastrea si un residencial ya completo el asistente de configuracion.
-- 2. Rastrea si un usuario ya acepto terminos y condiciones.
-- 3. Extiende el trigger de nuevos usuarios para que, cuando alguien
--    acepta una invitacion con metadata de tenant/rol, quede vinculado
--    automaticamente en user_tenants.
-- ============================================================

alter table public.tenants add column onboarding_completado boolean not null default false;

-- Datos de contacto del RESIDENCIAL como entidad (ej. teléfono de la
-- caseta, correo general de administración) — distintos de
-- admin_contacto_telefono/admin_contacto_email (que son de la persona
-- administradora, agregados en el sprint anterior). El Paso 2 del
-- asistente de configuración edita estos, no los del administrador.
alter table public.tenants add column telefono text;
alter table public.tenants add column correo text;

-- Los residenciales que YA existian antes de este sprint ya estan
-- configurados de verdad - no deben ver el asistente al siguiente
-- login de su administrador. Solo los residenciales NUEVOS, creados
-- de aqui en adelante, empiezan en false.
update public.tenants set onboarding_completado = true;

alter table public.users add column terminos_aceptados_en timestamptz;

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
