-- ============================================================
-- Rollback de 20260729100000_grants_minimo_privilegio.sql
--
-- Devuelve public al estado con el que nace un proyecto Supabase
-- nuevo (staging, octubre 2026): anon/authenticated/service_role con
-- solo TRUNCATE/REFERENCES/TRIGGER/MAINTAIN en tablas y vistas, sin
-- permisos en las secuencias, y ese mismo default privilege para lo
-- que se cree después. Con este estado la Data API vuelve a fallar
-- con 42501: solo sirve para deshacer la migración, no para operar.
-- ============================================================

do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as obj
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'v', 'm', 'p')
      and c.relname in (
        'paquetes', 'paquete_grupos_entrega', 'unidades', 'ubicaciones', 'incidencias',
        'incidencia_fotografias', 'paquete_firmas', 'paquete_fotografias', 'notificaciones',
        'tenants', 'user_tenants', 'users', 'empresas', 'roles', 'residentes_unidades',
        'empresas_paqueteria', 'tamanos_paquete', 'prioridades_paquete', 'paquete_historial',
        'paquete_ubicacion_historial', 'v_dashboard_resumen', 'v_dashboard_por_prioridad',
        'v_dashboard_por_ubicacion', 'mv_dashboard_diario', 'mv_dashboard_top_empresas',
        'audit_log', 'calles', 'casas', 'departamentos', 'edificios', 'manzanas',
        'estados_paquete', 'permisos', 'rol_permisos', 'plantillas_notificacion',
        'reservas_codigo_gateflow')
  loop
    execute format('revoke all on %s from anon, authenticated, service_role', r.obj);
    execute format('grant truncate, references, trigger, maintain on %s to anon, authenticated, service_role', r.obj);
  end loop;
end $$;

revoke all on sequence public.codigo_gateflow_seq from anon, authenticated, service_role;
revoke all on sequence public.paquete_grupos_entrega_codigo_seq from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
