-- ============================================================
-- 20261014000000_documentos_legales.sql
--
-- Fase 1 de la implementación legal (docs/operations/LEGAL.md): la
-- estructura para documentos legales versionados y para el registro
-- verificable de aceptaciones, acuses y consentimientos.
--
-- INACTIVA A PROPÓSITO
--   * No carga ninguna versión de ningún documento ni ningún requisito
--     (requisitos_legales queda vacía): nadie tiene nada pendiente.
--   * Ninguna tabla ni función tiene permisos para anon, authenticated
--     ni service_role: ni la API ni el código actual pueden usarlas.
--     Cada fase posterior concede solo lo que use, con su prueba de la
--     matriz de permisos.
--   * No cambia ninguna tabla, función, política ni trigger existente
--     (users.terminos_aceptados_en sigue igual y nadie la escribe aquí
--     mientras no se registre una aceptación real).
--
-- TRES CONCEPTOS DISTINTOS (nunca se registra uno por otro)
--   aceptacion      aceptación contractual expresa (Términos y
--                   Condiciones, Acuerdo de Tratamiento de Datos);
--   acuse           acuse de recepción del Aviso de Privacidad. NO es
--                   consentimiento;
--   consentimiento  solo cuando la revisión jurídica determine que un
--                   tratamiento concreto lo requiere, por país;
--   revocacion      retiro de un consentimiento: una fila nueva que
--                   apunta al consentimiento retirado; nada se modifica.
--   Qué rol debe aceptar o reconocer qué documento, con qué tipo y
--   alcance y en qué país, lo define requisitos_legales (vacía hasta la
--   decisión jurídica).
--
-- VERSIONES (documentos_legales_versiones)
--   Cada versión es de UN país (MX o AR): si el mismo texto vale para
--   los dos, se carga dos veces (mismo hash). Versión única por
--   documento y país.
--   borrador → aprobado → publicado → retirado (o aprobado → retirado).
--   Toda versión entra como borrador. Fuera del borrador, el contenido,
--   su hash, la versión, la jurisdicción y los datos de la aprobación
--   son inmutables; un aprobado solo puede fijar su vigencia y
--   publicarse; un publicado solo puede retirarse. No se publica con
--   vigencia retroactiva ni anterior a otra versión ya publicada del
--   mismo documento y país. Cada alta, edición de borrador, cambio de
--   estado o de vigencia y borrado de borrador queda en audit_log. No
--   existe forma de "corregir" una versión aprobada o publicada: se crea
--   otra. El catálogo (documentos_legales) tampoco se edita ni se borra.
--   Vigente = la publicada más reciente ya en vigor; retirar la vigente
--   devuelve la vigencia a la anterior aún publicada.
--
-- EVIDENCIA (aceptaciones_legales)
--   * Inmutable: UPDATE nunca; DELETE solo para descartar la evidencia de
--     un alta fallida (cuenta nunca confirmada ni usada), con la función
--     descartar_aceptaciones_alta_fallida, sin permisos para la API.
--   * user_id y tenant_id NO tienen clave foránea, a propósito: la
--     evidencia de una cuenta real no debe desaparecer en cascada al
--     borrar la cuenta o el residencial. Cuánto se conserva y cuándo se
--     depura lo fijará la revisión jurídica; mientras tanto se conserva.
--     La fila solo guarda identificadores, versión, tipo, alcance, origen
--     y hora: ni correo, ni IP, ni navegador. No se duplica en audit_log
--     (la tabla ya es el registro): así el historial de aceptaciones de
--     una persona no queda en un sitio que lean otros administradores.
--   * Al insertar (aunque inserte postgres) se valida: versión publicada
--     y vigente, usuario existente, residencial existente, membresía
--     activa y país del residencial igual al de la versión. La hora
--     es siempre la del servidor y el hash se copia de la versión: nunca
--     se aceptan valores del llamador.
--   * Alcance 'usuario': una fila por usuario y versión. Alcance
--     'residencial' (Acuerdo de Tratamiento de Datos): una por residencial
--     y versión, solo de un admin_residencial que DECLARA tener facultades
--     de representación. Esa declaración NO está validada: la validación
--     de facultades queda pendiente (decisión legal) y, cuando exista, se
--     registrará aparte, sin modificar la fila.
--   * Idempotencia y concurrencia: índices únicos parciales + INSERT …
--     ON CONFLICT DO NOTHING (dos aceptaciones simultáneas dejan una sola
--     fila; la segunda responde "ya existente"); los consentimientos, que
--     admiten revocación, se serializan con un lock por usuario y versión;
--     un consentimiento se revoca una sola vez (índice único).
--   * Ningún administrador lee el historial de otros: no hay permisos
--     sobre la tabla y documentos_pendientes solo dice QUÉ falta, nunca
--     quién aceptó.
--
-- Funciones (todas SECURITY DEFINER, search_path vacío, sin EXECUTE para
-- la API en esta fase):
--   documentos_legales_vigentes(pais)        versión vigente de cada documento
--   documento_legal_publicado(version_id)    contenido de una publicada/retirada
--   documentos_pendientes(tenant)            lo que auth.uid() debe aceptar/reconocer
--   registrar_aceptaciones(tenant, ids, origen, declara_facultades)
--   descartar_aceptaciones_alta_fallida(user, tenant)
-- ============================================================

-- ── Catálogo de documentos ──────────────────────────────────────────
create table public.documentos_legales (
  clave     text primary key
            check (clave in ('terminos', 'privacidad', 'acuerdo_tratamiento', 'aviso_residentes')),
  titulo    text not null check (length(btrim(titulo)) > 0),
  audiencia text not null check (audiencia in ('cliente', 'usuario', 'residente'))
);

insert into public.documentos_legales (clave, titulo, audiencia) values
  ('terminos', 'Términos y Condiciones', 'cliente'),
  ('privacidad', 'Aviso de Privacidad', 'usuario'),
  ('acuerdo_tratamiento', 'Acuerdo de Tratamiento de Datos', 'cliente'),
  ('aviso_residentes', 'Aviso de privacidad para residentes', 'residente');

comment on table public.documentos_legales is
  'Catálogo fijo de documentos legales de Gate Flow (sin UPDATE ni DELETE). Las versiones viven en documentos_legales_versiones.';

-- ── Versiones ───────────────────────────────────────────────────────
create table public.documentos_legales_versiones (
  id                        uuid primary key default gen_random_uuid(),
  documento_clave           text not null references public.documentos_legales (clave) on delete restrict,
  version                   text not null check (version ~ '^[0-9]{1,3}\.[0-9]{1,3}$'),
  jurisdiccion              text not null check (jurisdiccion in ('MX', 'AR')),
  estado                    text not null default 'borrador'
                            check (estado in ('borrador', 'aprobado', 'publicado', 'retirado')),
  contenido                 text not null check (length(btrim(contenido)) > 0),
  contenido_sha256          text not null check (contenido_sha256 ~ '^[0-9a-f]{64}$'),
  requiere_nueva_aceptacion boolean not null default true,
  resumen_cambios           text,
  vigente_desde             timestamptz,
  aprobado_por              text,
  aprobado_en               timestamptz,
  publicado_en              timestamptz,
  retirado_en               timestamptz,
  created_at                timestamptz not null default now(),
  constraint documentos_legales_versiones_clave_version_key unique (documento_clave, jurisdiccion, version),
  constraint documentos_legales_versiones_borrador_check
    check (estado <> 'borrador' or (aprobado_en is null and aprobado_por is null and publicado_en is null and retirado_en is null)),
  constraint documentos_legales_versiones_aprobacion_check
    check (estado = 'borrador' or (aprobado_en is not null and length(btrim(coalesce(aprobado_por, ''))) > 0)),
  constraint documentos_legales_versiones_aprobado_check
    check (estado <> 'aprobado' or (publicado_en is null and retirado_en is null)),
  constraint documentos_legales_versiones_publicado_check
    check (estado <> 'publicado' or (publicado_en is not null and vigente_desde is not null and retirado_en is null)),
  constraint documentos_legales_versiones_retirado_check
    check (estado <> 'retirado' or retirado_en is not null),
  constraint documentos_legales_versiones_vigencia_check
    check (publicado_en is null or vigente_desde is not null),
  -- El hash siempre describe el texto, aunque se salten los triggers
  -- (session_replication_role, DISABLE TRIGGER): un cambio de texto no
  -- puede conservar el hash que quedó copiado en cada aceptación.
  constraint documentos_legales_versiones_hash_check
    check (contenido_sha256 = encode(sha256(convert_to(contenido, 'UTF8')), 'hex'))
);

create index documentos_legales_versiones_vigencia_idx
  on public.documentos_legales_versiones (documento_clave, jurisdiccion, estado, vigente_desde);

comment on table public.documentos_legales_versiones is
  'Versiones de cada documento legal. Inmutables fuera de borrador (trigger documentos_legales_versiones_guardia); toda alta y transición queda en audit_log.';
comment on column public.documentos_legales_versiones.contenido_sha256 is
  'sha256 del contenido en UTF-8, calculado por el trigger: el llamador no puede fijarlo.';
comment on column public.documentos_legales_versiones.requiere_nueva_aceptacion is
  'true: a partir de su vigencia, quien aceptó o reconoció una versión anterior vuelve a tenerlo pendiente. false: corrección menor, basta lo ya aceptado.';
comment on column public.documentos_legales_versiones.aprobado_por is
  'Quién aprobó el texto (revisión jurídica), como texto libre: no es un usuario de la plataforma.';

-- ── Requisitos por rol y país (vacía en esta fase) ──────────────────
create table public.requisitos_legales (
  rol_clave       text not null check (rol_clave in ('admin_residencial', 'guardia')),
  documento_clave text not null references public.documentos_legales (clave) on delete restrict,
  jurisdiccion    text not null check (jurisdiccion in ('MX', 'AR')),
  tipo            text not null check (tipo in ('aceptacion', 'acuse', 'consentimiento')),
  alcance         text not null check (alcance in ('usuario', 'residencial')),
  created_at      timestamptz not null default now(),
  primary key (rol_clave, documento_clave, jurisdiccion),
  -- Un documento con alcance de residencial solo se acepta (contrato) y
  -- solo lo hace la administración del residencial.
  constraint requisitos_legales_residencial_check
    check (alcance = 'usuario' or (tipo = 'aceptacion' and rol_clave = 'admin_residencial'))
);

comment on table public.requisitos_legales is
  'Qué documento debe aceptar (aceptacion), reconocer (acuse) o consentir cada rol, por país. Vacía hasta la decisión jurídica: sin filas, nadie tiene nada pendiente.';

-- ── Evidencia de aceptaciones ───────────────────────────────────────
create table public.aceptaciones_legales (
  id                   uuid primary key default gen_random_uuid(),
  -- Sin FK a propósito (ver cabecera): la evidencia sobrevive a la cuenta.
  user_id              uuid not null,
  -- Sin FK a propósito: la evidencia sobrevive al residencial. Siempre
  -- presente: la jurisdicción sale del país del residencial.
  tenant_id            uuid not null,
  version_id           uuid not null references public.documentos_legales_versiones (id) on delete restrict,
  tipo                 text not null check (tipo in ('aceptacion', 'acuse', 'consentimiento', 'revocacion')),
  alcance              text not null check (alcance in ('usuario', 'residencial')),
  origen               text not null check (origen in ('registro', 'invitacion', 'aceptacion_posterior')),
  declara_facultades   boolean not null default false,
  revoca_aceptacion_id uuid references public.aceptaciones_legales (id) on delete restrict,
  contenido_sha256     text not null check (contenido_sha256 ~ '^[0-9a-f]{64}$'),
  aceptado_en          timestamptz not null default now(),
  constraint aceptaciones_legales_revocacion_check
    check ((tipo = 'revocacion') = (revoca_aceptacion_id is not null)),
  constraint aceptaciones_legales_residencial_check
    check (alcance = 'usuario' or (tipo = 'aceptacion' and declara_facultades)),
  constraint aceptaciones_legales_facultades_check
    check (alcance = 'residencial' or not declara_facultades)
);

-- Idempotencia: una aceptación/acuse por usuario y versión; una
-- aceptación por residencial y versión (Acuerdo de Tratamiento).
create unique index aceptaciones_legales_usuario_uq
  on public.aceptaciones_legales (user_id, version_id)
  where alcance = 'usuario' and tipo in ('aceptacion', 'acuse');
create unique index aceptaciones_legales_residencial_uq
  on public.aceptaciones_legales (tenant_id, version_id)
  where alcance = 'residencial';
-- Un consentimiento se revoca una sola vez.
create unique index aceptaciones_legales_revocacion_uq
  on public.aceptaciones_legales (revoca_aceptacion_id)
  where revoca_aceptacion_id is not null;
create index aceptaciones_legales_user_idx on public.aceptaciones_legales (user_id);
create index aceptaciones_legales_tenant_idx on public.aceptaciones_legales (tenant_id);

comment on table public.aceptaciones_legales is
  'Evidencia inmutable de aceptaciones, acuses, consentimientos y revocaciones. Sin FK a usuarios ni residenciales para que no se borre en cascada; solo se descarta la de un alta fallida (descartar_aceptaciones_alta_fallida).';
comment on column public.aceptaciones_legales.declara_facultades is
  'Alcance residencial: quien acepta declaró tener facultades para representar al residencial. Declaración NO validada (validación pendiente).';
comment on column public.aceptaciones_legales.aceptado_en is
  'Hora del servidor fijada por el trigger; el llamador no puede elegirla.';

-- ── Triggers ────────────────────────────────────────────────────────

-- Versiones: transiciones permitidas e inmutabilidad fuera del borrador.
create function public.documentos_legales_versiones_guardia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.estado is distinct from 'borrador' then
      raise exception 'documentos_legales: una versión nueva entra como borrador (recibido %)', new.estado
        using errcode = '23514';
    end if;
    new.aprobado_por := null;
    new.aprobado_en := null;
    new.publicado_en := null;
    new.retirado_en := null;
    new.created_at := now();
    new.contenido_sha256 := encode(sha256(convert_to(new.contenido, 'UTF8')), 'hex');
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then
      raise exception 'documentos_legales: la versión % de % está % y no se puede borrar', old.version, old.documento_clave, old.estado
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.id is distinct from old.id
     or new.documento_clave is distinct from old.documento_clave
     or new.created_at is distinct from old.created_at then
    raise exception 'documentos_legales: id, documento y fecha de alta no se modifican' using errcode = '42501';
  end if;

  if old.estado = 'borrador' and new.estado = 'borrador' then
    -- Edición libre del borrador. Las columnas de aprobación no se
    -- tocan aquí y el hash se recalcula.
    new.aprobado_por := null;
    new.aprobado_en := null;
    new.publicado_en := null;
    new.retirado_en := null;
    new.contenido_sha256 := encode(sha256(convert_to(new.contenido, 'UTF8')), 'hex');
    return new;
  end if;

  -- Fuera del borrador (incluida la propia aprobación) el texto y sus
  -- metadatos quedan congelados.
  if (new.version, new.jurisdiccion, new.contenido, new.contenido_sha256, new.requiere_nueva_aceptacion, new.resumen_cambios)
     is distinct from
     (old.version, old.jurisdiccion, old.contenido, old.contenido_sha256, old.requiere_nueva_aceptacion, old.resumen_cambios) then
    raise exception 'documentos_legales: la versión % de % no es un borrador; su contenido no se modifica (crear una versión nueva)',
      old.version, old.documento_clave
      using errcode = '42501';
  end if;

  if old.estado = 'borrador' and new.estado = 'aprobado' then
    if length(btrim(coalesce(new.aprobado_por, ''))) = 0 then
      raise exception 'documentos_legales: aprobar exige aprobado_por (revisión jurídica)' using errcode = '23514';
    end if;
    new.aprobado_en := now();
    new.publicado_en := null;
    new.retirado_en := null;
    return new;
  end if;

  if old.estado = 'aprobado' and new.estado = 'aprobado' then
    -- Solo la vigencia puede fijarse o cambiarse antes de publicar.
    if (new.aprobado_por, new.aprobado_en, new.publicado_en, new.retirado_en)
       is distinct from (old.aprobado_por, old.aprobado_en, old.publicado_en, old.retirado_en) then
      raise exception 'documentos_legales: en una versión aprobada solo puede cambiar la vigencia' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.estado = 'aprobado' and new.estado = 'publicado' then
    if (new.aprobado_por, new.aprobado_en) is distinct from (old.aprobado_por, old.aprobado_en) then
      raise exception 'documentos_legales: la aprobación no se modifica al publicar' using errcode = '42501';
    end if;
    if new.vigente_desde is null then
      raise exception 'documentos_legales: publicar exige vigente_desde' using errcode = '23514';
    end if;
    if new.vigente_desde < now() - interval '5 minutes' then
      raise exception 'documentos_legales: no se publica con vigencia retroactiva (%)', new.vigente_desde using errcode = '23514';
    end if;
    -- Una publicación a la vez por documento, y siempre posterior a las
    -- ya publicadas para el mismo país: el orden de vigencias es único.
    -- Una retirada antes de entrar en vigor (nadie pudo aceptarla) no
    -- bloquea publicar su corrección.
    perform pg_advisory_xact_lock(hashtextextended('documentos_legales:' || new.documento_clave || ':' || new.jurisdiccion, 0));
    if exists (
      select 1 from public.documentos_legales_versiones o
      where o.documento_clave = new.documento_clave and o.id <> new.id
        and o.publicado_en is not null and o.jurisdiccion = new.jurisdiccion
        and o.vigente_desde >= new.vigente_desde
        and not (o.estado = 'retirado' and o.retirado_en < o.vigente_desde)
    ) then
      raise exception 'documentos_legales: la vigencia debe ser posterior a la de las versiones ya publicadas de % (%)', new.documento_clave, new.jurisdiccion
        using errcode = '23514';
    end if;
    new.publicado_en := now();
    new.retirado_en := null;
    return new;
  end if;

  if old.estado in ('aprobado', 'publicado') and new.estado = 'retirado' then
    if (new.aprobado_por, new.aprobado_en, new.publicado_en, new.vigente_desde)
       is distinct from (old.aprobado_por, old.aprobado_en, old.publicado_en, old.vigente_desde) then
      raise exception 'documentos_legales: al retirar solo cambia el estado' using errcode = '42501';
    end if;
    new.retirado_en := now();
    return new;
  end if;

  raise exception 'documentos_legales: transición no permitida % → % (versión % de %)', old.estado, new.estado, old.version, old.documento_clave
    using errcode = '42501';
end;
$$;

-- Versiones: rastro en audit_log (sin el texto: solo su hash).
create function public.documentos_legales_versiones_auditar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fila public.documentos_legales_versiones := case when tg_op = 'DELETE' then old else new end;
  v_accion text;
  v_usuario uuid;
begin
  v_accion := case
    when tg_op = 'INSERT' then 'legal.version_creada'
    when tg_op = 'DELETE' then 'legal.version_borrador_eliminado'
    when old.estado = new.estado and new.estado = 'borrador' then 'legal.version_borrador_editado'
    when old.estado = new.estado then 'legal.version_vigencia_cambiada'
    else 'legal.version_' || new.estado
  end;
  select u.id into v_usuario from public.users u where u.id = auth.uid();
  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
  values (
    null, v_usuario, v_accion, 'documentos_legales_versiones', v_fila.id,
    case when tg_op = 'INSERT' then null else jsonb_build_object(
      'documento', old.documento_clave, 'version', old.version, 'estado', old.estado,
      'jurisdiccion', old.jurisdiccion, 'vigente_desde', old.vigente_desde, 'contenido_sha256', old.contenido_sha256) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object(
      'documento', new.documento_clave, 'version', new.version, 'estado', new.estado,
      'jurisdiccion', new.jurisdiccion, 'vigente_desde', new.vigente_desde, 'contenido_sha256', new.contenido_sha256,
      'requiere_nueva_aceptacion', new.requiere_nueva_aceptacion, 'aprobado_por', new.aprobado_por) end
  );
  return null;
end;
$$;

-- Requisitos: rastro en audit_log de cada alta, cambio y baja.
create function public.requisitos_legales_auditar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_usuario uuid;
begin
  select u.id into v_usuario from public.users u where u.id = auth.uid();
  insert into public.audit_log (tenant_id, user_id, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
  values (
    null, v_usuario,
    case tg_op when 'INSERT' then 'legal.requisito_alta' when 'UPDATE' then 'legal.requisito_cambio' else 'legal.requisito_baja' end,
    'requisitos_legales', null,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return null;
end;
$$;

-- Evidencia: inmutable; validación completa al insertar.
create function public.aceptaciones_legales_guardia()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version public.documentos_legales_versiones;
  v_pais text;
  v_rol text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'aceptaciones_legales: la evidencia es inmutable; no se modifica' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    -- Única excepción: descartar_aceptaciones_alta_fallida, que fija la
    -- marca solo para su propio DELETE y solo sobre filas de registro.
    if coalesce(current_setting('gateflow.borrado_aceptaciones', true), '') = 'alta_fallida' and old.origen = 'registro' then
      return old;
    end if;
    raise exception 'aceptaciones_legales: la evidencia no se borra (solo la de un alta fallida)' using errcode = '42501';
  end if;

  -- INSERT
  if new.user_id is null or new.tenant_id is null or new.version_id is null then
    raise exception 'aceptaciones_legales: usuario, residencial y versión son obligatorios' using errcode = '23502';
  end if;
  select * into v_version from public.documentos_legales_versiones v where v.id = new.version_id;
  if not found then
    raise exception 'aceptaciones_legales: versión inexistente' using errcode = '23503';
  end if;
  if not exists (select 1 from auth.users u where u.id = new.user_id) then
    raise exception 'aceptaciones_legales: usuario inexistente' using errcode = '23503';
  end if;

  if new.tipo = 'revocacion' then
    -- Retirar un consentimiento propio: mismo usuario, versión y
    -- residencial. No exige membresía vigente (quien ya no es miembro
    -- también puede retirarlo) y vale aunque la versión esté retirada.
    if v_version.publicado_en is null then
      raise exception 'aceptaciones_legales: la versión nunca se publicó' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.aceptaciones_legales a
      where a.id = new.revoca_aceptacion_id and a.user_id = new.user_id and a.tenant_id = new.tenant_id
        and a.version_id = new.version_id and a.tipo = 'consentimiento'
    ) then
      raise exception 'aceptaciones_legales: la revocación debe apuntar a un consentimiento propio de la misma versión' using errcode = '23514';
    end if;
  else
    if v_version.estado <> 'publicado' or v_version.vigente_desde > now() then
      raise exception 'aceptaciones_legales: solo se acepta una versión publicada y vigente (versión % en estado %)', v_version.version, v_version.estado
        using errcode = '23514';
    end if;
    select t.pais into v_pais from public.tenants t where t.id = new.tenant_id;
    if not found then
      raise exception 'aceptaciones_legales: residencial inexistente' using errcode = '23503';
    end if;
    if v_pais is distinct from v_version.jurisdiccion then
      raise exception 'aceptaciones_legales: la versión no aplica al país del residencial (%)', v_pais using errcode = '23514';
    end if;
    select r.clave into v_rol
    from public.user_tenants ut
    join public.roles r on r.id = ut.rol_id
    where ut.user_id = new.user_id and ut.tenant_id = new.tenant_id and ut.activo;
    if v_rol is null then
      raise exception 'aceptaciones_legales: sin membresía activa en el residencial' using errcode = '23514';
    end if;
    if new.alcance = 'residencial' and v_rol <> 'admin_residencial' then
      raise exception 'aceptaciones_legales: solo la administración del residencial acepta en su nombre' using errcode = '23514';
    end if;
  end if;

  new.contenido_sha256 := v_version.contenido_sha256;
  new.aceptado_en := now();
  return new;
end;
$$;

-- Catálogo: el título de un documento forma parte de lo que se mostró
-- al aceptar; no se edita ni se borra (un cambio exige migración).
create function public.documentos_legales_catalogo_guardia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'documentos_legales: el catálogo no se modifica ni se borra' using errcode = '42501';
end;
$$;

-- TRUNCATE salta los triggers de fila: se prohíbe aparte.
create function public.documentos_legales_impedir_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: TRUNCATE no permitido (evidencia legal)', tg_table_name using errcode = '42501';
end;
$$;

create trigger documentos_legales_catalogo_guardia
  before update or delete on public.documentos_legales
  for each row execute function public.documentos_legales_catalogo_guardia();
create trigger documentos_legales_sin_truncate
  before truncate on public.documentos_legales
  for each statement execute function public.documentos_legales_impedir_truncate();

create trigger documentos_legales_versiones_guardia
  before insert or update or delete on public.documentos_legales_versiones
  for each row execute function public.documentos_legales_versiones_guardia();
create trigger documentos_legales_versiones_auditar
  after insert or update or delete on public.documentos_legales_versiones
  for each row execute function public.documentos_legales_versiones_auditar();
create trigger documentos_legales_versiones_sin_truncate
  before truncate on public.documentos_legales_versiones
  for each statement execute function public.documentos_legales_impedir_truncate();

create trigger requisitos_legales_auditar
  after insert or update or delete on public.requisitos_legales
  for each row execute function public.requisitos_legales_auditar();
create trigger requisitos_legales_sin_truncate
  before truncate on public.requisitos_legales
  for each statement execute function public.documentos_legales_impedir_truncate();

create trigger aceptaciones_legales_guardia
  before insert or update or delete on public.aceptaciones_legales
  for each row execute function public.aceptaciones_legales_guardia();
create trigger aceptaciones_legales_sin_truncate
  before truncate on public.aceptaciones_legales
  for each statement execute function public.documentos_legales_impedir_truncate();

-- ── Funciones ───────────────────────────────────────────────────────

-- Versión vigente de cada documento para un país: publicada, ya en vigor
-- y la más reciente.
create function public.documentos_legales_vigentes(p_pais text)
returns table (
  version_id uuid,
  documento_clave text,
  titulo text,
  version text,
  vigente_desde timestamptz,
  requiere_nueva_aceptacion boolean,
  contenido_sha256 text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_pais is null or p_pais not in ('MX', 'AR') then
    raise exception 'documentos_legales_vigentes: país no válido' using errcode = '22023';
  end if;
  return query
  select distinct on (v.documento_clave)
         v.id, v.documento_clave, d.titulo, v.version, v.vigente_desde, v.requiere_nueva_aceptacion, v.contenido_sha256
  from public.documentos_legales_versiones v
  join public.documentos_legales d on d.clave = v.documento_clave
  where v.estado = 'publicado' and v.vigente_desde <= now() and v.jurisdiccion = p_pais
  order by v.documento_clave, v.vigente_desde desc, v.publicado_en desc;
end;
$$;

-- Contenido de una versión publicada o retirada (historial). Nunca un
-- borrador ni un aprobado sin publicar.
create function public.documento_legal_publicado(p_version_id uuid)
returns table (
  version_id uuid,
  documento_clave text,
  titulo text,
  version text,
  jurisdiccion text,
  estado text,
  vigente_desde timestamptz,
  publicado_en timestamptz,
  retirado_en timestamptz,
  contenido text,
  contenido_sha256 text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  select v.id, v.documento_clave, d.titulo, v.version, v.jurisdiccion, v.estado, v.vigente_desde,
         v.publicado_en, v.retirado_en, v.contenido, v.contenido_sha256
  from public.documentos_legales_versiones v
  join public.documentos_legales d on d.clave = v.documento_clave
  where v.id = p_version_id and v.estado in ('publicado', 'retirado') and v.publicado_en is not null;
end;
$$;

-- Lo que auth.uid() tiene pendiente en un residencial donde es miembro
-- activo. Solo devuelve documentos: nunca quién aceptó (un Acuerdo de
-- Tratamiento ya aceptado por otra persona del residencial simplemente
-- no aparece). Sin requisitos ni versiones publicadas, siempre vacío.
create function public.documentos_pendientes(p_tenant_id uuid)
returns table (
  documento_clave text,
  version_id uuid,
  version text,
  titulo text,
  tipo text,
  alcance text,
  vigente_desde timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_pais text;
begin
  if v_uid is null then
    raise exception 'documentos_pendientes: requiere una sesión' using errcode = '42501';
  end if;
  select r.clave, t.pais into v_rol, v_pais
  from public.user_tenants ut
  join public.roles r on r.id = ut.rol_id
  join public.tenants t on t.id = ut.tenant_id
  where ut.user_id = v_uid and ut.tenant_id = p_tenant_id and ut.activo;
  if v_rol is null then
    raise exception 'documentos_pendientes: sin membresía activa en el residencial' using errcode = '42501';
  end if;

  return query
  with req as (
    select q.documento_clave, q.tipo, q.alcance
    from public.requisitos_legales q
    where q.rol_clave = v_rol and q.jurisdiccion = v_pais
  ),
  vig as (
    select distinct on (v.documento_clave) v.documento_clave, v.id, v.version, v.vigente_desde
    from public.documentos_legales_versiones v
    where v.estado = 'publicado' and v.vigente_desde <= now() and v.jurisdiccion = v_pais
      and v.documento_clave in (select req.documento_clave from req)
    order by v.documento_clave, v.vigente_desde desc, v.publicado_en desc
  )
  select req.documento_clave, vig.id, vig.version, d.titulo, req.tipo, req.alcance, vig.vigente_desde
  from req
  join vig on vig.documento_clave = req.documento_clave
  join public.documentos_legales d on d.clave = req.documento_clave
  -- Fecha a partir de la cual una aceptación cuenta: la de la última
  -- versión (en vigor, hasta la vigente) que exigió nueva aceptación.
  cross join lateral (
    select coalesce(max(b.vigente_desde), '-infinity'::timestamptz) as desde
    from public.documentos_legales_versiones b
    where b.documento_clave = req.documento_clave and b.requiere_nueva_aceptacion
      and b.estado in ('publicado', 'retirado') and b.publicado_en is not null
      and b.vigente_desde <= vig.vigente_desde and b.jurisdiccion = v_pais
  ) base
  where not exists (
    select 1
    from public.aceptaciones_legales a
    join public.documentos_legales_versiones w on w.id = a.version_id
    where w.documento_clave = req.documento_clave
      and w.jurisdiccion = v_pais
      and w.vigente_desde >= base.desde and w.vigente_desde <= vig.vigente_desde
      and a.tipo = req.tipo
      and ((req.alcance = 'usuario' and a.alcance = 'usuario' and a.user_id = v_uid)
        or (req.alcance = 'residencial' and a.alcance = 'residencial' and a.tenant_id = p_tenant_id))
      and (a.tipo <> 'consentimiento'
           or not exists (select 1 from public.aceptaciones_legales x where x.revoca_aceptacion_id = a.id))
  )
  order by req.documento_clave;
end;
$$;

-- Registra la aceptación/acuse/consentimiento de auth.uid() para las
-- versiones indicadas, en un residencial donde es miembro activo.
--   * Solo versiones vigentes que un requisito de su rol y país exige;
--     el tipo y el alcance salen del requisito, nunca del llamador.
--   * Todo o nada: se valida la lista entera antes de escribir.
--   * Idempotente: lo ya registrado cuenta como "ya_existentes" (en un
--     Acuerdo de Tratamiento, también si lo aceptó otro admin; no se dice
--     quién).
--   * El origen 'registro' es exclusivo del alta (crear_cuenta_prueba,
--     fase 3); aquí solo invitación o aceptación posterior.
--   * El alcance de residencial exige p_declara_facultades = true
--     (declaración no validada; ver cabecera).
--   * No exige tenant_operativo: un residencial bloqueado debe poder
--     aceptar y reconocer.
create function public.registrar_aceptaciones(
  p_tenant_id uuid,
  p_version_ids uuid[],
  p_origen text,
  p_declara_facultades boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_pais text;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_id uuid;
  v_tipo text;
  v_alcance text;
  v_clave text;
  v_nuevo uuid;
  v_registradas int := 0;
  v_existentes int := 0;
begin
  if v_uid is null then
    raise exception 'registrar_aceptaciones: requiere una sesión' using errcode = '42501';
  end if;
  if p_origen is null or p_origen not in ('invitacion', 'aceptacion_posterior') then
    raise exception 'registrar_aceptaciones: origen no permitido' using errcode = '22023';
  end if;
  if p_version_ids is null or cardinality(p_version_ids) = 0 or cardinality(p_version_ids) > 10
     or array_position(p_version_ids, null) is not null
     or cardinality(p_version_ids) <> (select count(distinct x) from unnest(p_version_ids) x) then
    raise exception 'registrar_aceptaciones: lista de versiones no válida' using errcode = '22023';
  end if;

  -- Membresía activa (bloqueada: una baja simultánea espera a que esto termine).
  select r.clave, t.pais into v_rol, v_pais
  from public.user_tenants ut
  join public.roles r on r.id = ut.rol_id
  join public.tenants t on t.id = ut.tenant_id
  where ut.user_id = v_uid and ut.tenant_id = p_tenant_id and ut.activo
  for share of ut;
  if v_rol is null then
    raise exception 'registrar_aceptaciones: sin membresía activa en el residencial' using errcode = '42501';
  end if;

  -- 1) Validar toda la lista antes de escribir nada.
  foreach v_id in array p_version_ids loop
    select q.tipo, q.alcance, vig.documento_clave
      into v_tipo, v_alcance, v_clave
    from public.requisitos_legales q
    cross join lateral (
      select v.id, v.documento_clave
      from public.documentos_legales_versiones v
      where v.documento_clave = q.documento_clave and v.estado = 'publicado'
        and v.vigente_desde <= now() and v.jurisdiccion = v_pais
      order by v.vigente_desde desc, v.publicado_en desc
      limit 1
    ) vig
    where q.rol_clave = v_rol and q.jurisdiccion = v_pais and vig.id = v_id;
    if not found then
      raise exception 'registrar_aceptaciones: documento_no_aplicable' using errcode = '22023';
    end if;
    if v_alcance = 'residencial' and p_declara_facultades is not true then
      raise exception 'registrar_aceptaciones: falta_declaracion_facultades' using errcode = '22023';
    end if;
    v_items := v_items || jsonb_build_object('id', v_id, 'tipo', v_tipo, 'alcance', v_alcance, 'clave', v_clave);
  end loop;

  -- 2) Escribir.
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_id := (v_item->>'id')::uuid;
    v_tipo := v_item->>'tipo';
    v_alcance := v_item->>'alcance';
    v_nuevo := null;

    if v_alcance = 'residencial' then
      insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, declara_facultades, contenido_sha256)
      values (v_uid, p_tenant_id, v_id, v_tipo, 'residencial', p_origen, true, repeat('0', 64))
      on conflict (tenant_id, version_id) where alcance = 'residencial' do nothing
      returning id into v_nuevo;
    elsif v_tipo in ('aceptacion', 'acuse') then
      insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, declara_facultades, contenido_sha256)
      values (v_uid, p_tenant_id, v_id, v_tipo, 'usuario', p_origen, false, repeat('0', 64))
      on conflict (user_id, version_id) where alcance = 'usuario' and tipo in ('aceptacion', 'acuse') do nothing
      returning id into v_nuevo;
    else
      -- Consentimiento: admite revocación, así que no tiene índice único;
      -- se serializa por usuario y versión.
      perform pg_advisory_xact_lock(hashtextextended('aceptaciones_legales:' || v_uid::text || ':' || v_id::text, 0));
      if not exists (
        select 1 from public.aceptaciones_legales a
        where a.user_id = v_uid and a.version_id = v_id and a.tipo = 'consentimiento'
          and not exists (select 1 from public.aceptaciones_legales x where x.revoca_aceptacion_id = a.id)
      ) then
        insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, declara_facultades, contenido_sha256)
        values (v_uid, p_tenant_id, v_id, 'consentimiento', 'usuario', p_origen, false, repeat('0', 64))
        returning id into v_nuevo;
      end if;
    end if;

    if v_nuevo is null then
      v_existentes := v_existentes + 1;
    else
      v_registradas := v_registradas + 1;
      -- Compatibilidad: users.terminos_aceptados_en sigue reflejando la
      -- última aceptación de Términos.
      if v_item->>'clave' = 'terminos' and v_tipo = 'aceptacion' then
        update public.users set terminos_aceptados_en = now() where id = v_uid;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'registradas', v_registradas,
    'ya_existentes', v_existentes,
    'pendientes', (select count(*) from public.documentos_pendientes(p_tenant_id))
  );
end;
$$;

-- Descarta la evidencia de un alta fallida (fase 3: lo llamará
-- revertir_cuenta_prueba antes de borrar el usuario). Solo si la cuenta
-- nunca se confirmó ni se usó, no tiene otras membresías y toda su
-- evidencia es del registro de ESE residencial; si no, falla sin borrar
-- nada y la evidencia se conserva. La cuenta real nunca entra aquí.
create function public.descartar_aceptaciones_alta_fallida(p_user_id uuid, p_tenant_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_confirmado timestamptz;
  v_acceso timestamptz;
  v_n integer;
begin
  if p_user_id is null or p_tenant_id is null then
    raise exception 'descartar_aceptaciones_alta_fallida: faltan usuario o residencial' using errcode = '22023';
  end if;
  select u.email_confirmed_at, u.last_sign_in_at into v_confirmado, v_acceso
  from auth.users u where u.id = p_user_id;
  if not found then
    raise exception 'descartar_aceptaciones_alta_fallida: usuario inexistente' using errcode = '22023';
  end if;
  if v_confirmado is not null or v_acceso is not null then
    raise exception 'descartar_aceptaciones_alta_fallida: la cuenta se confirmó o se usó; su evidencia se conserva' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_tenants ut where ut.user_id = p_user_id and ut.tenant_id <> p_tenant_id) then
    raise exception 'descartar_aceptaciones_alta_fallida: el usuario tiene otras membresías' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.aceptaciones_legales a
    where (a.user_id = p_user_id and (a.tenant_id is distinct from p_tenant_id or a.origen <> 'registro'))
       or (a.tenant_id = p_tenant_id and a.user_id <> p_user_id)
  ) then
    raise exception 'descartar_aceptaciones_alta_fallida: hay evidencia que no es de esta alta; se conserva' using errcode = '42501';
  end if;

  perform set_config('gateflow.borrado_aceptaciones', 'alta_fallida', true);
  delete from public.aceptaciones_legales a
  where a.user_id = p_user_id and a.tenant_id = p_tenant_id and a.origen = 'registro';
  get diagnostics v_n = row_count;
  perform set_config('gateflow.borrado_aceptaciones', '', true);
  return v_n;
end;
$$;

-- ── Seguridad: RLS sin políticas y ningún permiso para la API ───────
alter table public.documentos_legales enable row level security;
alter table public.documentos_legales_versiones enable row level security;
alter table public.requisitos_legales enable row level security;
alter table public.aceptaciones_legales enable row level security;

revoke all on table public.documentos_legales from public, anon, authenticated, service_role;
revoke all on table public.documentos_legales_versiones from public, anon, authenticated, service_role;
revoke all on table public.requisitos_legales from public, anon, authenticated, service_role;
revoke all on table public.aceptaciones_legales from public, anon, authenticated, service_role;

revoke execute on function public.documentos_legales_catalogo_guardia() from public, anon, authenticated, service_role;
revoke execute on function public.documentos_legales_versiones_guardia() from public, anon, authenticated, service_role;
revoke execute on function public.documentos_legales_versiones_auditar() from public, anon, authenticated, service_role;
revoke execute on function public.requisitos_legales_auditar() from public, anon, authenticated, service_role;
revoke execute on function public.aceptaciones_legales_guardia() from public, anon, authenticated, service_role;
revoke execute on function public.documentos_legales_impedir_truncate() from public, anon, authenticated, service_role;
revoke execute on function public.documentos_legales_vigentes(text) from public, anon, authenticated, service_role;
revoke execute on function public.documento_legal_publicado(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.documentos_pendientes(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.registrar_aceptaciones(uuid, uuid[], text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.descartar_aceptaciones_alta_fallida(uuid, uuid) from public, anon, authenticated, service_role;
