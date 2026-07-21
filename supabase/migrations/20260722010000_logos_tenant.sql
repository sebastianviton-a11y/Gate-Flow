-- ============================================================
-- 20260722010000_logos_tenant.sql
-- Bucket para logos personalizados por residencial — el sistema se
-- vende a distintos residenciales, cada uno debe poder mostrar su
-- propia marca en vez de (o además de) la de GateFlow.
--
-- Público en lectura (a diferencia de "evidencia", que es privado) —
-- un logo no es información sensible, y necesita poder mostrarse en
-- el sidebar/menú sin pedir una URL firmada en cada carga de página.
-- Escritura restringida a admin del propio tenant, mismo patrón que
-- el bucket "evidencia" de la migración 12.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy logos_select_publico on storage.objects
  for select using (bucket_id = 'logos');

create policy logos_insert_admin_propio_tenant on storage.objects
  for insert with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
    and public.has_role(array['admin_residencial', 'super_admin'])
  );

create policy logos_update_admin_propio_tenant on storage.objects
  for update using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
    and public.has_role(array['admin_residencial', 'super_admin'])
  );

create policy logos_delete_admin_propio_tenant on storage.objects
  for delete using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
    and public.has_role(array['admin_residencial', 'super_admin'])
  );
