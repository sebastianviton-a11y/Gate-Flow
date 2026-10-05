-- ============================================================
-- E4b — integridad: una fila existente NUNCA cambia de tenant_id,
-- sin importar el rol (admin de ambos tenants, service_role,
-- superusuario). Es un invariante de datos, no un permiso.
-- ============================================================

-- I-01: catálogo — las 19 tablas tienen el trigger genérico
-- BEFORE UPDATE OF tenant_id, y paquetes conserva el suyo.
select tests.igual('I-01', 'las 19 tablas tenant-scoped tienen trg_*_tenant_id_inmutable',
  $$select coalesce(string_agg(t, ',' order by t), 'ninguna') from unnest(array[
      'audit_log','calles','edificios','empresas_paqueteria','incidencias','manzanas','notificaciones',
      'paquete_firmas','paquete_fotografias','paquete_grupos_entrega','paquete_historial',
      'paquete_ubicacion_historial','plantillas_notificacion','prioridades_paquete','residentes_unidades',
      'tamanos_paquete','ubicaciones','unidades','user_tenants']) as t
    where not exists (
      select 1 from pg_trigger tg
      join pg_proc p on p.oid = tg.tgfoid
      where tg.tgrelid = ('public.' || t)::regclass
        and p.proname = 'fn_tenant_id_inmutable'
        and not tg.tgisinternal
        -- tgtype: bit 1 = ROW, bit 2 = BEFORE, bit 16 = UPDATE
        and (tg.tgtype & 1) = 1 and (tg.tgtype & 2) = 2 and (tg.tgtype & 16) = 16
    )$$, 'ninguna');

select tests.igual('I-02', 'paquetes conserva trg_paquetes_proteger_campos',
  $$select count(*)::text from pg_trigger where tgrelid = 'public.paquetes'::regclass
    and tgname = 'trg_paquetes_proteger_campos'$$, '1');

-- I-03: admin en A y en B no puede mover una unidad de A a B.
begin;
select tests.como('00000000-0000-0000-0000-0000000000aa');
set local role authenticated;
select tests.debe_fallar('I-03', 'admin_ab (admin en A y B) no puede mover unidad A→B',
  $$update public.unidades set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    where id = 'a1000000-0000-0000-0000-000000000000'$$, 'P0001');
rollback;

-- I-04: ni una ubicación ni un tamaño propio.
begin;
select tests.como('00000000-0000-0000-0000-0000000000aa');
set local role authenticated;
select tests.debe_fallar('I-04a', 'admin_ab no puede mover ubicación A→B',
  $$update public.ubicaciones set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    where id = 'a2000000-0000-0000-0000-000000000000'$$, 'P0001');
select tests.debe_fallar('I-04b', 'admin_ab no puede mover tamaño A→B',
  $$update public.tamanos_paquete set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    where id = 'a5000000-0000-0000-0000-000000000000'$$, 'P0001');
rollback;

-- I-05: service_role tampoco (el invariante no depende del rol).
begin;
select tests.como('00000000-0000-0000-0000-000000000001', 'service_role');
set local role service_role;
select tests.debe_fallar('I-05a', 'service_role no puede mover grupo de entrega A→B',
  $$update public.paquete_grupos_entrega set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    where id = 'a4000000-0000-0000-0000-000000000000'$$, 'P0001');
select tests.debe_fallar('I-05b', 'service_role no puede mover una membresía A→B',
  $$update public.user_tenants set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    where user_id = '00000000-0000-0000-0000-0000000000a9'$$, 'P0001');
rollback;

-- I-06: el superusuario postgres tampoco, en TODAS las tablas con filas.
-- (Las tablas sin filas de fixture quedan cubiertas por I-01.)
begin;
do $$
declare
  t text;
  n int;
begin
  foreach t in array array[
    'audit_log','calles','edificios','empresas_paqueteria','incidencias','manzanas','notificaciones',
    'paquete_firmas','paquete_fotografias','paquete_grupos_entrega','paquete_historial',
    'paquete_ubicacion_historial','plantillas_notificacion','prioridades_paquete','residentes_unidades',
    'tamanos_paquete','ubicaciones','unidades','user_tenants','paquetes']
  loop
    execute format('select count(*) from public.%I where tenant_id is not null', t) into n;
    continue when n = 0;
    perform tests.debe_fallar('I-06:' || t, 'postgres no puede cambiar tenant_id en ' || t,
      format($f$update public.%I set tenant_id = case when tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'
                 then 'bbbbbbbb-0000-0000-0000-000000000000'::uuid else 'aaaaaaaa-0000-0000-0000-000000000000'::uuid end
               where ctid = (select ctid from public.%I where tenant_id is not null limit 1)$f$, t, t),
      'P0001');
  end loop;
end $$;
rollback;

-- I-07: una fila global de catálogo (tenant_id NULL) no puede "apropiarse".
begin;
select tests.debe_fallar('I-07', 'no se puede pasar un tamaño global (NULL) a un tenant',
  $$update public.tamanos_paquete set tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'
    where tenant_id is null and clave = 'mediano'$$, 'P0001');
rollback;

-- I-08: un UPDATE que incluye tenant_id SIN cambiarlo sigue funcionando.
begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.filas('I-08', 'UPDATE con el mismo tenant_id se permite',
  $$update public.unidades set tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000', identificador = 'Casa A1 bis'
    where id = 'a1000000-0000-0000-0000-000000000000'$$, 1);
rollback;
