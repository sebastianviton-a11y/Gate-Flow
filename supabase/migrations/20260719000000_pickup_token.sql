-- ============================================================
-- 20260719000000_pickup_token.sql
-- Token público de retiro para el flujo de QR — identifica un paquete
-- sin exponer datos personales en el código.
--
-- DECISIÓN: solo 2 columnas nuevas (pickup_token, pickup_token_created_at),
-- no 4. "¿Ya fue entregado?" y "¿está cancelado?" ya son 100% derivables
-- de estado_id/fecha_entrega, que ya existen — agregar
-- pickup_token_status/pickup_token_used_at hubiera creado una segunda
-- fuente de verdad que puede desincronizarse del estado real (el mismo
-- tipo de bug real que ya encontramos con el trigger de historial en
-- esta misma sesión). El token es válido mientras el paquete no esté
-- entregado/rechazado/devuelto — se resuelve leyendo el estado real,
-- nunca un campo espejo.
-- ============================================================

alter table public.paquetes
  add column pickup_token text,
  add column pickup_token_created_at timestamptz;

create unique index uq_paquetes_pickup_token on public.paquetes (pickup_token) where pickup_token is not null;

comment on column public.paquetes.pickup_token is
  'Token público único para el flujo de QR de retiro. No contiene ni deriva ningún dato personal — es un identificador opaco. Su validez se resuelve consultando estado_id/fecha_entrega del paquete, nunca un campo de estado espejo.';

-- Generador: 24 bytes aleatorios criptográficos (pgcrypto, ya habilitado
-- desde la migración 1) codificados en hex — 48 caracteres, imposible de
-- adivinar por fuerza bruta en un tiempo razonable.
create or replace function public.generar_pickup_token()
returns text
language sql
as $$
  select encode(gen_random_bytes(24), 'hex');
$$;

alter table public.paquetes
  alter column pickup_token set default public.generar_pickup_token(),
  alter column pickup_token_created_at set default now();

-- Backfill: paquetes existentes que sigan pendientes también necesitan
-- su token — los ya entregados/rechazados/devueltos no lo necesitan
-- (nunca se les va a generar un QR de retiro).
update public.paquetes
set pickup_token = public.generar_pickup_token(), pickup_token_created_at = now()
where pickup_token is null
  and estado_id in ('recibido', 'notificado');
