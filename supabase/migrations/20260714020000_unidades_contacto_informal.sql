-- ============================================================
-- 20260714020000_unidades_contacto_informal.sql
-- Hallazgo real al diseñar la importación masiva (Sprint 03): `users.id`
-- referencia `auth.users(id)` — un residente sin cuenta de Supabase Auth
-- no puede tener una fila en `users`, así que la importación masiva no
-- puede crear `residentes_unidades` para nombres/teléfonos capturados
-- desde un Excel (casi nunca tienen cuenta todavía).
--
-- Solución: `unidades` gana un contacto informal (nombre/teléfono como
-- texto simple), independiente del modelo formal de `residentes_unidades`
-- + `users`. Cuando ese residente sí cree una cuenta (fuera del alcance
-- del MVP — el portal de residente no existe todavía), se vincula
-- formalmente vía `residentes_unidades` y el contacto informal queda
-- como respaldo/histórico, no se elimina (consistente con BR-13/49).
-- ============================================================

alter table public.unidades
  add column contacto_nombre text,
  add column contacto_telefono text;

comment on column public.unidades.contacto_nombre is
  'Nombre del residente sin cuenta formal (ej. importado desde Excel). No sustituye a residentes_unidades — es el dato disponible antes de que exista una cuenta.';
comment on column public.unidades.contacto_telefono is
  'Teléfono del contacto informal — usado para notificaciones hasta que exista un residente formal vinculado.';
