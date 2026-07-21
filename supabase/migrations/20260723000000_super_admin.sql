-- ============================================================
-- 20260723000000_super_admin.sql
-- Extiende public.tenants (no crea tabla nueva) para el módulo de
-- Super Admin. tenants ya tenía RLS con SELECT/UPDATE correctos para
-- super_admin desde la migración 5 — pero NUNCA tuvo política de
-- INSERT ni DELETE, así que nadie podía crear ni eliminar un
-- residencial desde el cliente hasta ahora.
-- ============================================================

-- "Estado" del residencial como servicio (piloto/activo/suspendido) —
-- distinto de estado_geografico (Quintana Roo, etc.), que ya existía y
-- significa otra cosa. No se reutiliza `activo` (boolean) porque
-- "piloto" y "suspendido" no son lo mismo que "inactivo": un piloto
-- está activo pero en una fase distinta, y un suspendido puede seguir
-- teniendo datos visibles para soporte.
alter table public.tenants
  add column estado_servicio text not null default 'piloto'
    check (estado_servicio in ('piloto', 'activo', 'suspendido', 'cancelado')),
  add column plan_precio numeric,
  add column plan_fecha_inicio date,
  add column plan_fecha_renovacion date,
  -- Contacto del administrador principal capturado al crear el
  -- residencial — NO es una cuenta de acceso real todavía (crear un
  -- usuario de Supabase Auth exige la clave de servicio, que nunca
  -- debe vivir en el navegador). Se usa mientras no exista un vínculo
  -- real en user_tenants con rol admin_residencial; en cuanto exista,
  -- la pantalla de detalle debe preferir ese vínculo real sobre estos
  -- campos de contacto.
  add column admin_contacto_nombre text,
  add column admin_contacto_email text,
  add column admin_contacto_telefono text,
  add column observaciones text;

-- Los nombres de plan pedidos (piloto/starter/business) son nuevos —
-- se agregan a los que ya existían (trial/basico/pro/enterprise) en
-- vez de remplazarlos, para no invalidar filas existentes ni requerir
-- una migración de datos. "enterprise" ya era válido en ambos.
--
-- Se busca el nombre real de la restricción en vez de asumir
-- "tenants_plan_check" — es el nombre que Postgres genera por
-- convención para un check sin nombre explícito, pero buscarlo evita
-- que la migración falle si en algún punto se hubiera nombrado distinto.
do $$
declare
  v_nombre_restriccion text;
begin
  select con.conname into v_nombre_restriccion
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'tenants' and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%plan%';

  if v_nombre_restriccion is not null then
    execute format('alter table public.tenants drop constraint %I', v_nombre_restriccion);
  end if;

  alter table public.tenants add constraint tenants_plan_check
    check (plan in ('trial', 'basico', 'pro', 'enterprise', 'piloto', 'starter', 'business'));
end $$;

create policy tenants_insert_super_admin on public.tenants
  for insert with check (public.is_super_admin());

create policy tenants_delete_super_admin on public.tenants
  for delete using (public.is_super_admin());

-- ── Auditoría de impersonación ("Entrar como soporte") ──────────
-- No se crea sesión ni token de otro usuario real (eso exigiría la
-- clave de servicio) — super_admin simplemente ve el panel del
-- residencial CON SU PROPIA IDENTIDAD, bajo un contexto de tenant
-- distinto al suyo. Cada entrada/salida queda en audit_log, que ya
-- existe desde la migración 1 — no se crea una tabla nueva para esto.
comment on table public.audit_log is
  'Incluye eventos de impersonación de soporte (accion = superadmin.impersonacion_iniciada / superadmin.impersonacion_finalizada), además de los cambios de datos ya registrados desde antes.';
