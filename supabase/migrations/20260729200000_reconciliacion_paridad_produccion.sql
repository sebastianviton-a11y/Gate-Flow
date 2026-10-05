-- ============================================================
-- Reconciliación controlada producción → repo (paridad necesaria).
--
-- Solo trae lo que el código actual (@ 59cd426) necesita y que
-- producción ya tiene por cambios hechos a mano que nunca llegaron a
-- una migración. Comparación de catálogos de solo lectura, octubre
-- 2026. Cada bloque es idempotente: sobre producción no cambia el
-- comportamiento (deja el mismo esquema, con search_path y EXECUTE
-- más estrictos).
--
--   1. incidencias.nivel_danio (+ check leve/moderado/grave)
--      Lo leen listarIncidencias, el detalle de incidencia y el
--      detalle/entrega de paquete en Guard; lo escribe
--      reportarIncidencia. Sin la columna: 42703 → "Algo salió mal".
--   2. incidencias_tipo_check con los 13 tipos de producción.
--   3. registrar_paquete_con_incidencia(...) — la llama
--      registrarPaqueteConIncidencia (@gateflow/paquetes).
--   4. fn_registrar_historial_paquete como SECURITY DEFINER: el
--      trigger AFTER de paquetes escribe paquete_historial, que no
--      tiene política INSERT ni grant de INSERT para authenticated.
--      Sin esto, registrar o entregar un paquete falla con 42501.
--   5. crear_grupo_entrega_separado / obtener_o_crear_grupo_entrega
--      con token de gen_random_uuid() (corrección de producción): con
--      gen_random_bytes() y search_path = public fallaban con 42883
--      en Supabase (pgcrypto vive en el schema extensions) y Guard no
--      podía registrar paquetes.
--
-- Fuera de alcance a propósito (documentado aparte): las políticas
-- con has_role_in_tenant (las reemplaza la migración de privilegios
-- fase A).
-- Rollback: supabase/rollback/20260729200000_reconciliacion_paridad_produccion.down.sql
-- ============================================================


-- ── 1. incidencias.nivel_danio ────────────────────────────────
alter table public.incidencias add column if not exists nivel_danio text;

alter table public.incidencias drop constraint if exists incidencias_nivel_danio_check;
alter table public.incidencias add constraint incidencias_nivel_danio_check
  check (nivel_danio is null or nivel_danio in ('leve', 'moderado', 'grave'));


-- ── 2. incidencias_tipo_check: 13 tipos ───────────────────────
alter table public.incidencias drop constraint if exists incidencias_tipo_check;
alter table public.incidencias add constraint incidencias_tipo_check
  check (tipo in (
    'danado', 'abierto', 'mojado', 'etiqueta_ilegible', 'destinatario_desconocido',
    'rechazado', 'devuelto', 'extraviado', 'golpeado', 'roto',
    'empaque_deteriorado', 'contenido_incompleto', 'otro'
  ));


-- ── 3. registrar_paquete_con_incidencia ───────────────────────
-- Mismo cuerpo que producción. Diferencias deliberadas:
--   * search_path = public, extensions (producción no lo fija y hereda
--     el de la sesión). No puede ser '': el INSERT en paquetes evalúa
--     el default pickup_token = generar_pickup_token(), que no fija
--     search_path y llama a gen_random_bytes() (pgcrypto, schema
--     extensions); con '' falla con 42883. Al ser SECURITY INVOKER no
--     hay riesgo de secuestro de search_path: corre con los permisos
--     de quien la llama.
--   * EXECUTE solo para authenticated (producción lo da a PUBLIC/anon).
-- SECURITY INVOKER: corre con los permisos y el RLS de quien llama
-- (paquetes_insert e incidencias_tenant_isolation exigen que el
-- tenant sea uno de los del usuario).
create or replace function public.registrar_paquete_con_incidencia(
  p_tenant_id uuid,
  p_unidad_id uuid,
  p_residente_id uuid,
  p_remitente text,
  p_empresa_paqueteria_id uuid,
  p_numero_guia text,
  p_tamano_id uuid,
  p_prioridad_id uuid,
  p_ubicacion_id uuid,
  p_notas text,
  p_recibido_por uuid,
  p_tipo_incidencia text,
  p_descripcion_incidencia text,
  p_nivel_danio text
)
returns table (paquete_id uuid, incidencia_id uuid)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_paquete_id uuid;
  v_incidencia_id uuid;
begin
  insert into public.paquetes (
    tenant_id, unidad_id, residente_id, remitente, empresa_paqueteria_id,
    numero_guia, tamano_id, prioridad_id, ubicacion_id, notas, recibido_por, estado_id
  ) values (
    p_tenant_id, p_unidad_id, p_residente_id, p_remitente, p_empresa_paqueteria_id,
    p_numero_guia, p_tamano_id, p_prioridad_id, p_ubicacion_id, p_notas, p_recibido_por, 'recibido'
  ) returning id into v_paquete_id;

  insert into public.incidencias (tenant_id, paquete_id, tipo, descripcion, nivel_danio, reportada_por)
  values (p_tenant_id, v_paquete_id, p_tipo_incidencia, p_descripcion_incidencia, p_nivel_danio, p_recibido_por)
  returning id into v_incidencia_id;

  return query select v_paquete_id, v_incidencia_id;
end;
$$;

revoke execute on function public.registrar_paquete_con_incidencia(
  uuid, uuid, uuid, text, uuid, text, uuid, uuid, uuid, text, uuid, text, text, text
) from public, anon, service_role;
grant execute on function public.registrar_paquete_con_incidencia(
  uuid, uuid, uuid, text, uuid, text, uuid, uuid, uuid, text, uuid, text, text, text
) to authenticated;


-- ── 4. fn_registrar_historial_paquete: SECURITY DEFINER ────────
-- Mismo cuerpo que repo y producción. Producción la tiene como
-- SECURITY DEFINER con search_path = public; aquí search_path = ''
-- (el cuerpo solo usa public.paquete_historial, calificado).
-- Es seguro como DEFINER porque el trigger es AFTER INSERT/UPDATE:
-- la fila de paquetes ya pasó el RLS (tenant del usuario) y el
-- historial toma tenant_id y paquete_id de esa misma fila.
-- EXECUTE solo se comprueba al crear el trigger, no al dispararse:
-- nadie necesita llamarla directamente.
create or replace function public.fn_registrar_historial_paquete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'UPDATE' and new.estado_id is distinct from old.estado_id) then
    insert into public.paquete_historial (tenant_id, paquete_id, estado_anterior_id, estado_nuevo_id, user_id)
    values (new.tenant_id, new.id, old.estado_id, new.estado_id, coalesce(new.entregado_por, new.recibido_por));
  elsif (tg_op = 'INSERT') then
    insert into public.paquete_historial (tenant_id, paquete_id, estado_anterior_id, estado_nuevo_id, user_id)
    values (new.tenant_id, new.id, null, new.estado_id, new.recibido_por);
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_registrar_historial_paquete() from public, anon, authenticated, service_role;


-- ── 5. Grupos de entrega: token con gen_random_uuid() ───────────
-- Misma lógica que el repo; el token pasa de
-- encode(gen_random_bytes(24), 'hex') a la fórmula de producción:
-- dos UUID v4 sin guiones = 64 caracteres hex en minúsculas, 244 bits
-- aleatorios de un CSPRNG (gen_random_uuid es nativo de Postgres 13+,
-- schema pg_catalog: no depende de pgcrypto ni de "extensions").
-- El código lo trata como texto opaco (URL /escanear/[token] y
-- .eq("token", …)); la unicidad la garantiza
-- paquete_grupos_entrega_token_key.
-- Endurecido respecto a producción:
--   * search_path = '' con todo calificado. El trigger
--     fn_asignar_codigo_grupo hereda ese search_path y ya usa
--     nextval('public.paquete_grupos_entrega_codigo_seq').
--   * EXECUTE solo para authenticated.
-- Ambas siguen SECURITY INVOKER: RLS de paquete_grupos_entrega exige
-- que el tenant sea uno de los del usuario.
create or replace function public.obtener_o_crear_grupo_entrega(
  p_tenant_id uuid,
  p_unidad_id uuid,
  p_residente_id uuid default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_grupo_id uuid;
begin
  v_grupo_id := public.buscar_grupo_abierto(p_tenant_id, p_unidad_id);

  if v_grupo_id is not null then
    if p_residente_id is not null then
      update public.paquete_grupos_entrega
      set residente_id = p_residente_id
      where id = v_grupo_id and residente_id is null;
    end if;
    return v_grupo_id;
  end if;

  insert into public.paquete_grupos_entrega (tenant_id, unidad_id, residente_id, token)
  values (
    p_tenant_id, p_unidad_id, p_residente_id,
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
      || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
  )
  returning id into v_grupo_id;

  return v_grupo_id;
end;
$$;

create or replace function public.crear_grupo_entrega_separado(
  p_tenant_id uuid,
  p_unidad_id uuid,
  p_residente_id uuid default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_grupo_id uuid;
begin
  insert into public.paquete_grupos_entrega (tenant_id, unidad_id, residente_id, token)
  values (
    p_tenant_id, p_unidad_id, p_residente_id,
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
      || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
  )
  returning id into v_grupo_id;

  return v_grupo_id;
end;
$$;

revoke execute on function public.obtener_o_crear_grupo_entrega(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.obtener_o_crear_grupo_entrega(uuid, uuid, uuid) to authenticated;
revoke execute on function public.crear_grupo_entrega_separado(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.crear_grupo_entrega_separado(uuid, uuid, uuid) to authenticated;
