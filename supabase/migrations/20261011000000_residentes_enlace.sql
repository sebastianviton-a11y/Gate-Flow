-- ============================================================
-- 20261011000000_residentes_enlace.sql
-- Registro de residentes por enlace compartible.
--
-- El administrador comparte un enlace; cada residente manda nombre,
-- apellido, dirección y WhatsApp. Las respuestas quedan PENDIENTES y
-- solo entran al listado operativo cuando el administrador las aprueba.
--
-- Reutiliza el modelo existente:
--   unidades             la vivienda (dirección = identificador) y su
--                        contacto principal (contacto_nombre/telefono).
--   residentes_unidades  varias personas por vivienda. Desde aquí admite
--                        personas SIN cuenta (origen 'enlace'): nombre,
--                        apellido y teléfono; tipo_relacion queda vacío
--                        si no se conoce (no se asume propietario).
--
-- 1. unidades.tipo deja de ser obligatorio (ya no se captura). Se
--    conservan los valores existentes; nunca se asigna uno por defecto.
-- 2. residentes_unidades: personas sin cuenta. paquetes: a quién se
--    avisó (destinatario elegido por la guardia, misma vivienda).
-- 3. residentes_enlaces: un enlace activo por residencial. Token de 64
--    caracteres hex con 244 bits aleatorios efectivos (generador fuerte
--    de Postgres); revocar = activo false.
-- 4. residentes_solicitudes: lo que llega por el enlace (pendiente →
--    aprobada | rechazada). Solo los administradores del residencial
--    la leen; nadie la escribe directo: todo pasa por las funciones.
-- 5. Funciones:
--      públicas (solo service_role, las llama el servidor del panel):
--        residentes_enlace_publico, residentes_solicitud_crear
--      administración (authenticated; validan rol en EL residencial):
--        residentes_enlace_generar, residentes_enlace_desactivar,
--        residentes_solicitudes_revision, residentes_solicitud_aprobar,
--        residentes_solicitud_rechazar, residentes_adicional_actualizar,
--        residentes_adicional_quitar
--    Ninguna aprobación sobrescribe datos: el contacto de la vivienda
--    solo se completa si está vacío; si no, la persona se agrega como
--    residente adicional.
--
-- Rollback: supabase/rollback/20261011000000_residentes_enlace.down.sql
-- (aborta si ya hay solicitudes, personas sin cuenta o viviendas sin
-- tipo: en ese caso, restaurar el respaldo).
-- ============================================================


-- ── 1. unidades.tipo opcional ─────────────────────────────────
alter table public.unidades alter column tipo drop not null;
comment on column public.unidades.tipo is
  'Casa o departamento. Opcional desde 20261011 (ya no se captura): se conservan los valores existentes y nunca se asigna uno por defecto.';


-- ── 2. residentes_unidades: personas sin cuenta ───────────────
alter table public.residentes_unidades
  alter column user_id drop not null,
  alter column tipo_relacion drop not null,
  add column nombre text,
  add column apellido text,
  add column telefono text,
  add column origen text not null default 'cuenta',
  add column solicitud_id uuid;

alter table public.residentes_unidades
  add constraint chk_residente_origen check (origen in ('cuenta', 'enlace')),
  add constraint chk_residente_identidad check (
    (origen = 'cuenta' and user_id is not null)
    or (origen = 'enlace' and user_id is null and nombre is not null and apellido is not null and telefono is not null)
  ),
  add constraint chk_residente_nombre check (nombre is null or char_length(nombre) between 1 and 60),
  add constraint chk_residente_apellido check (apellido is null or char_length(apellido) between 1 and 60),
  add constraint chk_residente_telefono check (telefono is null or telefono ~ '^(549|52)[1-9][0-9]{9}$');

-- La misma persona (mismo WhatsApp) no se repite en una vivienda.
create unique index uq_residentes_unidades_unidad_telefono
  on public.residentes_unidades (unidad_id, telefono)
  where telefono is not null and fecha_fin is null;
create index idx_residentes_unidades_tenant_telefono
  on public.residentes_unidades (tenant_id, telefono)
  where telefono is not null;

comment on column public.residentes_unidades.origen is
  'cuenta: persona con usuario (user_id). enlace: persona sin cuenta aprobada desde el registro por enlace (nombre, apellido, telefono).';
comment on column public.residentes_unidades.telefono is
  'WhatsApp normalizado (549… o 52…, solo dígitos) de una persona sin cuenta.';


-- ── 2b. paquetes: a quién se avisó ────────────────────────────
-- La guardia elige el destinatario entre el contacto de la vivienda y
-- las personas aprobadas. Queda en el PAQUETE (antes solo en la
-- notificación): nombre y teléfono tal como se avisó y, si es una
-- persona de residentes_unidades, su id. Las filas existentes quedan
-- en NULL. residente_id (usuarios con cuenta) no cambia.
alter table public.paquetes
  add column destinatario_nombre text,
  add column destinatario_telefono text,
  add column destinatario_residente_id uuid references public.residentes_unidades (id) on delete set null;
alter table public.paquetes
  add constraint chk_paquete_destinatario_nombre check (destinatario_nombre is null or char_length(destinatario_nombre) between 1 and 200),
  add constraint chk_paquete_destinatario_telefono check (destinatario_telefono is null or char_length(destinatario_telefono) between 1 and 40);
create index idx_paquetes_destinatario_residente on public.paquetes (destinatario_residente_id) where destinatario_residente_id is not null;

-- La persona elegida tiene que ser de la MISMA vivienda del paquete (y
-- por lo tanto del mismo residencial). Lee la tabla real, no lo que la
-- RLS del que llama deja ver.
create function public.fn_residente_paquete_destinatario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.destinatario_residente_id is not null and not exists (
       select 1 from public.residentes_unidades r
       where r.id = new.destinatario_residente_id and r.unidad_id = new.unidad_id) then
    raise exception 'el destinatario no pertenece a la vivienda del paquete' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_residente_paquete_destinatario() from public, anon, authenticated, service_role;
create trigger trg_paquetes_destinatario_vivienda
  before insert or update of destinatario_residente_id, unidad_id on public.paquetes
  for each row execute function public.fn_residente_paquete_destinatario();

comment on column public.paquetes.destinatario_nombre is
  'A quién avisó la guardia al recibir el paquete (copia del nombre en ese momento). NULL en paquetes anteriores a 20261011 o con residente_id.';
comment on column public.paquetes.destinatario_residente_id is
  'Persona de residentes_unidades elegida como destinataria (misma vivienda). NULL si fue el contacto de la vivienda.';


-- ── 3. residentes_enlaces ─────────────────────────────────────
create table public.residentes_enlaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  activo boolean not null default true,
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revocado_en timestamptz,
  revocado_por uuid references auth.users (id) on delete set null,
  constraint chk_residentes_enlace_revocado check (activo = (revocado_en is null)),
  constraint uq_residentes_enlaces_id_tenant unique (id, tenant_id)
);
create unique index uq_residentes_enlaces_un_activo on public.residentes_enlaces (tenant_id) where activo;
create trigger trg_residentes_enlaces_tenant_id_inmutable before update of tenant_id on public.residentes_enlaces
  for each row execute function public.fn_tenant_id_inmutable();

alter table public.residentes_enlaces enable row level security;
-- Solo la administración del residencial ve el enlace (para copiarlo).
-- El guardia no: el enlace permite cargar datos en nombre del residencial.
create policy residentes_enlaces_select_admin on public.residentes_enlaces
  for select to authenticated
  using (public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']) or public.is_super_admin());

revoke all on public.residentes_enlaces from public, anon, authenticated, service_role;
grant select on public.residentes_enlaces to authenticated;

comment on table public.residentes_enlaces is
  'Enlace compartible para que los residentes carguen sus datos. Uno activo por residencial; regenerar o desactivar lo revoca de inmediato.';


-- ── 4. residentes_solicitudes ─────────────────────────────────
create table public.residentes_solicitudes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  enlace_id uuid not null,
  nombre text not null check (char_length(nombre) between 1 and 60),
  apellido text not null check (char_length(apellido) between 1 and 60),
  direccion text not null check (char_length(direccion) between 2 and 120),
  telefono text not null check (telefono ~ '^(549|52)[1-9][0-9]{9}$'),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  resultado text check (resultado in ('vivienda_nueva', 'contacto_principal', 'residente_adicional')),
  motivo_rechazo text check (motivo_rechazo in ('duplicado', 'datos_incorrectos', 'no_reside', 'otro')),
  corregida boolean not null default false,
  unidad_id uuid references public.unidades (id) on delete set null,
  residente_unidad_id uuid references public.residentes_unidades (id) on delete set null,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  revisado_por uuid references auth.users (id) on delete set null,
  revisado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_residentes_solicitudes_enlace foreign key (enlace_id, tenant_id)
    references public.residentes_enlaces (id, tenant_id) on delete cascade,
  constraint chk_residentes_solicitud_estado check (
    (estado = 'pendiente' and resultado is null and motivo_rechazo is null and revisado_en is null)
    or (estado = 'aprobada' and resultado is not null and motivo_rechazo is null and revisado_en is not null)
    or (estado = 'rechazada' and resultado is null and motivo_rechazo is not null and revisado_en is not null)
  )
);
create index idx_residentes_solicitudes_tenant_estado on public.residentes_solicitudes (tenant_id, estado, created_at desc);
create index idx_residentes_solicitudes_tenant_telefono on public.residentes_solicitudes (tenant_id, telefono) where estado = 'pendiente';
create index idx_residentes_solicitudes_enlace on public.residentes_solicitudes (enlace_id, created_at);
create index idx_residentes_solicitudes_ip on public.residentes_solicitudes (ip_hash, created_at) where ip_hash is not null;

create trigger trg_residentes_solicitudes_updated_at before update on public.residentes_solicitudes
  for each row execute function public.set_updated_at();
create trigger trg_residentes_solicitudes_tenant_id_inmutable before update of tenant_id on public.residentes_solicitudes
  for each row execute function public.fn_tenant_id_inmutable();

alter table public.residentes_unidades
  add constraint fk_residentes_unidades_solicitud foreign key (solicitud_id)
    references public.residentes_solicitudes (id) on delete set null;

alter table public.residentes_solicitudes enable row level security;
-- Pendientes y revisadas: solo la administración del residencial. El
-- guardia no las ve, así que nunca aparecen como destinatarios.
create policy residentes_solicitudes_select_admin on public.residentes_solicitudes
  for select to authenticated
  using (public.has_role_in_tenant(tenant_id, array['admin_residencial', 'super_admin']) or public.is_super_admin());

revoke all on public.residentes_solicitudes from public, anon, authenticated, service_role;
grant select on public.residentes_solicitudes to authenticated;

comment on table public.residentes_solicitudes is
  'Datos enviados por residentes desde el enlace del residencial. Pendientes hasta que la administración los aprueba o rechaza.';


-- ── 5. Funciones auxiliares (sin EXECUTE para nadie) ──────────

-- Recorta y colapsa espacios repetidos; no cambia ningún otro carácter.
create function public.fn_residente_texto_limpio(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p, ''), E' \t\r\n '), E'[\\s ]+', ' ', 'g');
$$;

-- Letras latinas (con acentos y ñ/ü), separadas por un espacio,
-- apóstrofo o guion. Mismo criterio que el validador del navegador.
create function public.fn_residente_nombre_valido(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
    and pg_catalog.char_length(p) between 1 and 60
    and p ~ E'^[A-Za-zÀ-ÖØ-öø-ɏ]+([ ''’-][A-Za-zÀ-ÖØ-öø-ɏ]+)*$';
$$;

create function public.fn_residente_direccion_valida(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
    and pg_catalog.char_length(p) between 2 and 120
    and p !~ '[[:cntrl:]]'
    and p ~ E'[0-9A-Za-zÀ-ÖØ-öø-ɏ]';
$$;

-- WhatsApp ya normalizado según el país del residencial.
create function public.fn_residente_telefono_valido(p_telefono text, p_pais text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_pais
    when 'AR' then coalesce(p_telefono ~ '^549[1-9][0-9]{9}$', false)
    when 'MX' then coalesce(p_telefono ~ '^52[1-9][0-9]{9}$', false)
    else false
  end;
$$;

-- Forma canónica de un teléfono escrito a mano (datos ya cargados), con
-- las mismas reglas que normalizarTelefonoWhatsApp (packages/paquetes).
-- Solo para detectar posibles duplicados; null si no se puede
-- interpretar sin adivinar.
create function public.fn_telefono_canonico(p_telefono text, p_pais text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := pg_catalog.regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  a integer;
begin
  if v = '' then return null; end if;
  if p_pais = 'AR' then
    if v ~ '^549[0-9]{10}$' then return v; end if;
    if v ~ '^54[0-9]{10}$' then return '549' || pg_catalog.substr(v, 3); end if;
    if pg_catalog.left(v, 1) = '0' then v := pg_catalog.substr(v, 2); end if;
    if pg_catalog.char_length(v) = 10 then return '549' || v; end if;
    if pg_catalog.char_length(v) = 12 then
      foreach a in array array[2, 3, 4] loop
        if pg_catalog.substr(v, a + 1, 2) = '15' then
          return '549' || pg_catalog.left(v, a) || pg_catalog.substr(v, a + 3);
        end if;
      end loop;
    end if;
    return null;
  end if;
  -- MX (y cualquier otro país: el valor por omisión de tenants.pais)
  if v ~ '^521[0-9]{10}$' then return '52' || pg_catalog.substr(v, 4); end if;
  if v ~ '^52[0-9]{10}$' then return v; end if;
  if pg_catalog.char_length(v) = 10 then return '52' || v; end if;
  return null;
end;
$$;

-- Clave de comparación de direcciones y nombres: sin acentos (primero,
-- para no depender de la configuración regional de lower()), minúsculas,
-- sin signos y con espacios simples. Solo para sugerir la vivienda y
-- detectar coincidencias; nunca reemplaza lo escrito.
create function public.fn_direccion_clave(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.translate(coalesce(p, ''),
      'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc')),
    '[^a-z0-9]+', ' ', 'g'));
$$;

-- Mismas condiciones de servicio que tenant_operativo(), sin depender de
-- quién llama (el formulario público no tiene usuario). La suite de
-- seguridad compara ambas en todos los estados de suscripción.
create function public.fn_tenant_servicio_vigente(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenants t
    join public.suscripciones s on s.tenant_id = t.id
    where t.id = p_tenant_id
      and t.estado_servicio in ('piloto', 'activo', 'cancelado')
      and (
        (s.estado = 'active'
          and (not s.cancel_at_period_end
               or (s.current_period_end is not null and pg_catalog.now() < s.current_period_end)))
        or (s.estado = 'trialing' and s.trial_ends_at is not null and pg_catalog.now() < s.trial_ends_at)
        or (s.estado = 'past_due' and s.impago_desde is not null
            and pg_catalog.now() < s.impago_desde + interval '7 days')
      )
  );
$$;

-- Coincidencias de una persona con lo ya cargado en el residencial.
-- Solo la usan las funciones de administración (nunca el formulario).
create function public.fn_residente_coincidencias(
  p_tenant_id uuid, p_pais text, p_telefono text, p_nombre text, p_apellido text, p_direccion text,
  p_excluir_solicitud uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with persona as (
    select public.fn_direccion_clave(p_direccion) as dir,
           public.fn_direccion_clave(p_nombre || ' ' || p_apellido) as nom
  ),
  contactos as (
    select u.id, u.identificador, u.contacto_nombre,
           public.fn_telefono_canonico(u.contacto_telefono, p_pais) as tel1,
           public.fn_telefono_canonico(u.contacto_telefono_secundario, p_pais) as tel2
    from public.unidades u
    where u.tenant_id = p_tenant_id and u.activo
  ),
  c as (
    select 'telefono_contacto' as tipo, k.id as unidad_id, k.identificador, k.contacto_nombre as nombre
    from contactos k where p_telefono is not null and p_telefono in (k.tel1, k.tel2)
    union all
    select 'telefono_residente', u.id, u.identificador, r.nombre || ' ' || r.apellido
    from public.residentes_unidades r join public.unidades u on u.id = r.unidad_id
    where r.tenant_id = p_tenant_id and r.fecha_fin is null and r.telefono = p_telefono
    union all
    select 'nombre_en_direccion', k.id, k.identificador, k.contacto_nombre
    from contactos k, persona p
    where public.fn_direccion_clave(k.identificador) = p.dir
      and public.fn_direccion_clave(k.contacto_nombre) = p.nom
    union all
    select 'solicitud_pendiente', null, s.direccion, s.nombre || ' ' || s.apellido
    from public.residentes_solicitudes s
    where s.tenant_id = p_tenant_id and s.estado = 'pendiente' and s.telefono = p_telefono
      and s.id is distinct from p_excluir_solicitud
  )
  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'unidad_id', unidad_id, 'direccion', identificador, 'nombre', nombre)
                            order by tipo, identificador), '[]'::jsonb)
  from c;
$$;

revoke all on function public.fn_residente_texto_limpio(text) from public, anon, authenticated, service_role;
revoke all on function public.fn_residente_nombre_valido(text) from public, anon, authenticated, service_role;
revoke all on function public.fn_residente_direccion_valida(text) from public, anon, authenticated, service_role;
revoke all on function public.fn_residente_telefono_valido(text, text) from public, anon, authenticated, service_role;
revoke all on function public.fn_telefono_canonico(text, text) from public, anon, authenticated, service_role;
revoke all on function public.fn_direccion_clave(text) from public, anon, authenticated, service_role;
revoke all on function public.fn_tenant_servicio_vigente(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_residente_coincidencias(uuid, text, text, text, text, text, uuid) from public, anon, authenticated, service_role;


-- ── 6. Funciones públicas (solo service_role) ─────────────────

-- Qué mostrar al abrir el enlace. Un token desconocido y uno revocado
-- responden igual; el nombre y el país solo salen con el enlace activo
-- y el residencial operando.
create function public.residentes_enlace_publico(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_activo boolean;
  v_nombre text;
  v_pais text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('estado', 'revocado');
  end if;
  select e.tenant_id, e.activo, t.nombre, t.pais
    into v_tenant_id, v_activo, v_nombre, v_pais
  from public.residentes_enlaces e
  join public.tenants t on t.id = e.tenant_id
  where e.token = p_token;
  if not found or not v_activo then
    return jsonb_build_object('estado', 'revocado');
  end if;
  if not public.fn_tenant_servicio_vigente(v_tenant_id) or coalesce(v_pais, '') not in ('AR', 'MX') then
    return jsonb_build_object('estado', 'no_operativo');
  end if;
  return jsonb_build_object('estado', 'activo', 'residencial', v_nombre, 'pais', v_pais);
end;
$$;

-- Guarda una solicitud pendiente. 'recibida' SIEMPRE trae el id de una
-- solicitud guardada: la nueva o, si es un reenvío idéntico a una
-- pendiente, esa misma (no se duplica). Nunca revela otros datos.
--
-- Límites. El enlace se comparte en el grupo del residencial y varias
-- personas pueden enviar desde el mismo wifi, así que escalan con el
-- tamaño del residencial: N = billing_viviendas_requeridas (la mayor
-- entre las viviendas declaradas y las activas).
--   por conexión (IP como HMAC) en el residencial:
--     max(40, ⌈N/2⌉) por hora y max(120, 2N) por día;
--   por conexión en todos los residenciales: 600 por día;
--   por enlace: max(300, 4N) por día;
--   pendientes del residencial: max(300, 4N).
-- Un reenvío idéntico desde la misma conexión responde con la solicitud
-- ya guardada aunque esa conexión llegó a su límite. Desde otra
-- conexión pasa por los límites antes de responder, para no confirmar
-- datos ajenos. Se serializa con advisory locks (conexión y enlace).
create function public.residentes_solicitud_crear(
  p_token text, p_nombre text, p_apellido text, p_direccion text, p_telefono text, p_ip_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_enlace_id uuid;
  v_tenant_id uuid;
  v_activo boolean;
  v_pais text;
  v_nombre text := public.fn_residente_texto_limpio(p_nombre);
  v_apellido text := public.fn_residente_texto_limpio(p_apellido);
  v_direccion text := public.fn_residente_texto_limpio(p_direccion);
  v_n integer;
  v_existente uuid;
  v_existente_ip text;
  v_ip_hora integer;
  v_ip_dia integer;
  v_ip_global integer;
  v_id uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('resultado', 'revocado');
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'residentes_solicitud_crear: ip_hash inválido' using errcode = '22023';
  end if;

  select e.id, e.tenant_id into v_enlace_id, v_tenant_id
  from public.residentes_enlaces e where e.token = p_token;
  if not found then
    return jsonb_build_object('resultado', 'revocado');
  end if;

  -- Orden fijo de locks (IP y luego enlace) para no bloquearse entre envíos.
  if p_ip_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('residentes_ip:' || p_ip_hash, 0));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('residentes_enlace:' || v_enlace_id::text, 0));

  -- Se relee después del lock: una revocación concurrente ya cuenta.
  select e.activo, t.pais into v_activo, v_pais
  from public.residentes_enlaces e join public.tenants t on t.id = e.tenant_id
  where e.id = v_enlace_id;
  if not v_activo then
    return jsonb_build_object('resultado', 'revocado');
  end if;
  if not public.fn_tenant_servicio_vigente(v_tenant_id) or coalesce(v_pais, '') not in ('AR', 'MX') then
    return jsonb_build_object('resultado', 'no_operativo');
  end if;

  if not public.fn_residente_nombre_valido(v_nombre)
     or not public.fn_residente_nombre_valido(v_apellido)
     or not public.fn_residente_direccion_valida(v_direccion)
     or not public.fn_residente_telefono_valido(p_telefono, v_pais) then
    return jsonb_build_object('resultado', 'invalido');
  end if;

  -- Reenvío idéntico (doble toque, conexión que se corta y se
  -- reintenta): la solicitud ya está guardada.
  select s.id, s.ip_hash into v_existente, v_existente_ip
  from public.residentes_solicitudes s
  where s.tenant_id = v_tenant_id and s.estado = 'pendiente' and s.telefono = p_telefono
    and public.fn_direccion_clave(s.nombre) = public.fn_direccion_clave(v_nombre)
    and public.fn_direccion_clave(s.apellido) = public.fn_direccion_clave(v_apellido)
    and public.fn_direccion_clave(s.direccion) = public.fn_direccion_clave(v_direccion)
  order by s.created_at
  limit 1;
  if v_existente is not null and v_existente_ip is not distinct from p_ip_hash then
    return jsonb_build_object('resultado', 'recibida', 'solicitud_id', v_existente);
  end if;

  v_n := coalesce(public.billing_viviendas_requeridas(v_tenant_id), 0);
  if p_ip_hash is not null then
    select count(*) filter (where s.tenant_id = v_tenant_id and s.created_at > pg_catalog.now() - interval '1 hour'),
           count(*) filter (where s.tenant_id = v_tenant_id),
           count(*)
      into v_ip_hora, v_ip_dia, v_ip_global
    from public.residentes_solicitudes s
    where s.ip_hash = p_ip_hash and s.created_at > pg_catalog.now() - interval '24 hours';
    if v_ip_hora >= greatest(40, ceil(v_n / 2.0)::integer)
       or v_ip_dia >= greatest(120, 2 * v_n)
       or v_ip_global >= 600 then
      return jsonb_build_object('resultado', 'limite_conexion');
    end if;
  end if;
  if (select count(*) from public.residentes_solicitudes s
      where s.enlace_id = v_enlace_id and s.created_at > pg_catalog.now() - interval '24 hours') >= greatest(300, 4 * v_n)
     or (select count(*) from public.residentes_solicitudes s
         where s.tenant_id = v_tenant_id and s.estado = 'pendiente') >= greatest(300, 4 * v_n) then
    return jsonb_build_object('resultado', 'limite_enlace');
  end if;

  if v_existente is not null then
    return jsonb_build_object('resultado', 'recibida', 'solicitud_id', v_existente);
  end if;

  insert into public.residentes_solicitudes (tenant_id, enlace_id, nombre, apellido, direccion, telefono, ip_hash)
  values (v_tenant_id, v_enlace_id, v_nombre, v_apellido, v_direccion, p_telefono, p_ip_hash)
  returning id into v_id;
  return jsonb_build_object('resultado', 'recibida', 'solicitud_id', v_id);
end;
$$;

revoke all on function public.residentes_enlace_publico(text) from public, anon, authenticated, service_role;
grant execute on function public.residentes_enlace_publico(text) to service_role;
revoke all on function public.residentes_solicitud_crear(text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.residentes_solicitud_crear(text, text, text, text, text, text) to service_role;


-- ── 7. Funciones de administración (authenticated) ────────────

create function public.fn_residentes_exigir_admin(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null
     or not (public.has_role_in_tenant(p_tenant_id, array['admin_residencial', 'super_admin']) or public.is_super_admin()) then
    raise exception 'residentes: sin permiso en este residencial' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.fn_residentes_exigir_admin(uuid) from public, anon, authenticated, service_role;

-- Revoca el enlace activo (si hay) y crea uno nuevo.
create function public.residentes_enlace_generar(p_tenant_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_token text;
begin
  perform public.fn_residentes_exigir_admin(p_tenant_id);
  if not public.tenant_operativo(p_tenant_id) then
    raise exception 'residentes_enlace_generar: el residencial no está operativo' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('residentes_enlace_tenant:' || p_tenant_id::text, 0));

  update public.residentes_enlaces
     set activo = false, revocado_en = pg_catalog.now(), revocado_por = auth.uid()
   where tenant_id = p_tenant_id and activo;

  -- Dos gen_random_uuid() (generador fuerte del servidor) sin guiones:
  -- 64 caracteres hex = 256 bits, de los que 12 son fijos (versión y
  -- variante de cada UUID). Quedan 244 bits aleatorios efectivos.
  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
          || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into public.residentes_enlaces (tenant_id, token, creado_por)
  values (p_tenant_id, v_token, auth.uid())
  returning id into v_id;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id)
  values (p_tenant_id, auth.uid(), 'residentes_enlace_generado', 'residentes_enlaces', v_id);
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

create function public.residentes_enlace_desactivar(p_tenant_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform public.fn_residentes_exigir_admin(p_tenant_id);
  update public.residentes_enlaces
     set activo = false, revocado_en = pg_catalog.now(), revocado_por = auth.uid()
   where tenant_id = p_tenant_id and activo;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.audit_log (tenant_id, user_id, accion, entidad)
    values (p_tenant_id, auth.uid(), 'residentes_enlace_desactivado', 'residentes_enlaces');
  end if;
  return v_n;
end;
$$;

-- Pendientes del residencial, cada una con la vivienda sugerida por su
-- dirección y sus posibles duplicados (solo para la administración).
create function public.residentes_solicitudes_revision(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pais text;
begin
  perform public.fn_residentes_exigir_admin(p_tenant_id);
  select t.pais into v_pais from public.tenants t where t.id = p_tenant_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'nombre', s.nombre,
      'apellido', s.apellido,
      'direccion', s.direccion,
      'telefono', s.telefono,
      'created_at', s.created_at,
      'vivienda_sugerida', (
        select jsonb_build_object(
          'id', u.id, 'direccion', u.identificador,
          'con_contacto', (coalesce(u.contacto_nombre, '') <> '' or coalesce(u.contacto_telefono, '') <> ''))
        from public.unidades u
        where u.tenant_id = s.tenant_id and u.activo
          and public.fn_direccion_clave(u.identificador) = public.fn_direccion_clave(s.direccion)
        order by u.identificador limit 1),
      'coincidencias', public.fn_residente_coincidencias(s.tenant_id, v_pais, s.telefono, s.nombre, s.apellido, s.direccion, s.id)
    ) order by s.created_at)
    from public.residentes_solicitudes s
    where s.tenant_id = p_tenant_id and s.estado = 'pendiente'
  ), '[]'::jsonb);
end;
$$;

-- Aprueba una solicitud, con los datos tal como los dejó la
-- administración (puede haberlos corregido).
--   p_unidad_id null  → vivienda nueva con esta persona como contacto
--   p_unidad_id       → vivienda existente: completa el contacto si está
--                       vacío; si no, la agrega como residente adicional
-- Respuestas sin error: {ok:false, motivo} con ya_revisada, no_operativo,
-- datos_invalidos, unidad_no_valida, direccion_existente,
-- direccion_inactiva, ya_registrado y posible_duplicado (este último se
-- puede confirmar).
create function public.residentes_solicitud_aprobar(
  p_solicitud_id uuid,
  p_nombre text,
  p_apellido text,
  p_direccion text,
  p_telefono text,
  p_unidad_id uuid default null,
  p_confirmar_duplicado boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.residentes_solicitudes;
  v_pais text;
  v_nombre text := public.fn_residente_texto_limpio(p_nombre);
  v_apellido text := public.fn_residente_texto_limpio(p_apellido);
  v_direccion text := public.fn_residente_texto_limpio(p_direccion);
  v_u public.unidades;
  v_coinc jsonb;
  v_resultado text;
  v_unidad_id uuid;
  v_residente_id uuid;
begin
  select * into v_s from public.residentes_solicitudes where id = p_solicitud_id for update;
  if not found then
    raise exception 'residentes_solicitud_aprobar: solicitud inexistente' using errcode = '42501';
  end if;
  perform public.fn_residentes_exigir_admin(v_s.tenant_id);
  if v_s.estado <> 'pendiente' then
    return jsonb_build_object('ok', false, 'motivo', 'ya_revisada');
  end if;
  if not public.tenant_operativo(v_s.tenant_id) then
    return jsonb_build_object('ok', false, 'motivo', 'no_operativo');
  end if;

  select t.pais into v_pais from public.tenants t where t.id = v_s.tenant_id;
  if not public.fn_residente_nombre_valido(v_nombre) or not public.fn_residente_nombre_valido(v_apellido)
     or not public.fn_residente_direccion_valida(v_direccion) or not public.fn_residente_telefono_valido(p_telefono, v_pais) then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  if p_unidad_id is not null then
    select * into v_u from public.unidades
    where id = p_unidad_id and tenant_id = v_s.tenant_id and activo
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'unidad_no_valida');
    end if;
    -- La misma persona ya está en esta vivienda: no se duplica.
    if public.fn_telefono_canonico(v_u.contacto_telefono, v_pais) = p_telefono
       or public.fn_telefono_canonico(v_u.contacto_telefono_secundario, v_pais) = p_telefono
       or exists (select 1 from public.residentes_unidades r
                  where r.unidad_id = v_u.id and r.fecha_fin is null and r.telefono = p_telefono) then
      return jsonb_build_object('ok', false, 'motivo', 'ya_registrado', 'unidad_id', v_u.id, 'direccion', v_u.identificador);
    end if;
  else
    -- Dos aprobaciones a la vez con la misma dirección nueva (otras
    -- solicitudes) se serializan: la segunda ve la vivienda creada por
    -- la primera y responde direccion_existente en vez de duplicarla.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'residentes_direccion:' || v_s.tenant_id::text || ':' || public.fn_direccion_clave(v_direccion), 0));
    select * into v_u from public.unidades u
    where u.tenant_id = v_s.tenant_id
      and public.fn_direccion_clave(u.identificador) = public.fn_direccion_clave(v_direccion)
    order by u.activo desc, u.identificador limit 1;
    if found and v_u.activo then
      return jsonb_build_object('ok', false, 'motivo', 'direccion_existente', 'unidad_id', v_u.id, 'direccion', v_u.identificador);
    elsif found then
      -- Vivienda desactivada con esa dirección: se reactiva en Unidades.
      return jsonb_build_object('ok', false, 'motivo', 'direccion_inactiva', 'unidad_id', v_u.id, 'direccion', v_u.identificador);
    end if;
  end if;

  v_coinc := public.fn_residente_coincidencias(v_s.tenant_id, v_pais, p_telefono, v_nombre, v_apellido, v_direccion, v_s.id);
  if pg_catalog.jsonb_array_length(v_coinc) > 0 and not coalesce(p_confirmar_duplicado, false) then
    return jsonb_build_object('ok', false, 'motivo', 'posible_duplicado', 'coincidencias', v_coinc);
  end if;

  if p_unidad_id is null then
    insert into public.unidades (tenant_id, identificador, contacto_nombre, contacto_telefono)
    values (v_s.tenant_id, v_direccion, v_nombre || ' ' || v_apellido, p_telefono)
    returning id into v_unidad_id;
    v_resultado := 'vivienda_nueva';
  elsif coalesce(v_u.contacto_nombre, '') = '' and coalesce(v_u.contacto_telefono, '') = '' then
    update public.unidades
       set contacto_nombre = v_nombre || ' ' || v_apellido, contacto_telefono = p_telefono
     where id = v_u.id;
    v_unidad_id := v_u.id;
    v_resultado := 'contacto_principal';
  else
    insert into public.residentes_unidades (tenant_id, unidad_id, origen, nombre, apellido, telefono, solicitud_id)
    values (v_s.tenant_id, v_u.id, 'enlace', v_nombre, v_apellido, p_telefono, v_s.id)
    returning id into v_residente_id;
    v_unidad_id := v_u.id;
    v_resultado := 'residente_adicional';
  end if;

  update public.residentes_solicitudes
     set estado = 'aprobada', resultado = v_resultado, unidad_id = v_unidad_id, residente_unidad_id = v_residente_id,
         corregida = (nombre, apellido, direccion, telefono) is distinct from (v_nombre, v_apellido, v_direccion, p_telefono),
         nombre = v_nombre, apellido = v_apellido, direccion = v_direccion, telefono = p_telefono,
         revisado_por = auth.uid(), revisado_en = pg_catalog.now()
   where id = v_s.id;

  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_nuevos)
  values (v_s.tenant_id, auth.uid(), 'residente_solicitud_aprobada', 'residentes_solicitudes', v_s.id,
          jsonb_build_object('resultado', v_resultado, 'unidad_id', v_unidad_id));
  return jsonb_build_object('ok', true, 'resultado', v_resultado, 'unidad_id', v_unidad_id);
end;
$$;

create function public.residentes_solicitud_rechazar(p_solicitud_id uuid, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.residentes_solicitudes;
begin
  select * into v_s from public.residentes_solicitudes where id = p_solicitud_id for update;
  if not found then
    raise exception 'residentes_solicitud_rechazar: solicitud inexistente' using errcode = '42501';
  end if;
  perform public.fn_residentes_exigir_admin(v_s.tenant_id);
  if p_motivo is null or p_motivo not in ('duplicado', 'datos_incorrectos', 'no_reside', 'otro') then
    raise exception 'residentes_solicitud_rechazar: motivo inválido' using errcode = '22023';
  end if;
  if v_s.estado <> 'pendiente' then
    return jsonb_build_object('ok', false, 'motivo', 'ya_revisada');
  end if;
  if not public.tenant_operativo(v_s.tenant_id) then
    return jsonb_build_object('ok', false, 'motivo', 'no_operativo');
  end if;
  update public.residentes_solicitudes
     set estado = 'rechazada', motivo_rechazo = p_motivo, revisado_por = auth.uid(), revisado_en = pg_catalog.now()
   where id = v_s.id;
  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_nuevos)
  values (v_s.tenant_id, auth.uid(), 'residente_solicitud_rechazada', 'residentes_solicitudes', v_s.id,
          jsonb_build_object('motivo', p_motivo));
  return jsonb_build_object('ok', true);
end;
$$;

-- Edición y baja de una persona sin cuenta ya aprobada.
create function public.residentes_adicional_actualizar(p_id uuid, p_nombre text, p_apellido text, p_telefono text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_r public.residentes_unidades;
  v_pais text;
  v_nombre text := public.fn_residente_texto_limpio(p_nombre);
  v_apellido text := public.fn_residente_texto_limpio(p_apellido);
begin
  select * into v_r from public.residentes_unidades where id = p_id and origen = 'enlace' for update;
  if not found then
    raise exception 'residentes_adicional_actualizar: residente inexistente' using errcode = '42501';
  end if;
  perform public.fn_residentes_exigir_admin(v_r.tenant_id);
  if not public.tenant_operativo(v_r.tenant_id) then
    return jsonb_build_object('ok', false, 'motivo', 'no_operativo');
  end if;
  select t.pais into v_pais from public.tenants t where t.id = v_r.tenant_id;
  if not public.fn_residente_nombre_valido(v_nombre) or not public.fn_residente_nombre_valido(v_apellido)
     or not public.fn_residente_telefono_valido(p_telefono, v_pais) then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  if exists (select 1 from public.residentes_unidades r
             where r.unidad_id = v_r.unidad_id and r.fecha_fin is null and r.telefono = p_telefono and r.id <> v_r.id) then
    return jsonb_build_object('ok', false, 'motivo', 'ya_registrado');
  end if;
  update public.residentes_unidades set nombre = v_nombre, apellido = v_apellido, telefono = p_telefono where id = v_r.id;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.residentes_adicional_quitar(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_r public.residentes_unidades;
begin
  select * into v_r from public.residentes_unidades where id = p_id and origen = 'enlace' for update;
  if not found then
    raise exception 'residentes_adicional_quitar: residente inexistente' using errcode = '42501';
  end if;
  perform public.fn_residentes_exigir_admin(v_r.tenant_id);
  if not public.tenant_operativo(v_r.tenant_id) then
    return jsonb_build_object('ok', false, 'motivo', 'no_operativo');
  end if;
  update public.residentes_unidades set fecha_fin = greatest(current_date, fecha_inicio)
   where id = v_r.id and fecha_fin is null;
  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id)
  values (v_r.tenant_id, auth.uid(), 'residente_adicional_quitado', 'residentes_unidades', v_r.id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.residentes_enlace_generar(uuid) from public, anon, authenticated, service_role;
revoke all on function public.residentes_enlace_desactivar(uuid) from public, anon, authenticated, service_role;
revoke all on function public.residentes_solicitudes_revision(uuid) from public, anon, authenticated, service_role;
revoke all on function public.residentes_solicitud_aprobar(uuid, text, text, text, text, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.residentes_solicitud_rechazar(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.residentes_adicional_actualizar(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.residentes_adicional_quitar(uuid) from public, anon, authenticated, service_role;
grant execute on function public.residentes_enlace_generar(uuid) to authenticated;
grant execute on function public.residentes_enlace_desactivar(uuid) to authenticated;
grant execute on function public.residentes_solicitudes_revision(uuid) to authenticated;
grant execute on function public.residentes_solicitud_aprobar(uuid, text, text, text, text, uuid, boolean) to authenticated;
grant execute on function public.residentes_solicitud_rechazar(uuid, text) to authenticated;
grant execute on function public.residentes_adicional_actualizar(uuid, text, text, text) to authenticated;
grant execute on function public.residentes_adicional_quitar(uuid) to authenticated;
