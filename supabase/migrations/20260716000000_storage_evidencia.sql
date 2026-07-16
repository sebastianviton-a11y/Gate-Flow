-- ============================================================
-- 20260716000000_storage_evidencia.sql
-- Bucket de Storage para fotografías de paquetes/incidencias y firmas.
-- Hallazgo real: `paquete_fotografias.storage_path` existe desde
-- Sprint 02, pero el bucket y sus políticas nunca se crearon — staging
-- es el primer entorno donde esto se vuelve necesario de verdad.
--
-- Convención de ruta: {tenant_id}/{paquete_id}/{archivo} — el
-- aislamiento por tenant vive en la RUTA, verificado por policy, no
-- solo por convención de la aplicación (SECURITY_ARCHITECTURE.md §13:
-- "separación por tenant en rutas de almacenamiento").
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencia', 'evidencia', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- El primer segmento de la ruta debe ser exactamente el tenant_id del
-- usuario que sube/lee — storage.foldername(name) descompone "path/a/b"
-- en un array de segmentos; el [1] es el primer segmento (tenant_id).
create policy evidencia_select_propio_tenant on storage.objects
  for select using (
    bucket_id = 'evidencia'
    and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
  );

create policy evidencia_insert_propio_tenant on storage.objects
  for insert with check (
    bucket_id = 'evidencia'
    and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
  );

-- Sin policy de UPDATE/DELETE para `authenticated`: la evidencia no se
-- edita ni se elimina (BR-28), igual que su fila correspondiente en
-- paquete_fotografias/paquete_firmas — el bucket hereda la misma regla,
-- no una política de almacenamiento más permisiva que la de la tabla.
