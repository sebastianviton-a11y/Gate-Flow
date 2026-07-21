-- ============================================================
-- 20260722000000_editar_unidades.sql
-- 1. Extiende public.unidades con los campos que la edición individual
--    necesita y que hoy no existen en ningún lado: teléfono secundario,
--    correo, notas. No se agregan calle/número/edificio/manzana como
--    campos nuevos del residente — esas tablas (calles, manzanas,
--    edificios, casas, departamentos) ya existen desde el Sprint 01
--    pero NUNCA se conectaron a ninguna pantalla real; el domicilio en
--    toda la app vive en unidades.identificador (texto libre, ej.
--    "Casa 45"). Partirlo en campos estructurados ahora sería un
--    cambio de arquitectura mucho más grande que "permitir editar", y
--    rompería cada lugar que ya asume identificador como una sola
--    cadena (búsqueda, WhatsApp, QR, historial).
--
-- 2. Cierra un hueco de RLS real: unidades_tenant_isolation era "for
--    all" sin distinguir rol — cualquier miembro del tenant, incluida
--    guardia, podía escribir en unidades directo por API. Se separa en
--    SELECT abierto (guardia necesita buscar unidades al registrar
--    paquetes) + escritura restringida a admin_residencial/super_admin,
--    exactamente lo que pide la especificación (punto 9).
-- ============================================================

alter table public.unidades
  add column contacto_telefono_secundario text,
  add column contacto_email text,
  add column notas text;

drop policy unidades_tenant_isolation on public.unidades;

create policy unidades_select on public.unidades
  for select using (tenant_id in (select public.current_tenant_ids()) or public.is_super_admin());

create policy unidades_insert_admin on public.unidades
  for insert with check (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );

create policy unidades_update_admin on public.unidades
  for update using (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  )
  with check (tenant_id in (select public.current_tenant_ids()));

create policy unidades_delete_admin on public.unidades
  for delete using (
    tenant_id in (select public.current_tenant_ids()) and public.has_role(array['admin_residencial', 'super_admin'])
  );
