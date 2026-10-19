-- ============================================================
-- Eliminación manual asistida de un residencial (20261018000000).
-- Cada caso arma un residencial SINTÉTICO («ZZ …») dentro de su propia
-- transacción y la revierte. El residencial B de los fixtures es el
-- vecino que nunca debe cambiar.
-- ============================================================

do $$
begin
  if to_regprocedure('public.eliminacion_residencial_simular(uuid,text)') is null then
    raise notice 'INFO|99_eliminacion_residencial omitido: migración no aplicada';
  end if;
end $$;

select to_regprocedure('public.eliminacion_residencial_simular(uuid,text)') is not null as hay_er \gset
\if :hay_er

-- Residencial ZZ con datos, archivos, cuentas exclusivas y compartidas,
-- evidencia legal y un evento de pago. p_estado/p_fin: la suscripción.
create or replace function tests.er_escenario(p_estado text default 'trialing', p_fin interval default interval '40 days',
                                              p_empresa_compartida boolean default false)
returns jsonb language plpgsql as $$
declare
  t uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  u_guardia uuid := gen_random_uuid();
  u_residente uuid := gen_random_uuid();
  u_referenciado uuid := gen_random_uuid();
  u_compartido uuid := gen_random_uuid();
  v_unidad uuid := gen_random_uuid();
  v_ubic uuid := gen_random_uuid();
  v_paquete uuid := gen_random_uuid();
  v_rol_admin uuid := (select id from public.roles where clave = 'admin_residencial');
  v_rol_guardia uuid := (select id from public.roles where clave = 'guardia');
  v_rol_residente uuid := (select id from public.roles where clave = 'residente');
begin
  if p_empresa_compartida then
    e := 'e0000000-0000-0000-0000-000000000001';
  else
    insert into public.empresas (id, nombre, correo_principal) values (e, 'ZZ Empresa Eliminable', 'zz_empresa@test.local');
  end if;
  insert into public.tenants (id, nombre, tipo, empresa_id, pais, onboarding_completado, admin_contacto_email)
  values (t, 'ZZ Residencial Eliminable', 'residencial', e, 'MX', true, 'zz_contacto@test.local');
  insert into public.suscripciones (tenant_id, estado, trial_started_at, trial_ends_at, origen, current_period_end, cancel_at_period_end, impago_desde, plan)
  values (t, p_estado, now() - p_fin - interval '30 days', now() - p_fin, 'registro_publico',
          case when p_estado in ('active', 'canceled', 'past_due') then now() - p_fin end,
          false,
          case when p_estado = 'past_due' then now() - p_fin end,
          case when p_estado in ('active', 'canceled', 'past_due') then 'hasta-50' end);

  insert into auth.users (id, email) values
    (u_admin, 'zz_er_admin_' || t || '@test.local'),
    (u_guardia, 'zz_er_guardia_' || t || '@test.local'),
    (u_residente, 'zz_er_residente_' || t || '@test.local'),
    (u_referenciado, 'zz_er_referenciado_' || t || '@test.local'),
    (u_compartido, 'zz_er_compartido_' || t || '@test.local');
  update public.users set nombre_completo = 'ZZ Persona Sintética' where id in (u_admin, u_guardia, u_residente, u_referenciado, u_compartido);
  update public.users set telefono = '529981' || lpad(floor(random() * 1000000)::text, 6, '0') where id = u_admin;
  insert into public.user_tenants (user_id, tenant_id, rol_id) values
    (u_admin, t, v_rol_admin), (u_guardia, t, v_rol_guardia), (u_residente, t, v_rol_residente),
    (u_referenciado, t, v_rol_guardia), (u_compartido, t, v_rol_admin),
    (u_compartido, 'bbbbbbbb-0000-0000-0000-000000000000', v_rol_guardia);

  insert into public.unidades (id, tenant_id, tipo, identificador, contacto_nombre) values (v_unidad, t, 'casa', 'ZZ Casa 1', 'ZZ Contacto');
  insert into public.ubicaciones (id, tenant_id, nombre, tipo_nodo) values (v_ubic, t, 'ZZ Estante', 'estante');
  insert into public.residentes_unidades (tenant_id, user_id, unidad_id, origen) values (t, u_residente, v_unidad, 'cuenta');
  insert into public.residentes_unidades (tenant_id, unidad_id, origen, nombre, apellido, telefono) values (t, v_unidad, 'enlace', 'Zz', 'Sintético', '529981234568');
  insert into public.paquetes (id, tenant_id, unidad_id, recibido_por, ubicacion_id, residente_id, fecha_recepcion)
  values (v_paquete, t, v_unidad, u_guardia, v_ubic, u_residente, now() - interval '50 days');
  insert into public.paquete_fotografias (tenant_id, paquete_id, tipo, storage_path, tomada_por)
  values (t, v_paquete, 'recepcion', t || '/' || v_paquete || '/foto.jpg', u_guardia);
  insert into public.audit_log (tenant_id, user_id, accion, entidad) values (t, u_admin, 'zz_prueba', 'paquetes');
  -- El «referenciado» dejó un rastro en el residencial B: su perfil no se puede borrar.
  insert into public.audit_log (tenant_id, user_id, accion, entidad) values ('bbbbbbbb-0000-0000-0000-000000000000', u_referenciado, 'zz_prueba', 'paquetes');

  insert into storage.objects (bucket_id, name) values
    ('evidencia', t || '/' || v_paquete || '/foto.jpg'),
    ('logos', t || '/logo.png');

  -- Evidencia legal y pago: se conservan (la guardia de aceptaciones se
  -- omite solo para fabricar la fila de prueba).
  set local session_replication_role = replica;
  insert into public.aceptaciones_legales (user_id, tenant_id, version_id, tipo, alcance, origen, declara_facultades, contenido_sha256)
  values (u_admin, t, gen_random_uuid(), 'aceptacion', 'residencial', 'registro', true, repeat('0', 64));
  set local session_replication_role = origin;
  insert into public.billing_eventos (provider, provider_event_id, tipo, tenant_id, resultado, detalle)
  values ('stripe', 'evt_zz_' || t, 'zz.prueba', t, 'aplicado', '{}'::jsonb);

  perform public.refrescar_dashboard();
  return jsonb_build_object('t', t, 'e', e, 'admin', u_admin, 'guardia', u_guardia, 'residente', u_residente,
                            'referenciado', u_referenciado, 'compartido', u_compartido);
end $$;

-- Llamadas como service_role (como el script por PostgREST).
create or replace function tests.er_simular(p_tenant uuid, p_operador text default 'ticket-123') returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  r := public.eliminacion_residencial_simular(p_tenant, p_operador);
  execute 'reset role';
  return r;
exception when others then
  execute 'reset role';
  raise;
end $$;

create or replace function tests.er_ejecutar(p_id uuid, p_codigo text, p_nombre text default 'ZZ Residencial Eliminable') returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  r := public.eliminacion_residencial_ejecutar(p_id, p_codigo, p_nombre);
  execute 'reset role';
  return r;
exception when others then
  execute 'reset role';
  raise;
end $$;

create or replace function tests.er_completar(p_id uuid) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  r := public.eliminacion_residencial_completar(p_id);
  execute 'reset role';
  return r;
exception when others then
  execute 'reset role';
  raise;
end $$;

-- Huella del residencial B (el vecino): no debe cambiar nunca.
create or replace function tests.er_huella_b() returns text language sql as $$
  select md5(string_agg(x, '|' order by x)) from (
    select 'ut' || count(*) from public.user_tenants where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    union all select 'pq' || count(*) from public.paquetes where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    union all select 'un' || count(*) from public.unidades where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    union all select 'al' || count(*) from public.audit_log where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    union all select 'st' || count(*) from storage.objects where split_part(name, '/', 1) = 'bbbbbbbb-0000-0000-0000-000000000000'
    union all select 'em' || count(*) from public.empresas where id = 'e0000000-0000-0000-0000-000000000001'
  ) h(x);
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role, supabase_auth_admin;

-- ── Permisos ──
do $$
declare f text;
begin
  foreach f in array array['public.eliminacion_residencial_simular(uuid,text)', 'public.eliminacion_residencial_ejecutar(uuid,text,text)', 'public.eliminacion_residencial_completar(uuid)',
                           'public.eliminacion_residencial_pendientes()'] loop
    perform tests.igual('ER-01', 'solo service_role ejecuta ' || f,
      format($q$select has_function_privilege('anon', %L, 'execute')::text || has_function_privilege('authenticated', %L, 'execute')::text || has_function_privilege('service_role', %L, 'execute')::text$q$, f, f, f),
      'falsefalsetrue');
  end loop;
  foreach f in array array['public.eliminacion_residencial_servicio(uuid)', 'public.eliminacion_residencial_conteo(uuid)', 'public.eliminacion_residencial_cuentas(uuid)',
                           'public.eliminacion_residencial_cuenta_referenciada(uuid)', 'public.eliminacion_residencial_archivos(uuid)'] loop
    perform tests.igual('ER-02', 'ayudante interno sin EXECUTE para la API: ' || f,
      format($q$select (has_function_privilege('anon', %L, 'execute') or has_function_privilege('authenticated', %L, 'execute') or has_function_privilege('service_role', %L, 'execute'))::text$q$, f, f, f),
      'false');
  end loop;
  perform tests.igual('ER-02b', 'la verificación de residencial vacío solo la ejecuta authenticated (la usa la política de borrado)',
    $q$select has_function_privilege('anon', 'public.eliminacion_residencial_vacio(uuid)', 'execute')::text
           || has_function_privilege('authenticated', 'public.eliminacion_residencial_vacio(uuid)', 'execute')::text
           || has_function_privilege('service_role', 'public.eliminacion_residencial_vacio(uuid)', 'execute')::text$q$,
    'falsetruefalse');
  perform tests.igual('ER-03', 'el registro no se lee ni se escribe desde la API (ni con service_role)',
    $q$select (has_table_privilege('anon', 'public.eliminaciones_residencial', 'select,insert,update,delete')
            or has_table_privilege('authenticated', 'public.eliminaciones_residencial', 'select,insert,update,delete')
            or has_table_privilege('service_role', 'public.eliminaciones_residencial', 'select,insert,update,delete'))::text$q$,
    'false');
end $$;

begin;
do $$
declare x jsonb := tests.er_escenario('expired');
begin
  perform tests.como('00000000-0000-0000-0000-00000000000a');
  execute 'set local role authenticated';
  perform tests.debe_fallar('ER-04', 'un admin (authenticated) no puede simular', format('select public.eliminacion_residencial_simular(%L, %L)', x->>'t', 'ticket-1'), '42501');
  perform tests.debe_fallar('ER-05', 'un admin (authenticated) no puede ejecutar', format('select public.eliminacion_residencial_ejecutar(%L, %L, %L)', gen_random_uuid(), 'X', 'Y'), '42501');
  execute 'reset role';
end $$;
rollback;

-- ── Elegibilidad: nunca un residencial activo ──
begin;
do $$
declare
  c record;
  x jsonb;
  r jsonb;
begin
  for c in select * from (values
    ('trialing', interval '-5 days', 'prueba_en_curso'),
    ('trialing', interval '10 days', 'menos_de_30_dias'),
    ('trialing', interval '29 days 23 hours', 'menos_de_30_dias'),
    ('active', interval '60 days', 'suscripcion_activa'),
    ('past_due', interval '90 days', 'suscripcion_en_impago'),
    ('canceled', interval '-3 days', 'menos_de_30_dias'),
    ('canceled', interval '20 days', 'menos_de_30_dias'),
    ('canceled', interval '31 days', null),
    ('expired', interval '40 days', null),
    ('trialing', interval '40 days', null)
  ) v(estado, fin, motivo) loop
    x := tests.er_escenario(c.estado, c.fin);
    r := tests.er_simular((x->>'t')::uuid);
    perform tests.lg_ok('ER-10', format('%s, terminó hace %s → %s', c.estado, c.fin, coalesce(c.motivo, 'elegible')),
      (r->>'elegible')::boolean = (c.motivo is null) and (r->>'motivo') is not distinct from c.motivo
        and ((r->>'codigo') is null) = (c.motivo is not null),
      r::text);
  end loop;
end $$;
rollback;

begin;
do $$
declare x jsonb; r jsonb;
begin
  -- Sin suscripción (alta antigua): no se decide solo.
  x := tests.er_escenario('expired');
  delete from public.suscripciones where tenant_id = (x->>'t')::uuid;
  r := tests.er_simular((x->>'t')::uuid);
  perform tests.lg_ok('ER-11', 'sin suscripción → no elegible (sin_suscripcion)', r->>'motivo' = 'sin_suscripcion' and not (r->>'elegible')::boolean, r::text);
  -- El residencial de la plataforma (tiene al Super Admin): nunca.
  r := tests.er_simular('11111111-0000-0000-0000-000000000000');
  perform tests.lg_ok('ER-12', 'residencial con Super Admin → no elegible', r->>'motivo' = 'residencial_de_plataforma', r::text);
  -- Una contratación abierta: el cliente está pagando ahora mismo.
  x := tests.er_escenario('expired');
  insert into public.billing_checkouts (tenant_id, user_id, plan, provider, moneda, monto, provider_checkout_id, expires_at)
  values ((x->>'t')::uuid, (x->>'admin')::uuid, 'hasta-50', 'stripe', 'MXN', 100, 'cs_zz_' || (x->>'t'), now() + interval '20 minutes');
  r := tests.er_simular((x->>'t')::uuid);
  perform tests.lg_ok('ER-13', 'checkout abierto → no elegible (contratacion_en_curso)', r->>'motivo' = 'contratacion_en_curso', r::text);
  -- Pagado en el proveedor con el webhook pendiente: la base ya lo ve vencido.
  x := tests.er_escenario('expired');
  insert into public.billing_checkouts (tenant_id, user_id, plan, provider, moneda, monto, provider_checkout_id, expires_at, created_at)
  values ((x->>'t')::uuid, (x->>'admin')::uuid, 'hasta-50', 'stripe', 'MXN', 100, 'cs_zz_v_' || (x->>'t'), now() - interval '1 hour', now() - interval '2 hours');
  r := tests.er_simular((x->>'t')::uuid);
  perform tests.lg_ok('ER-13b', 'checkout vencido hace 1 hora (pudo pagarse, webhook pendiente) → no elegible', r->>'motivo' = 'contratacion_en_curso', r::text);
  -- Uno cancelado por un checkout posterior (pudo pagarse antes) y el posterior vencido: hace 2 días.
  x := tests.er_escenario('expired');
  insert into public.billing_checkouts (tenant_id, user_id, plan, provider, moneda, monto, provider_checkout_id, estado, expires_at, created_at)
  values ((x->>'t')::uuid, (x->>'admin')::uuid, 'hasta-50', 'stripe', 'MXN', 100, 'cs_zz_c1_' || (x->>'t'), 'canceled', now() - interval '2 days', now() - interval '2 days 1 hour'),
         ((x->>'t')::uuid, (x->>'admin')::uuid, 'hasta-50', 'stripe', 'MXN', 100, 'cs_zz_c2_' || (x->>'t'), 'expired', now() - interval '2 days', now() - interval '2 days 1 hour');
  r := tests.er_simular((x->>'t')::uuid);
  perform tests.lg_ok('ER-13c', 'checkouts cancelado y vencido hace 2 días → no elegible', r->>'motivo' = 'contratacion_en_curso', r::text);
  -- Pasados 7 días sin aviso del proveedor, ya no frena la eliminación.
  x := tests.er_escenario('expired');
  insert into public.billing_checkouts (tenant_id, user_id, plan, provider, moneda, monto, provider_checkout_id, estado, expires_at, created_at)
  values ((x->>'t')::uuid, (x->>'admin')::uuid, 'hasta-50', 'stripe', 'MXN', 100, 'cs_zz_8_' || (x->>'t'), 'expired', now() - interval '8 days', now() - interval '8 days 1 hour');
  r := tests.er_simular((x->>'t')::uuid);
  perform tests.lg_ok('ER-13d', 'último checkout vencido hace 8 días → elegible', (r->>'elegible')::boolean, r::text);
  perform tests.debe_fallar('ER-14', 'residencial inexistente → error', format('select tests.er_simular(%L)', gen_random_uuid()), '22023');
  perform tests.debe_fallar('ER-15', 'operador con @ (un correo) → rechazado', format('select tests.er_simular(%L, %L)', x->>'t', 'ana@example.com'), '22023');
  perform tests.debe_fallar('ER-16', 'operador con espacios (un nombre) → rechazado', format('select tests.er_simular(%L, %L)', x->>'t', 'Ana Pérez'), '22023');
end $$;
rollback;

-- ── Simulación: informa y no borra nada ──
begin;
do $$
declare x jsonb; r jsonb; t uuid; reg record; antes text;
begin
  x := tests.er_escenario('expired');
  t := (x->>'t')::uuid;
  antes := tests.er_huella_b();
  r := tests.er_simular(t);
  perform tests.lg_ok('ER-20', 'elegible: código de 10 caracteres válido 30 minutos y el nombre para verificar',
    (r->>'elegible')::boolean and r->>'codigo' ~ '^[0-9A-F]{10}$' and r#>>'{residencial,nombre}' = 'ZZ Residencial Eliminable'
      and (r->>'expira_en')::timestamptz between now() + interval '29 minutes' and now() + interval '31 minutes', r::text);
  perform tests.lg_ok('ER-21', 'cuenta lo que se borraría (datos, archivos por bucket, cuentas) y lo que se conserva',
    (r#>>'{datos,tenants}')::int = 1 and (r#>>'{datos,paquetes}')::int = 1 and (r#>>'{datos,user_tenants}')::int = 5
      and (r#>>'{datos,residentes_unidades}')::int = 2 and (r#>>'{datos,paquete_fotografias}')::int = 1
      and (r#>>'{datos,mv_dashboard_diario}')::int = 1 and (r#>>'{datos,suscripciones}')::int = 1
      and (r#>>'{archivos,evidencia}')::int = 1 and (r#>>'{archivos,logos}')::int = 1
      and (r#>>'{cuentas,exclusivas}')::int = 4 and (r#>>'{cuentas,compartidas}')::int = 1
      and (r#>>'{se_conservan,aceptaciones_legales}')::int = 1 and (r#>>'{se_conservan,billing_eventos}')::int = 1
      and r->>'empresa_compartida' = 'false', r::text);
  perform tests.lg_ok('ER-22', 'la simulación no borra nada',
    public.eliminacion_residencial_conteo(t) = (r->'datos') and public.eliminacion_residencial_archivos(t) = (r->'archivos')
      and tests.er_huella_b() = antes);
  select * into reg from public.eliminaciones_residencial where id = (r->>'eliminacion_id')::uuid;
  perform tests.lg_ok('ER-23', 'registro «simulada» con operador, fin de servicio y el código solo como hash',
    reg.estado = 'simulada' and reg.operador = 'ticket-123' and reg.fin_servicio is not null
      and reg.codigo_sha256 = encode(sha256(convert_to(r->>'codigo', 'UTF8')), 'hex') and reg.tenant_id = t);
  perform tests.lg_ok('ER-24', 'el registro no guarda nombres, correos, teléfonos ni el código',
    position('ZZ Residencial' in row_to_json(reg)::text) = 0 and position('@' in row_to_json(reg)::text) = 0
      and position('ZZ Persona' in row_to_json(reg)::text) = 0 and position('5299' in row_to_json(reg)::text) = 0
      and position((r->>'codigo') in row_to_json(reg)::text) = 0, row_to_json(reg)::text);
end $$;
rollback;

-- ── Confirmación explícita ──
begin;
do $$
declare x jsonb; r jsonb; t uuid; v_id uuid;
begin
  x := tests.er_escenario('expired');
  t := (x->>'t')::uuid;
  r := tests.er_simular(t);
  v_id := (r->>'eliminacion_id')::uuid;
  perform tests.debe_fallar('ER-30', 'código incorrecto → no ejecuta', format('select tests.er_ejecutar(%L, %L)', v_id, 'AAAAAAAAAA'), '22023');
  perform tests.debe_fallar('ER-31', 'nombre distinto → no ejecuta', format('select tests.er_ejecutar(%L, %L, %L)', v_id, r->>'codigo', 'ZZ Residencial Eliminable 2'), '22023');
  perform tests.debe_fallar('ER-32', 'sin nombre → no ejecuta', format('select tests.er_ejecutar(%L, %L, null)', v_id, r->>'codigo'), '22023');
  perform tests.lg_ok('ER-33', 'tras los intentos fallidos no se borró nada y la simulación sigue utilizable',
    public.eliminacion_residencial_conteo(t) ? 'tenants' and (select estado from public.eliminaciones_residencial where eliminaciones_residencial.id = v_id) = 'simulada');
  update public.eliminaciones_residencial set expira_en = now() - interval '1 second' where eliminaciones_residencial.id = v_id;
  perform tests.debe_fallar('ER-34', 'simulación vencida → no ejecuta', format('select tests.er_ejecutar(%L, %L)', v_id, r->>'codigo'), '22023');
  -- Una simulación no elegible no se puede ejecutar.
  update public.suscripciones set estado = 'active', plan = 'hasta-50', current_period_end = now() + interval '20 days' where tenant_id = t;
  r := tests.er_simular(t);
  perform tests.debe_fallar('ER-35', 'simulación «no_elegible» → no ejecuta', format('select tests.er_ejecutar(%L, %L)', r->>'eliminacion_id', 'AAAAAAAAAA'), '22023');
end $$;
rollback;

-- ── Si el cliente contrata, se cancela ──
begin;
do $$
declare x jsonb; r jsonb; e jsonb; t uuid;
begin
  x := tests.er_escenario('expired');
  t := (x->>'t')::uuid;
  r := tests.er_simular(t);
  update public.suscripciones set estado = 'active', plan = 'hasta-50', provider = 'stripe', provider_subscription_id = 'sub_zz', current_period_end = now() + interval '30 days' where tenant_id = t;
  e := tests.er_ejecutar((r->>'eliminacion_id')::uuid, r->>'codigo');
  perform tests.lg_ok('ER-40', 'contrató después de la simulación → cancelada (suscripcion_activa), sin borrar',
    e->>'ok' = 'false' and e->>'estado' = 'cancelada' and e->>'motivo' = 'suscripcion_activa'
      and public.eliminacion_residencial_conteo(t) = (r->'datos')
      and (select estado || ':' || motivo from public.eliminaciones_residencial where id = (r->>'eliminacion_id')::uuid) = 'cancelada:suscripcion_activa', e::text);
  perform tests.debe_fallar('ER-41', 'la simulación cancelada no se reutiliza', format('select tests.er_ejecutar(%L, %L)', r->>'eliminacion_id', r->>'codigo'), '22023');
end $$;
rollback;

begin;
do $$
declare x jsonb; r jsonb; e jsonb; t uuid;
begin
  -- Un Super Admin cambió la prueba (sigue vencida, pero ya no es lo simulado).
  x := tests.er_escenario('expired');
  t := (x->>'t')::uuid;
  r := tests.er_simular(t);
  update public.suscripciones set trial_ends_at = trial_ends_at + interval '1 day' where tenant_id = t;
  e := tests.er_ejecutar((r->>'eliminacion_id')::uuid, r->>'codigo');
  perform tests.lg_ok('ER-42', 'la suscripción cambió desde la simulación → cancelada, sin borrar',
    e->>'estado' = 'cancelada' and e->>'motivo' = 'cambio_desde_la_simulacion' and public.eliminacion_residencial_conteo(t) ? 'tenants', e::text);
end $$;
rollback;

-- ── Ejecución completa ──
begin;
do $$
declare
  x jsonb; r jsonb; e jsonb; c jsonb; t uuid; v_id uuid; reg record;
  antes_b text := tests.er_huella_b();
begin
  x := tests.er_escenario('expired');
  t := (x->>'t')::uuid;
  insert into storage.objects (bucket_id, name) values ('evidencia', 'bbbbbbbb-0000-0000-0000-000000000000/zz/foto.jpg');
  antes_b := tests.er_huella_b();
  r := tests.er_simular(t);
  v_id := (r->>'eliminacion_id')::uuid;
  e := tests.er_ejecutar(v_id, lower(r->>'codigo'), '  ZZ Residencial Eliminable ');
  perform tests.lg_ok('ER-50', 'ejecuta (código sin distinguir mayúsculas, nombre sin espacios sobrantes) → en_curso',
    e->>'ok' = 'true' and e->>'estado' = 'en_curso' and (e->>'cuentas_pendientes')::int = 3
      and (e#>>'{archivos,evidencia}')::int = 1 and (e#>>'{archivos,logos}')::int = 1, e::text);
  perform tests.lg_ok('ER-51', 'no queda ninguna fila del residencial (tablas y agregados del panel)',
    public.eliminacion_residencial_conteo(t) = '{}'::jsonb and not exists (select 1 from public.mv_dashboard_diario where tenant_id = t),
    public.eliminacion_residencial_conteo(t)::text);
  perform tests.lg_ok('ER-52', 'la empresa exclusiva del residencial se elimina', not exists (select 1 from public.empresas where id = (x->>'e')::uuid));
  perform tests.lg_ok('ER-53', 'el residencial B no cambia (datos, archivos, empresa)', tests.er_huella_b() = antes_b);
  perform tests.lg_ok('ER-54', 'cuenta compartida: conserva perfil, cuenta y su membresía en B; pierde la del residencial',
    exists (select 1 from public.users where id = (x->>'compartido')::uuid)
      and exists (select 1 from auth.users where id = (x->>'compartido')::uuid)
      and (select string_agg(tenant_id::text, ',') from public.user_tenants where user_id = (x->>'compartido')::uuid) = 'bbbbbbbb-0000-0000-0000-000000000000');
  perform tests.lg_ok('ER-55', 'cuentas exclusivas: el perfil se borra y la cuenta de Auth queda pendiente para el script',
    not exists (select 1 from public.users where id in ((x->>'admin')::uuid, (x->>'guardia')::uuid, (x->>'residente')::uuid))
      and (select count(*) from auth.users where id in ((x->>'admin')::uuid, (x->>'guardia')::uuid, (x->>'residente')::uuid)) = 3
      and (select cuentas_pendientes @> array[(x->>'admin')::uuid, (x->>'guardia')::uuid, (x->>'residente')::uuid] and cardinality(cuentas_pendientes) = 3
           from public.eliminaciones_residencial where eliminaciones_residencial.id = v_id));
  perform tests.lg_ok('ER-56', 'cuenta exclusiva con rastro en otro residencial: se conserva y se cuenta',
    exists (select 1 from public.users where id = (x->>'referenciado')::uuid)
      and not ((select cuentas_pendientes from public.eliminaciones_residencial where eliminaciones_residencial.id = v_id) @> array[(x->>'referenciado')::uuid])
      and (select resultado#>>'{cuentas,conservadas_por_referencias}' from public.eliminaciones_residencial where eliminaciones_residencial.id = v_id) = '1');
  perform tests.lg_ok('ER-57', 'se conservan la evidencia legal (con su residencial) y el evento de pago (tenant_id en null)',
    (select count(*) from public.aceptaciones_legales where tenant_id = t and user_id = (x->>'admin')::uuid) = 1
      and (select tenant_id is null from public.billing_eventos where provider_event_id = 'evt_zz_' || t));
  select * into reg from public.eliminaciones_residencial where eliminaciones_residencial.id = v_id;
  perform tests.lg_ok('ER-58', 'el resultado registra conteos, cuentas y lo conservado, sin datos personales',
    reg.estado = 'en_curso' and reg.ejecutada_en is not null and (reg.resultado#>>'{datos_eliminados,paquetes}')::int = 1
      and reg.resultado#>>'{cuentas,exclusivas}' = '3' and reg.resultado#>>'{cuentas,compartidas}' = '1'
      and reg.resultado#>>'{se_conservan,aceptaciones_legales}' = '1' and reg.resultado->>'empresa_eliminada' = 'true'
      and position('@' in row_to_json(reg)::text) = 0 and position('ZZ ' in row_to_json(reg)::text) = 0, row_to_json(reg)::text);
  perform tests.debe_fallar('ER-59', 'no se ejecuta dos veces', format('select tests.er_ejecutar(%L, %L)', v_id, r->>'codigo'), '22023');

  -- Cierre: no se marca completada mientras queden archivos o cuentas.
  c := tests.er_completar(v_id);
  perform tests.lg_ok('ER-60', 'completar con archivos y cuentas pendientes → sigue en_curso y dice qué falta (solo de este residencial)',
    c->>'ok' = 'false' and c->>'estado' = 'en_curso' and (c->>'archivos_pendientes')::int = 2
      and jsonb_array_length(c->'cuentas_pendientes') = 3
      and c::text not like '%bbbbbbbb-0000%' and (c#>>'{archivos,logos,0}') = t || '/logo.png', c::text);
  delete from storage.objects where split_part(name, '/', 1) = t::text;     -- lo que hace la API de Storage
  c := tests.er_completar(v_id);
  perform tests.lg_ok('ER-61', 'sin archivos pero con cuentas de Auth → sigue en_curso',
    c->>'estado' = 'en_curso' and (c->>'archivos_pendientes')::int = 0 and jsonb_array_length(c->'cuentas_pendientes') = 3, c::text);
  delete from auth.users where id in ((x->>'admin')::uuid, (x->>'guardia')::uuid, (x->>'residente')::uuid);   -- lo que hace la API de Auth
  c := tests.er_completar(v_id);
  select * into reg from public.eliminaciones_residencial where eliminaciones_residencial.id = v_id;
  perform tests.lg_ok('ER-62', 'sin archivos ni cuentas → completada; la lista de cuentas se vacía',
    c->>'ok' = 'true' and c->>'estado' = 'completada' and reg.estado = 'completada' and reg.completada_en is not null and reg.cuentas_pendientes = '{}', c::text);
  perform tests.lg_ok('ER-63', 'completar de nuevo es idempotente', tests.er_completar(v_id)->>'estado' = 'completada');
  perform tests.lg_ok('ER-64', 'el archivo del residencial B sigue ahí', exists (select 1 from storage.objects where name = 'bbbbbbbb-0000-0000-0000-000000000000/zz/foto.jpg'));
  perform tests.debe_fallar('ER-65', 'simular un residencial ya eliminado → inexistente', format('select tests.er_simular(%L)', t), '22023');
end $$;
rollback;

-- ── Empresa compartida ──
begin;
do $$
declare x jsonb; r jsonb; e jsonb;
begin
  x := tests.er_escenario('expired', interval '40 days', true);
  r := tests.er_simular((x->>'t')::uuid);
  e := tests.er_ejecutar((r->>'eliminacion_id')::uuid, r->>'codigo');
  perform tests.lg_ok('ER-70', 'empresa con otros residenciales: se avisa en la simulación y no se borra',
    r->>'empresa_compartida' = 'true' and e->>'ok' = 'true' and exists (select 1 from public.empresas where id = 'e0000000-0000-0000-0000-000000000001')
      and (select resultado->>'empresa_eliminada' from public.eliminaciones_residencial where id = (r->>'eliminacion_id')::uuid) = 'false', e::text);
end $$;
rollback;

-- ── Ante un error no borra nada y no dice que terminó ──
begin;
create function tests.er_falla() returns trigger language plpgsql as $$
begin
  raise exception 'ZZ fallo con datos sensibles zz_persona@test.local' using errcode = 'P0001';
end $$;
create trigger zz_er_falla before delete on public.paquetes for each row execute function tests.er_falla();
do $$
declare x jsonb; r jsonb; e jsonb; c jsonb; t uuid; reg record;
begin
  x := tests.er_escenario('expired');
  t := (x->>'t')::uuid;
  r := tests.er_simular(t);
  e := tests.er_ejecutar((r->>'eliminacion_id')::uuid, r->>'codigo');
  select * into reg from public.eliminaciones_residencial where id = (r->>'eliminacion_id')::uuid;
  perform tests.lg_ok('ER-80', 'un error a mitad → fallida, con el código del error', e->>'ok' = 'false' and e->>'estado' = 'fallida' and e->>'sqlstate' = 'P0001', e::text);
  perform tests.lg_ok('ER-81', 'no se borró nada: datos, perfiles, empresa y archivos intactos',
    public.eliminacion_residencial_conteo(t) = (r->'datos') and public.eliminacion_residencial_archivos(t) = (r->'archivos')
      and exists (select 1 from public.users where id = (x->>'admin')::uuid) and exists (select 1 from public.empresas where id = (x->>'e')::uuid));
  perform tests.lg_ok('ER-82', 'el registro guarda el código, no el mensaje (que puede traer datos)',
    reg.estado = 'fallida' and reg.error_sqlstate = 'P0001' and position('zz_persona' in row_to_json(reg)::text) = 0
      and position('sensibles' in row_to_json(reg)::text) = 0 and reg.cuentas_pendientes = '{}', row_to_json(reg)::text);
  c := tests.er_completar((r->>'eliminacion_id')::uuid);
  perform tests.lg_ok('ER-83', 'una eliminación fallida nunca se marca completada', c->>'ok' = 'false' and c->>'estado' = 'fallida', c::text);
  perform tests.debe_fallar('ER-84', 'la simulación fallida no se reutiliza: hay que simular de nuevo', format('select tests.er_ejecutar(%L, %L)', r->>'eliminacion_id', r->>'codigo'), '22023');
end $$;
rollback;

-- ── El borrado directo de Super Admin ya no deja eliminaciones a medias ──
begin;
do $$
declare
  x jsonb;
  v_vacio uuid := gen_random_uuid();
  v_logo uuid := gen_random_uuid();
begin
  x := tests.er_escenario('expired');
  -- Recién creados (como al revertir un alta con invitación): solo la fila y su suscripción.
  insert into public.tenants (id, nombre, tipo, empresa_id) values
    (v_vacio, 'ZZ Recién creado', 'residencial', 'e0000000-0000-0000-0000-000000000001'),
    (v_logo, 'ZZ Con logo', 'residencial', 'e0000000-0000-0000-0000-000000000001');
  insert into public.suscripciones (tenant_id, estado, origen) values (v_vacio, 'active', 'alta_manual'), (v_logo, 'active', 'alta_manual');
  insert into storage.objects (bucket_id, name) values ('logos', v_logo || '/logo.png');

  perform tests.como('00000000-0000-0000-0000-000000000001');   -- Super Admin
  execute 'set local role authenticated';
  perform tests.filas('ER-90', 'Super Admin por la API: un residencial con datos NO se borra (0 filas)', format('delete from public.tenants where id = %L', x->>'t'), 0);
  perform tests.filas('ER-91', 'Super Admin por la API: con un archivo en Storage tampoco (0 filas)', format('delete from public.tenants where id = %L', v_logo), 0);
  perform tests.filas('ER-92', 'Super Admin por la API: un residencial vacío sí (reversión de un alta)', format('delete from public.tenants where id = %L', v_vacio), 1);
  execute 'reset role';
  perform tests.lg_ok('ER-93', 'el residencial con datos y el del logo siguen intactos',
    public.eliminacion_residencial_conteo((x->>'t')::uuid) ? 'paquetes' and exists (select 1 from public.tenants where id = v_logo));

  insert into public.tenants (id, nombre, tipo, empresa_id) values (v_vacio, 'ZZ Recién creado', 'residencial', 'e0000000-0000-0000-0000-000000000001');
  perform tests.como('00000000-0000-0000-0000-00000000000a');   -- admin de A, no Super Admin
  execute 'set local role authenticated';
  perform tests.filas('ER-94', 'un admin de residencial no borra residenciales, ni vacíos', format('delete from public.tenants where id = %L', v_vacio), 0);
  perform tests.lg_ok('ER-95', 'para quien no es Super Admin la verificación siempre dice false (no revela nada)', not public.eliminacion_residencial_vacio(v_vacio));
  execute 'reset role';
end $$;
rollback;

-- ── Plazos: la base dice qué vence y desde cuándo ──
begin;
do $$
declare
  vencido jsonb := tests.er_escenario('expired', interval '40 days');
  cancelado jsonb := tests.er_escenario('canceled', interval '10 days');
  impago jsonb := tests.er_escenario('past_due', interval '20 days');
  en_prueba jsonb := tests.er_escenario('trialing', interval '-5 days');
  activo jsonb := tests.er_escenario('active', interval '-20 days');
  medias jsonb := tests.er_escenario('expired', interval '45 days');
  p jsonb;
  r jsonb;
  e jsonb;
  fila jsonb;
  ids text[];
begin
  -- Una eliminación que quedó a medias (archivos pendientes).
  r := tests.er_simular((medias->>'t')::uuid);
  e := tests.er_ejecutar((r->>'eliminacion_id')::uuid, r->>'codigo');
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  p := public.eliminacion_residencial_pendientes();
  execute 'reset role';
  ids := array(select x->>'tenant_id' from jsonb_array_elements(p->'residenciales') x);
  select x into fila from jsonb_array_elements(p->'residenciales') x where x->>'tenant_id' = vencido->>'t';
  perform tests.lg_ok('ER-100', 'vencido hace 40 días: elegible, con fin y fecha desde la que se puede eliminar',
    (fila->>'elegible')::boolean and fila->>'nombre' = 'ZZ Residencial Eliminable'
      and (fila->>'eliminar_desde')::timestamptz = (fila->>'fin_servicio')::timestamptz + interval '30 days', coalesce(fila::text, 'sin fila'));
  select x into fila from jsonb_array_elements(p->'residenciales') x where x->>'tenant_id' = cancelado->>'t';
  perform tests.lg_ok('ER-101', 'cancelado hace 10 días: listado como todavía no (menos_de_30_dias), eliminable en unos 20 días',
    not (fila->>'elegible')::boolean and fila->>'motivo' = 'menos_de_30_dias'
      and (fila->>'eliminar_desde')::timestamptz between now() + interval '19 days' and now() + interval '21 days', coalesce(fila::text, 'sin fila'));
  select x into fila from jsonb_array_elements(p->'residenciales') x where x->>'tenant_id' = impago->>'t';
  perform tests.lg_ok('ER-102', 'en impago sin servicio: listado (hay que cancelar en el proveedor), no elegible',
    not (fila->>'elegible')::boolean and fila->>'motivo' = 'suscripcion_en_impago', coalesce(fila::text, 'sin fila'));
  perform tests.lg_ok('ER-103', 'en prueba, activos y los de los fixtures no aparecen',
    not (ids && array[en_prueba->>'t', activo->>'t', 'aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000']));
  perform tests.lg_ok('ER-104', 'la eliminación a medias aparece para reanudar (y su residencial ya no)',
    exists (select 1 from jsonb_array_elements(p->'a_medias') x where x->>'eliminacion_id' = r->>'eliminacion_id')
      and not (ids && array[medias->>'t']), p->'a_medias'->>0);
  perform tests.como('00000000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';
  perform tests.debe_fallar('ER-105', 'ni el Super Admin consulta los plazos por la API (solo service_role)', 'select public.eliminacion_residencial_pendientes()', '42501');
  execute 'reset role';
end $$;
rollback;

\endif
