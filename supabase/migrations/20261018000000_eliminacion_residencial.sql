-- ============================================================
-- Eliminación manual asistida de un residencial (opción A).
--
-- Borra los datos operativos de un residencial 30 días después de que
-- terminó su prueba o su suscripción. Lo ejecuta una persona del equipo
-- con scripts/eliminacion/eliminar-residencial.mjs (runbook en
-- docs/operations/ELIMINACION_DATOS.md); nada lo dispara solo.
--
--   1. eliminacion_residencial_simular   → simulación obligatoria: dice si
--      es elegible, qué se borraría y qué se conserva. No borra nada.
--      Si es elegible entrega un código válido 30 minutos.
--   2. eliminacion_residencial_ejecutar  → con el código y el nombre exacto
--      del residencial. Vuelve a revisar todo con bloqueo: si el cliente
--      contrató o algo cambió desde la simulación, se CANCELA sin borrar.
--      Borra los datos de la base en una sola transacción; ante cualquier
--      error no borra nada y queda «fallida».
--   3. eliminacion_residencial_completar → solo marca «completada» cuando
--      ya no quedan archivos en Storage ni cuentas de Auth pendientes (el
--      script los borra por la API, como manda Supabase).
--
-- Se conservan: aceptaciones_legales (evidencia; inmutable, sin FK) y
-- billing_eventos (registro de pagos; su FK pone tenant_id en null).
-- Las cuentas compartidas con otro residencial solo pierden la membresía.
-- El registro de la operación no guarda nombres, correos ni teléfonos.
--
-- Solo service_role ejecuta las tres funciones. Rollback:
-- supabase/rollback/20261018000000_eliminacion_residencial.down.sql
-- ============================================================

create table public.eliminaciones_residencial (
  id uuid primary key default gen_random_uuid(),
  -- Sin FK: el registro sobrevive al residencial que documenta.
  tenant_id uuid not null,
  empresa_id uuid,
  estado text not null check (estado in ('simulada', 'no_elegible', 'cancelada', 'fallida', 'en_curso', 'completada')),
  motivo text check (motivo is null or motivo ~ '^[a-z0-9_]{3,60}$'),
  -- Alias o número de ticket de quien opera; sin espacios ni @ (no un nombre ni un correo).
  operador text not null check (operador ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$'),
  fin_servicio timestamptz,
  huella_suscripcion text,
  codigo_sha256 text check (codigo_sha256 is null or codigo_sha256 ~ '^[0-9a-f]{64}$'),
  expira_en timestamptz,
  simulacion jsonb not null default '{}'::jsonb,
  resultado jsonb not null default '{}'::jsonb,
  -- Cuentas de Auth que el script debe borrar; se vacía al completar.
  cuentas_pendientes uuid[] not null default '{}',
  error_sqlstate text,
  error_objeto text,
  creada_en timestamptz not null default now(),
  ejecutada_en timestamptz,
  completada_en timestamptz
);

comment on table public.eliminaciones_residencial is
  'Registro auditable de la eliminación manual asistida de residenciales (20261018000000). Sin datos personales.';

create index eliminaciones_residencial_tenant_idx on public.eliminaciones_residencial (tenant_id);
-- Una sola eliminación en curso por residencial.
create unique index eliminaciones_residencial_en_curso_uidx on public.eliminaciones_residencial (tenant_id) where estado = 'en_curso';

alter table public.eliminaciones_residencial enable row level security;
revoke all on public.eliminaciones_residencial from public, anon, authenticated, service_role;

-- ── Ayudantes internos (sin EXECUTE para la API) ─────────────────────

-- ¿Se puede eliminar? Elegible solo si la prueba o la suscripción terminó
-- hace 30 días o más. Activa, en prueba, en impago o con una contratación
-- abierta: no. La huella detecta cualquier cambio desde la simulación.
create function public.eliminacion_residencial_servicio(
  p_tenant_id uuid,
  out elegible boolean,
  out motivo text,
  out fin_servicio timestamptz,
  out huella text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.suscripciones%rowtype;
begin
  elegible := false;
  if exists (
    select 1 from public.user_tenants ut join public.roles r on r.id = ut.rol_id
    where ut.tenant_id = p_tenant_id and r.clave = 'super_admin'
  ) then
    motivo := 'residencial_de_plataforma';
    return;
  end if;
  select * into s from public.suscripciones where tenant_id = p_tenant_id;
  if not found then
    motivo := 'sin_suscripcion';
    return;
  end if;
  huella := concat_ws('|', s.estado, s.updated_at, s.trial_ends_at, s.current_period_end,
                      s.cancel_at_period_end, s.impago_desde, s.provider_subscription_id);
  fin_servicio := greatest(s.trial_ends_at, s.current_period_end, s.impago_desde + interval '7 days');
  if s.estado = 'active' then
    motivo := 'suscripcion_activa';
  elsif s.estado = 'past_due' then
    motivo := 'suscripcion_en_impago';
  elsif s.estado = 'trialing' and (s.trial_ends_at is null or now() < s.trial_ends_at) then
    motivo := 'prueba_en_curso';
  elsif fin_servicio is null then
    motivo := 'fin_desconocido';
  elsif fin_servicio > now() - interval '30 days' then
    motivo := 'menos_de_30_dias';
  elsif exists (
    select 1 from public.billing_checkouts c
    where c.tenant_id = p_tenant_id and c.estado = 'created' and c.expires_at > now()
  ) then
    motivo := 'contratacion_en_curso';
  else
    elegible := true;
  end if;
end;
$$;

-- Filas del residencial en cada tabla (y vista materializada) con tenant_id,
-- salvo lo que se conserva. Solo las que tienen filas: {} = nada.
create function public.eliminacion_residencial_conteo(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tabla text;
  v_n bigint;
  v_conteo jsonb := '{}'::jsonb;
begin
  if exists (select 1 from public.tenants where id = p_tenant_id) then
    v_conteo := jsonb_build_object('tenants', 1);
  end if;
  for v_tabla in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'm')
      and c.relname not in ('aceptaciones_legales', 'billing_eventos', 'eliminaciones_residencial')
    order by c.relname
  loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tabla) into v_n using p_tenant_id;
    if v_n > 0 then
      v_conteo := v_conteo || jsonb_build_object(v_tabla, v_n);
    end if;
  end loop;
  return v_conteo;
end;
$$;

-- Personas con cuenta en el residencial (miembros y residentes con usuario).
-- Compartida = tiene membresía o unidad en otro residencial (incluye Super Admin).
create function public.eliminacion_residencial_cuentas(p_tenant_id uuid)
returns table (user_id uuid, compartida boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with candidatas as (
    select ut.user_id from public.user_tenants ut where ut.tenant_id = p_tenant_id
    union
    select ru.user_id from public.residentes_unidades ru where ru.tenant_id = p_tenant_id and ru.user_id is not null
  )
  select c.user_id,
         exists (select 1 from public.user_tenants o where o.user_id = c.user_id and o.tenant_id <> p_tenant_id)
         or exists (select 1 from public.residentes_unidades o where o.user_id = c.user_id and o.tenant_id <> p_tenant_id)
  from candidatas c;
$$;

-- ¿Alguna fila que se conserva apunta a la cuenta de Auth sin ON DELETE
-- CASCADE/SET NULL? Entonces Auth no la podría borrar: se conserva.
create function public.eliminacion_residencial_cuenta_referenciada(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f record;
  v_hay boolean;
begin
  for f in
    select k.conrelid::regclass as tabla, a.attname as columna
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
      and k.confdeltype in ('a', 'r') and cardinality(k.conkey) = 1
  loop
    execute format('select exists (select 1 from %s where %I = $1)', f.tabla, f.columna) into v_hay using p_user_id;
    if v_hay then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Archivos del residencial en Storage: todo lo que está bajo «<tenant_id>/»
-- en cualquier bucket (evidencia y logos hoy).
create function public.eliminacion_residencial_archivos(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(bucket_id, n), '{}'::jsonb)
  from (
    select o.bucket_id, count(*) as n
    from storage.objects o
    where split_part(o.name, '/', 1) = p_tenant_id::text
    group by o.bucket_id
  ) x;
$$;

-- ── 1. Simulación (obligatoria) ──────────────────────────────────────

create function public.eliminacion_residencial_simular(p_tenant_id uuid, p_operador text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants%rowtype;
  s record;
  v_codigo text;
  v_id uuid;
  v_simulacion jsonb;
  v_estado_suscripcion text;
begin
  if p_operador is null or p_operador !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$' then
    raise exception 'eliminacion_residencial: operador inválido (alias o ticket, sin espacios ni @)' using errcode = '22023';
  end if;
  select * into t from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'eliminacion_residencial: residencial_inexistente' using errcode = '22023';
  end if;
  select * into s from public.eliminacion_residencial_servicio(p_tenant_id);
  select estado into v_estado_suscripcion from public.suscripciones where tenant_id = p_tenant_id;

  v_simulacion := jsonb_build_object(
    'pais', t.pais,
    'estado_servicio', t.estado_servicio,
    'suscripcion', jsonb_build_object('estado', v_estado_suscripcion, 'fin_servicio', s.fin_servicio),
    'datos', public.eliminacion_residencial_conteo(p_tenant_id),
    'archivos', public.eliminacion_residencial_archivos(p_tenant_id),
    'cuentas', (
      select jsonb_build_object(
        'exclusivas', count(*) filter (where not c.compartida),
        'compartidas', count(*) filter (where c.compartida))
      from public.eliminacion_residencial_cuentas(p_tenant_id) c),
    'se_conservan', jsonb_build_object(
      'aceptaciones_legales', (select count(*) from public.aceptaciones_legales a where a.tenant_id = p_tenant_id),
      'billing_eventos', (select count(*) from public.billing_eventos b where b.tenant_id = p_tenant_id)),
    'empresa_compartida', t.empresa_id is not null
      and exists (select 1 from public.tenants o where o.empresa_id = t.empresa_id and o.id <> t.id)
  );

  if s.elegible then
    v_codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  end if;
  insert into public.eliminaciones_residencial
    (tenant_id, empresa_id, estado, motivo, operador, fin_servicio, huella_suscripcion, codigo_sha256, expira_en, simulacion)
  values
    (p_tenant_id, t.empresa_id,
     case when s.elegible then 'simulada' else 'no_elegible' end,
     s.motivo, p_operador, s.fin_servicio, s.huella,
     case when s.elegible then encode(sha256(convert_to(v_codigo, 'UTF8')), 'hex') end,
     case when s.elegible then now() + interval '30 minutes' end,
     v_simulacion)
  returning id into v_id;

  -- El nombre y el código se devuelven para verificar y confirmar; no se guardan.
  return v_simulacion || jsonb_build_object(
    'eliminacion_id', v_id,
    'elegible', s.elegible,
    'motivo', s.motivo,
    'codigo', v_codigo,
    'expira_en', case when s.elegible then now() + interval '30 minutes' end,
    'residencial', jsonb_build_object('id', t.id, 'nombre', t.nombre));
end;
$$;

-- ── 2. Ejecución ─────────────────────────────────────────────────────

create function public.eliminacion_residencial_ejecutar(p_eliminacion_id uuid, p_codigo text, p_nombre_confirmado text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.eliminaciones_residencial%rowtype;
  t public.tenants%rowtype;
  s record;
  v_u uuid;
  v_exclusivas uuid[];
  v_eliminadas uuid[] := '{}';
  v_compartidas int;
  v_referenciadas int := 0;
  v_datos jsonb;
  v_conservados jsonb;
  v_restos jsonb;
  v_empresa_eliminada boolean := false;
  v_sqlstate text;
  v_tabla text;
  v_restriccion text;
begin
  select * into r from public.eliminaciones_residencial where id = p_eliminacion_id for update;
  if not found then
    raise exception 'eliminacion_residencial: simulacion_inexistente' using errcode = '22023';
  end if;
  if r.estado <> 'simulada' then
    raise exception 'eliminacion_residencial: simulacion_no_utilizable (%)', r.estado using errcode = '22023';
  end if;
  if r.expira_en <= now() then
    raise exception 'eliminacion_residencial: simulacion_vencida' using errcode = '22023';
  end if;
  if p_codigo is null or encode(sha256(convert_to(upper(btrim(p_codigo)), 'UTF8')), 'hex') <> r.codigo_sha256 then
    raise exception 'eliminacion_residencial: codigo_incorrecto' using errcode = '22023';
  end if;
  select * into t from public.tenants where id = r.tenant_id for update;
  if not found then
    raise exception 'eliminacion_residencial: residencial_inexistente' using errcode = '22023';
  end if;
  if p_nombre_confirmado is null or btrim(p_nombre_confirmado) <> btrim(t.nombre) then
    raise exception 'eliminacion_residencial: nombre_no_coincide' using errcode = '22023';
  end if;

  -- Con la suscripción bloqueada, un webhook o un Super Admin que la
  -- cambie espera a que esto termine (y después ya no hay residencial).
  perform 1 from public.suscripciones where tenant_id = r.tenant_id for update;
  select * into s from public.eliminacion_residencial_servicio(r.tenant_id);
  if not s.elegible or s.huella is distinct from r.huella_suscripcion then
    update public.eliminaciones_residencial
       set estado = 'cancelada',
           motivo = case when not s.elegible then s.motivo else 'cambio_desde_la_simulacion' end,
           ejecutada_en = now()
     where id = r.id;
    return jsonb_build_object('ok', false, 'estado', 'cancelada',
      'motivo', case when not s.elegible then s.motivo else 'cambio_desde_la_simulacion' end);
  end if;

  begin
    v_exclusivas := array(select c.user_id from public.eliminacion_residencial_cuentas(r.tenant_id) c where not c.compartida);
    select count(*) into v_compartidas from public.eliminacion_residencial_cuentas(r.tenant_id) c where c.compartida;
    v_datos := public.eliminacion_residencial_conteo(r.tenant_id);
    v_conservados := jsonb_build_object(
      'aceptaciones_legales', (select count(*) from public.aceptaciones_legales a where a.tenant_id = r.tenant_id),
      'billing_eventos', (select count(*) from public.billing_eventos b where b.tenant_id = r.tenant_id));

    -- Todo lo operativo cuelga del residencial con ON DELETE CASCADE.
    delete from public.tenants where id = r.tenant_id;
    if t.empresa_id is not null and not exists (select 1 from public.tenants o where o.empresa_id = t.empresa_id) then
      delete from public.empresas where id = t.empresa_id;
      v_empresa_eliminada := true;
    end if;

    -- Perfiles exclusivos de este residencial; la cuenta de Auth la borra el script.
    foreach v_u in array v_exclusivas loop
      if exists (select 1 from public.user_tenants o where o.user_id = v_u)
         or exists (select 1 from public.residentes_unidades o where o.user_id = v_u) then
        v_compartidas := v_compartidas + 1;
        continue;
      end if;
      if public.eliminacion_residencial_cuenta_referenciada(v_u) then
        v_referenciadas := v_referenciadas + 1;
        continue;
      end if;
      begin
        delete from public.users where id = v_u;
        v_eliminadas := v_eliminadas || v_u;
      exception when foreign_key_violation then
        v_referenciadas := v_referenciadas + 1;
      end;
    end loop;

    -- Los agregados del panel también llevan tenant_id.
    perform public.refrescar_dashboard();
    v_restos := public.eliminacion_residencial_conteo(r.tenant_id);
    if v_restos <> '{}'::jsonb then
      raise exception 'eliminacion_residencial: quedaron datos del residencial' using errcode = 'P0001';
    end if;

    update public.eliminaciones_residencial
       set estado = 'en_curso',
           ejecutada_en = now(),
           cuentas_pendientes = v_eliminadas,
           resultado = jsonb_build_object(
             'datos_eliminados', v_datos,
             'empresa_eliminada', v_empresa_eliminada,
             'cuentas', jsonb_build_object(
               'exclusivas', cardinality(v_eliminadas),
               'compartidas', v_compartidas,
               'conservadas_por_referencias', v_referenciadas),
             'se_conservan', v_conservados)
     where id = r.id;
  exception when others then
    -- Todo lo de este bloque se deshizo. Se guarda solo el código y el
    -- objeto (nunca el mensaje: puede traer valores de las filas).
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_tabla = table_name, v_restriccion = constraint_name;
    update public.eliminaciones_residencial
       set estado = 'fallida',
           ejecutada_en = now(),
           error_sqlstate = v_sqlstate,
           error_objeto = nullif(concat_ws('.', nullif(v_tabla, ''), nullif(v_restriccion, '')), '')
     where id = r.id;
    return jsonb_build_object('ok', false, 'estado', 'fallida', 'sqlstate', v_sqlstate);
  end;

  return jsonb_build_object('ok', true, 'estado', 'en_curso', 'eliminacion_id', r.id,
    'archivos', public.eliminacion_residencial_archivos(r.tenant_id),
    'cuentas_pendientes', cardinality(v_eliminadas));
end;
$$;

-- ── 3. Cierre: solo con Storage y Auth vacíos ────────────────────────

create function public.eliminacion_residencial_completar(p_eliminacion_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.eliminaciones_residencial%rowtype;
  v_total bigint;
  v_archivos jsonb;
  v_cuentas uuid[];
begin
  select * into r from public.eliminaciones_residencial where id = p_eliminacion_id for update;
  if not found then
    raise exception 'eliminacion_residencial: eliminacion_inexistente' using errcode = '22023';
  end if;
  if r.estado = 'completada' then
    return jsonb_build_object('ok', true, 'estado', 'completada', 'completada_en', r.completada_en);
  end if;
  if r.estado <> 'en_curso' then
    return jsonb_build_object('ok', false, 'estado', r.estado, 'motivo', r.motivo);
  end if;

  select count(*) into v_total from storage.objects o where split_part(o.name, '/', 1) = r.tenant_id::text;
  v_cuentas := array(select u.id from auth.users u where u.id = any (r.cuentas_pendientes) order by u.id);

  if v_total = 0 and cardinality(v_cuentas) = 0 and public.eliminacion_residencial_conteo(r.tenant_id) = '{}'::jsonb then
    update public.eliminaciones_residencial
       set estado = 'completada', completada_en = now(), cuentas_pendientes = '{}'
     where id = r.id;
    return jsonb_build_object('ok', true, 'estado', 'completada', 'completada_en', now());
  end if;

  -- Lo que falta, por tandas de hasta 1000 archivos.
  select coalesce(jsonb_object_agg(bucket_id, nombres), '{}'::jsonb) into v_archivos
  from (
    select x.bucket_id, jsonb_agg(x.name order by x.name) as nombres
    from (
      select o.bucket_id, o.name from storage.objects o
      where split_part(o.name, '/', 1) = r.tenant_id::text
      order by o.bucket_id, o.name
      limit 1000
    ) x
    group by x.bucket_id
  ) y;
  return jsonb_build_object('ok', false, 'estado', 'en_curso', 'tenant_id', r.tenant_id,
    'archivos_pendientes', v_total, 'archivos', v_archivos, 'cuentas_pendientes', to_jsonb(v_cuentas));
end;
$$;

-- ── Permisos ─────────────────────────────────────────────────────────

revoke all on function public.eliminacion_residencial_servicio(uuid) from public, anon, authenticated, service_role;
revoke all on function public.eliminacion_residencial_conteo(uuid) from public, anon, authenticated, service_role;
revoke all on function public.eliminacion_residencial_cuentas(uuid) from public, anon, authenticated, service_role;
revoke all on function public.eliminacion_residencial_cuenta_referenciada(uuid) from public, anon, authenticated, service_role;
revoke all on function public.eliminacion_residencial_archivos(uuid) from public, anon, authenticated, service_role;
revoke all on function public.eliminacion_residencial_simular(uuid, text) from public, anon, authenticated;
revoke all on function public.eliminacion_residencial_ejecutar(uuid, text, text) from public, anon, authenticated;
revoke all on function public.eliminacion_residencial_completar(uuid) from public, anon, authenticated;
grant execute on function public.eliminacion_residencial_simular(uuid, text) to service_role;
grant execute on function public.eliminacion_residencial_ejecutar(uuid, text, text) to service_role;
grant execute on function public.eliminacion_residencial_completar(uuid) to service_role;
