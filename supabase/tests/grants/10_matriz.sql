-- ============================================================
-- Matriz exacta de privilegios en public para los roles de la API.
-- Compara has_table_privilege / has_sequence_privilege contra lo
-- esperado y falla tanto si falta un permiso como si sobra uno.
-- Un objeto de public que no esté en la lista debe tener 0 permisos
-- (así una tabla nueva sin grants explícitos no pasa desapercibida
-- y una con grants no documentados tampoco).
-- ============================================================

begin;

create temp table esperado (objeto text, rol text, privs text[]);

insert into esperado values
  ('paquetes',                    'authenticated', '{SELECT,INSERT,UPDATE}'),
  ('paquete_grupos_entrega',      'authenticated', '{SELECT,INSERT,UPDATE}'),
  ('unidades',                    'authenticated', '{SELECT,INSERT,UPDATE}'),
  ('ubicaciones',                 'authenticated', '{SELECT,INSERT,UPDATE,DELETE}'),
  ('incidencias',                 'authenticated', '{SELECT,INSERT,UPDATE}'),
  ('incidencia_fotografias',      'authenticated', '{SELECT,INSERT}'),
  ('paquete_firmas',              'authenticated', '{SELECT,INSERT}'),
  ('paquete_fotografias',         'authenticated', '{SELECT,INSERT}'),
  ('notificaciones',              'authenticated', '{INSERT}'),
  ('tenants',                     'authenticated', '{SELECT,INSERT,UPDATE,DELETE}'),
  ('user_tenants',                'authenticated', '{SELECT,UPDATE}'),  -- con la migración A: '{SELECT}' + UPDATE (activo), ver abajo
  ('user_tenants',                'service_role',  '{SELECT}'),
  ('users',                       'authenticated', '{SELECT,UPDATE}'),
  ('users',                       'service_role',  '{SELECT,UPDATE}'),
  ('empresas',                    'authenticated', '{SELECT,INSERT,UPDATE}'),
  ('roles',                       'authenticated', '{SELECT}'),
  ('residentes_unidades',         'authenticated', '{SELECT}'),
  ('empresas_paqueteria',         'authenticated', '{SELECT}'),
  ('tamanos_paquete',             'authenticated', '{SELECT}'),
  ('prioridades_paquete',         'authenticated', '{SELECT}'),
  ('paquete_historial',           'authenticated', '{SELECT}'),
  ('paquete_ubicacion_historial', 'authenticated', '{SELECT}'),
  ('v_dashboard_resumen',         'authenticated', '{SELECT}'),
  ('v_dashboard_por_prioridad',   'authenticated', '{SELECT}'),
  ('v_dashboard_por_ubicacion',   'authenticated', '{SELECT}'),
  ('mv_dashboard_diario',         'service_role',  '{SELECT}'),
  ('mv_dashboard_top_empresas',   'service_role',  '{SELECT}'),
  ('codigo_gateflow_seq',               'authenticated', '{USAGE}'),
  ('paquete_grupos_entrega_codigo_seq', 'authenticated', '{USAGE}');

-- Registro/trial (20261006): suscripciones solo SELECT para
-- authenticated; registro_intentos sin ningún grant (queda cubierta
-- por la regla "objeto no listado = 0 permisos").
do $$
begin
  if to_regclass('public.suscripciones') is not null then
    insert into esperado values ('suscripciones', 'authenticated', '{SELECT}');
  end if;
end $$;

-- La migración A (privilegios fase A) cambia el UPDATE de tabla en
-- user_tenants por UPDATE solo de la columna activo (E2b) y da a
-- service_role lo que otorgar_membresia necesita.
do $$
begin
  if to_regprocedure('public.otorgar_membresia(uuid,uuid,text,uuid)') is not null then
    update esperado set privs = '{SELECT}' where objeto = 'user_tenants' and rol = 'authenticated';
    -- otorgar_membresia (SECURITY INVOKER) como service_role.
    update esperado set privs = '{INSERT,SELECT}' where objeto = 'user_tenants' and rol = 'service_role';
    insert into esperado values
      ('roles',     'service_role', '{SELECT}'),
      ('tenants',   'service_role', '{SELECT}'),
      ('audit_log', 'service_role', '{INSERT}');
    if has_column_privilege('authenticated', 'public.user_tenants', 'activo', 'UPDATE')
       and not has_column_privilege('authenticated', 'public.user_tenants', 'rol_id', 'UPDATE') then
      perform tests.pass('M-03', 'con migración A: user_tenants solo UPDATE (activo)');
    else
      perform tests.fail('M-03', 'con migración A: user_tenants solo UPDATE (activo)', 'privilegios de columna inesperados');
    end if;
  end if;
end $$;

-- Columnas protegidas de tenants (20261008): el UPDATE de tabla de
-- authenticated pasa a UPDATE solo de las columnas que edita el
-- admin_residencial (el detalle lo verifica 95_tenants_columnas.sql).
do $$
begin
  if to_regprocedure('public.superadmin_cambiar_estado_servicio(uuid,text)') is not null then
    update esperado set privs = '{SELECT,INSERT,DELETE}' where objeto = 'tenants' and rol = 'authenticated';
  end if;
end $$;

do $$
declare
  r record;
  v_real text[];
  v_esp text[];
  v_privs text[];
  v_fallas int := 0;
  v_casos int := 0;
begin
  for r in
    select c.oid, c.relname, c.relkind, rol
    from pg_class c
    cross join unnest(array['anon', 'authenticated', 'service_role']) as rol
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'v', 'm', 'p', 'S')
    order by c.relname, rol
  loop
    v_casos := v_casos + 1;
    if r.relkind = 'S' then
      v_privs := array['USAGE', 'SELECT', 'UPDATE'];
      select coalesce(array_agg(p order by p), '{}') into v_real
      from unnest(v_privs) p where has_sequence_privilege(r.rol, r.oid, p);
    else
      v_privs := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
      select coalesce(array_agg(p order by p), '{}') into v_real
      from unnest(v_privs) p where has_table_privilege(r.rol, r.oid, p);
    end if;

    select coalesce(array_agg(p order by p), '{}') into v_esp
    from esperado e, unnest(e.privs) p
    where e.objeto = r.relname and e.rol = r.rol;

    if v_real is distinct from v_esp then
      v_fallas := v_fallas + 1;
      perform tests.fail('M-' || r.relname || '-' || r.rol, 'privilegios exactos',
                         'tiene ' || v_real::text || ', esperado ' || v_esp::text);
    end if;
  end loop;

  if v_fallas = 0 then
    perform tests.pass('M-00', 'matriz exacta en ' || v_casos || ' combinaciones objeto×rol');
  end if;

  -- Ningún objeto esperado puede faltar en el catálogo (un typo en la
  -- lista dejaría pasar un objeto sin revisar).
  if exists (select 1 from esperado e
             where not exists (select 1 from pg_class c
                               where c.relnamespace = 'public'::regnamespace and c.relname = e.objeto)) then
    perform tests.fail('M-01', 'objetos de la matriz existen',
                       (select string_agg(objeto, ',') from esperado e
                        where not exists (select 1 from pg_class c
                                          where c.relnamespace = 'public'::regnamespace and c.relname = e.objeto)));
  else
    perform tests.pass('M-01', 'todos los objetos de la matriz existen');
  end if;
end $$;

-- Objetos futuros: lo que cree postgres en public no hereda nada
-- para los roles de la API.
do $$
begin
  create table public.tmp_grants_futuro (id int);
  create sequence public.tmp_grants_futuro_seq;
  if not (has_table_privilege('anon', 'public.tmp_grants_futuro', 'SELECT')
          or has_table_privilege('authenticated', 'public.tmp_grants_futuro', 'SELECT')
          or has_table_privilege('authenticated', 'public.tmp_grants_futuro', 'TRUNCATE')
          or has_table_privilege('service_role', 'public.tmp_grants_futuro', 'SELECT')
          or has_sequence_privilege('authenticated', 'public.tmp_grants_futuro_seq', 'USAGE')) then
    perform tests.pass('M-02', 'tabla y secuencia nuevas sin permisos para la API');
  else
    perform tests.fail('M-02', 'tabla y secuencia nuevas sin permisos para la API', 'heredaron permisos');
  end if;
end $$;

rollback;
