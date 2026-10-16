-- ============================================================
-- Limpieza de la PRUEBA CONTROLADA en producción (cuenta ficticia).
--
-- Borra un único residencial de prueba y sus cuentas, y verifica que no
-- quede nada. Por defecto es un SIMULACRO: muestra qué borraría y hace
-- ROLLBACK. Solo borra con ejecutar = 'si'.
--
-- Uso (psql, contra el proyecto correcto, por quien autorice):
--   psql -v marca='ZZ PRUEBA CONTROLADA' \
--        -v correo_admin='alias+gf-lanzamiento@dominio' \
--        -v prefijo_correos='alias+gf-lanzamiento' \
--        -v ejecutar='no' -f limpieza_prueba_controlada.sql
-- En el SQL Editor de Supabase: reemplazar los cuatro \set de abajo.
--
-- Salvaguardas (aborta sin cambios si alguna falla):
--   · exactamente 1 residencial cuyo nombre empieza con la marca, creado
--     hace menos de 7 días, con el correo del admin como miembro;
--   · solo se borran cuentas cuyo correo empieza con el prefijo y que no
--     son miembros de ningún otro residencial;
--   · sin aceptaciones legales (evidencia protegida), sin cobros
--     (billing_checkouts / billing_eventos) y sin archivos en Storage
--     (los archivos se borran antes desde el panel de Storage).
-- Verificación: 0 filas del residencial en cada tabla con tenant_id,
-- 0 cuentas, y los demás residenciales con los mismos conteos que antes.
-- ============================================================
\set ON_ERROR_STOP 1
\if :{?marca} \else \set marca 'ZZ PRUEBA CONTROLADA' \endif
\if :{?ejecutar} \else \set ejecutar 'no' \endif

begin;
select set_config('gf.marca', :'marca', true), set_config('gf.correo_admin', :'correo_admin', true),
       set_config('gf.prefijo', :'prefijo_correos', true), set_config('gf.ejecutar', :'ejecutar', true);

do $$
declare
  v_marca text := current_setting('gf.marca');
  v_admin text := lower(current_setting('gf.correo_admin'));
  v_prefijo text := lower(current_setting('gf.prefijo'));
  v_tenant uuid;
  v_empresa uuid;
  v_users uuid[];
  v_n bigint;
  v_t record;
  v_otros_antes text;
  v_otros_despues text;
  v_resumen text := '';
begin
  if length(v_marca) < 8 or length(v_prefijo) < 8 or v_admin not like v_prefijo || '%' then
    raise exception 'ABORTADO: marca y prefijo de al menos 8 caracteres, y el correo del admin debe empezar con el prefijo';
  end if;

  select count(*) into v_n from public.tenants t
  where t.nombre like v_marca || '%' and t.created_at > now() - interval '7 days'
    and exists (select 1 from public.user_tenants ut join auth.users u on u.id = ut.user_id
                where ut.tenant_id = t.id and lower(u.email) = v_admin);
  if v_n <> 1 then raise exception 'ABORTADO: se esperaba 1 residencial de prueba, hay %', v_n; end if;
  select t.id, t.empresa_id into v_tenant, v_empresa from public.tenants t
  where t.nombre like v_marca || '%' and t.created_at > now() - interval '7 days'
    and exists (select 1 from public.user_tenants ut join auth.users u on u.id = ut.user_id
                where ut.tenant_id = t.id and lower(u.email) = v_admin);

  -- Cuentas: miembros del residencial con el prefijo y sin otra membresía.
  select coalesce(array_agg(distinct u.id), '{}') into v_users
  from public.user_tenants ut join auth.users u on u.id = ut.user_id
  where ut.tenant_id = v_tenant and lower(u.email) like v_prefijo || '%'
    and not exists (select 1 from public.user_tenants o where o.user_id = u.id and o.tenant_id <> v_tenant);
  select count(*) into v_n from public.user_tenants ut join auth.users u on u.id = ut.user_id
  where ut.tenant_id = v_tenant and not (u.id = any (v_users));
  if v_n > 0 then raise exception 'ABORTADO: el residencial tiene % miembro(s) fuera del prefijo o con otras membresías', v_n; end if;

  select count(*) into v_n from public.aceptaciones_legales where tenant_id = v_tenant or user_id = any (v_users);
  if v_n > 0 then raise exception 'ABORTADO: hay % aceptación(es) legal(es); la evidencia no se borra con este script', v_n; end if;
  select (select count(*) from public.billing_checkouts where tenant_id = v_tenant)
       + (select count(*) from public.billing_eventos where tenant_id = v_tenant) into v_n;
  if v_n > 0 then raise exception 'ABORTADO: hay % registro(s) de cobro', v_n; end if;
  select count(*) into v_n from storage.objects where name like v_tenant::text || '/%' or name like '%/' || v_tenant::text || '/%';
  if v_n > 0 then raise exception 'ABORTADO: hay % archivo(s) en Storage del residencial; bórralos antes desde el panel', v_n; end if;

  -- Conteos de los demás residenciales (para comprobar que no cambian).
  v_otros_antes := '';
  for v_t in select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid
             where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attname = 'tenant_id' and not a.attisdropped order by 1 loop
    execute format('select count(*) from public.%I where tenant_id is distinct from $1', v_t.relname) into v_n using v_tenant;
    v_otros_antes := v_otros_antes || v_t.relname || '=' || v_n || ' ';
    execute format('select count(*) from public.%I where tenant_id = $1', v_t.relname) into v_n using v_tenant;
    if v_n > 0 then v_resumen := v_resumen || v_t.relname || ':' || v_n || ' '; end if;
  end loop;
  raise notice 'Residencial % · cuentas % · filas a borrar: %', v_tenant, cardinality(v_users), v_resumen;

  delete from public.tenants where id = v_tenant;                         -- en cascada: unidades, paquetes, historial, membresías…
  delete from public.empresas e where e.id = v_empresa and not exists (select 1 from public.tenants t where t.empresa_id = e.id);
  delete from public.audit_log where user_id = any (v_users);
  delete from auth.users where id = any (v_users);                        -- en cascada: public.users

  -- Verificación
  for v_t in select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid
             where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attname = 'tenant_id' and not a.attisdropped order by 1 loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_t.relname) into v_n using v_tenant;
    if v_n > 0 then raise exception 'VERIFICACIÓN FALLIDA: quedan % fila(s) en %', v_n, v_t.relname; end if;
  end loop;
  select (select count(*) from auth.users where id = any (v_users)) + (select count(*) from public.users where id = any (v_users))
       + (select count(*) from public.user_tenants where user_id = any (v_users)) + (select count(*) from public.tenants where id = v_tenant) into v_n;
  if v_n > 0 then raise exception 'VERIFICACIÓN FALLIDA: quedan % fila(s) de cuentas o del residencial', v_n; end if;
  v_otros_despues := '';
  for v_t in select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid
             where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attname = 'tenant_id' and not a.attisdropped order by 1 loop
    execute format('select count(*) from public.%I where tenant_id is distinct from $1', v_t.relname) into v_n using v_tenant;
    v_otros_despues := v_otros_despues || v_t.relname || '=' || v_n || ' ';
  end loop;
  if v_otros_antes <> v_otros_despues then raise exception 'VERIFICACIÓN FALLIDA: cambiaron otros residenciales'; end if;
  raise notice 'VERIFICADO: 0 residuos del residencial de prueba y de sus % cuenta(s); los demás residenciales sin cambios', cardinality(v_users);
  if current_setting('gf.ejecutar') <> 'si' then
    raise notice 'SIMULACRO: nada se guardó (ejecutar = ''si'' para borrar)';
  end if;
end $$;

select current_setting('gf.ejecutar') = 'si' as confirmar \gset
\if :confirmar
commit;
\echo 'LIMPIEZA CONFIRMADA'
\else
rollback;
\echo 'SIMULACRO: ROLLBACK'
\endif
