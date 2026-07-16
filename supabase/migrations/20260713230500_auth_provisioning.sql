-- ============================================================
-- 20260713230500_auth_provisioning.sql
-- Sin esto, `user_tenants.user_id` (FK a public.users) no tiene fila a
-- la que apuntar cuando alguien se registra solo en Supabase Auth —
-- la app fallaría al intentar dar de alta la pertenencia de un usuario
-- nuevo a un tenant.
-- ============================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
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

create trigger trg_handle_new_auth_user
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
