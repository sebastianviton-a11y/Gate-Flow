-- ============================================================
-- ROLLBACK de 20261006000000_registro_trial.sql
--
-- Quita las cuatro funciones y las dos tablas (con sus políticas,
-- triggers e índices). Se pierden las filas de suscripciones (el
-- backfill se recrea al reaplicar la migración) y de
-- registro_intentos. NO toca tenants, empresas, usuarios ni
-- membresías: si hubo altas por /registro, se decide aparte qué hacer
-- con ellas.
--
-- Se ejecuta a mano y después se borra la fila de la migración:
--   delete from supabase_migrations.schema_migrations where version = '20261006000000';
-- ============================================================

begin;

drop function if exists public.crear_suscripcion_alta_manual(uuid);
drop function if exists public.revertir_cuenta_prueba(uuid);
drop function if exists public.crear_cuenta_prueba(uuid, text, text, integer, text, boolean);
drop function if exists public.registro_intento_resultado(uuid, text, text);
drop function if exists public.registro_intento_permitido(text, text);

drop table if exists public.registro_intentos;
drop table if exists public.suscripciones;

commit;
