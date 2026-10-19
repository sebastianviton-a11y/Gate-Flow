-- ============================================================
-- Grants explícitos de mínimo privilegio sobre el schema public.
--
-- Por qué: las migraciones anteriores nunca concedieron permisos de
-- tabla; dependían de los default privileges del proyecto Supabase.
-- Los proyectos antiguos (producción) conceden ALL a anon,
-- authenticated y service_role sobre todo lo que se crea en public.
-- Los proyectos nuevos (staging, octubre 2026) solo conceden
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, así que la Data API devolvía
-- "permission denied for table user_tenants" (42501) y Admin caía al
-- fallback "demo-tenant".
--
-- Criterio (aprobado):
--   * anon: nada en ningún objeto de public.
--   * authenticated: solo las operaciones que Admin/Guard usan de
--     verdad (código @ 59cd426 + funciones SECURITY INVOKER y
--     defaults que se ejecutan con el rol de quien llama). RLS sigue
--     siendo la barrera por fila; esto es la barrera por operación.
--   * service_role: solo lo que usan las server actions con la clave
--     secreta, más SELECT en las vistas materializadas.
--   * Vistas materializadas: sin RLS → nunca authenticated.
--   * Nadie salvo el dueño conserva TRUNCATE/REFERENCES/TRIGGER/
--     MAINTAIN (TRUNCATE no pasa por RLS).
--
-- Cada objeto se trata por separado: primero REVOKE ALL de los tres
-- roles de la API y después el GRANT exacto. No hay GRANT global.
-- Las funciones (EXECUTE) quedan fuera: las cubre la migración de
-- privilegios fase A.
--
-- NO aplicar en producción sin revisión: allí revocaría los grants
-- amplios que hoy usa (incluido anon y las vistas materializadas).
-- ============================================================

-- ── Lectura + escritura operativa ─────────────────────────────

-- paquetes: lectura en todo Admin/Guard; INSERT al registrar; UPDATE
-- al entregar, cambiar ubicación y editar notas. Sin DELETE (no se usa).
revoke all on public.paquetes from anon, authenticated, service_role;
grant select, insert, update on public.paquetes to authenticated;

-- paquete_grupos_entrega: lectura/actualización desde el código;
-- INSERT desde obtener_o_crear_grupo_entrega y
-- crear_grupo_entrega_separado (SECURITY INVOKER).
revoke all on public.paquete_grupos_entrega from anon, authenticated, service_role;
grant select, insert, update on public.paquete_grupos_entrega to authenticated;

-- unidades: alta manual/importación, edición y lecturas embebidas.
revoke all on public.unidades from anon, authenticated, service_role;
grant select, insert, update on public.unidades to authenticated;

-- ubicaciones: CRUD completo desde Configuración → Bodega.
revoke all on public.ubicaciones from anon, authenticated, service_role;
grant select, insert, update, delete on public.ubicaciones to authenticated;

-- incidencias: registro, lectura y cierre.
revoke all on public.incidencias from anon, authenticated, service_role;
grant select, insert, update on public.incidencias to authenticated;

-- Evidencia ligada a paquetes/incidencias: solo alta y lectura.
revoke all on public.incidencia_fotografias from anon, authenticated, service_role;
grant select, insert on public.incidencia_fotografias to authenticated;

revoke all on public.paquete_firmas from anon, authenticated, service_role;
grant select, insert on public.paquete_firmas to authenticated;

revoke all on public.paquete_fotografias from anon, authenticated, service_role;
grant select, insert on public.paquete_fotografias to authenticated;

-- notificaciones: solo INSERT (registro de paquete y entregar_paquete).
revoke all on public.notificaciones from anon, authenticated, service_role;
grant insert on public.notificaciones to authenticated;

-- ── Núcleo multi-tenant ───────────────────────────────────────

-- tenants: lectura (sesión, configuración, super admin); UPDATE
-- (configuración, onboarding, super admin); INSERT/DELETE solo los
-- usa super admin (alta de residencial y su compensación). RLS
-- restringe cada operación.
revoke all on public.tenants from anon, authenticated, service_role;
grant select, insert, update, delete on public.tenants to authenticated;

-- user_tenants: lectura (middleware, sesión, usuarios); UPDATE para
-- activar/desactivar miembros. Las altas las hace
-- handle_new_auth_user (SECURITY DEFINER). service_role la lee en
-- actualizar-nombre-usuario-action.
revoke all on public.user_tenants from anon, authenticated, service_role;
grant select, update on public.user_tenants to authenticated;
grant select on public.user_tenants to service_role;

-- users: lectura (nombres embebidos), UPDATE del propio perfil al
-- aceptar la invitación. service_role actualiza el nombre de un
-- miembro; necesita SELECT porque el UPDATE filtra por id.
revoke all on public.users from anon, authenticated, service_role;
grant select, update on public.users to authenticated;
grant select, update on public.users to service_role;

-- empresas: super admin las crea, edita y lista.
revoke all on public.empresas from anon, authenticated, service_role;
grant select, insert, update on public.empresas to authenticated;

-- ── Solo lectura ──────────────────────────────────────────────

-- roles: embebido en sesión, middleware y listado de usuarios.
revoke all on public.roles from anon, authenticated, service_role;
grant select on public.roles to authenticated;

-- residentes_unidades: superadmin (conteos) y funciones INVOKER
-- (fn_actualizar_search_vector_paquete, fn_validar_residente_mismo_tenant).
revoke all on public.residentes_unidades from anon, authenticated, service_role;
grant select on public.residentes_unidades to authenticated;

-- Catálogos del formulario de registro (el código no los escribe).
revoke all on public.empresas_paqueteria from anon, authenticated, service_role;
grant select on public.empresas_paqueteria to authenticated;

revoke all on public.tamanos_paquete from anon, authenticated, service_role;
grant select on public.tamanos_paquete to authenticated;

revoke all on public.prioridades_paquete from anon, authenticated, service_role;
grant select on public.prioridades_paquete to authenticated;

-- Historiales: se escriben desde triggers, se leen en el detalle.
-- paquete_historial NO recibe INSERT: el trigger que la escribe debe
-- ser SECURITY DEFINER (corrección pendiente en su propia migración).
revoke all on public.paquete_historial from anon, authenticated, service_role;
grant select on public.paquete_historial to authenticated;

revoke all on public.paquete_ubicacion_historial from anon, authenticated, service_role;
grant select on public.paquete_ubicacion_historial to authenticated;

-- Vistas del dashboard: security_invoker = true, así que RLS de las
-- tablas base (paquetes, prioridades_paquete, ubicaciones) sigue
-- aplicando.
revoke all on public.v_dashboard_resumen from anon, authenticated, service_role;
grant select on public.v_dashboard_resumen to authenticated;

revoke all on public.v_dashboard_por_prioridad from anon, authenticated, service_role;
grant select on public.v_dashboard_por_prioridad to authenticated;

revoke all on public.v_dashboard_por_ubicacion from anon, authenticated, service_role;
grant select on public.v_dashboard_por_ubicacion to authenticated;

-- ── Vistas materializadas: sin RLS ────────────────────────────
-- Contienen datos de todos los residenciales. authenticated nunca:
-- obtenerVolumen30Dias() devuelve [] ante el error y el gráfico
-- queda vacío. Solo service_role puede leerlas.
revoke all on public.mv_dashboard_diario from anon, authenticated, service_role;
grant select on public.mv_dashboard_diario to service_role;

revoke all on public.mv_dashboard_top_empresas from anon, authenticated, service_role;
grant select on public.mv_dashboard_top_empresas to service_role;

-- ── Secuencias ────────────────────────────────────────────────
-- nextval() corre con el rol de quien inserta: codigo_gateflow_seq
-- desde el default paquetes.codigo_gateflow (generar_codigo_gateflow,
-- INVOKER) y paquete_grupos_entrega_codigo_seq desde el trigger
-- fn_asignar_codigo_grupo (INVOKER). USAGE basta para nextval.
revoke all on sequence public.codigo_gateflow_seq from anon, authenticated, service_role;
grant usage on sequence public.codigo_gateflow_seq to authenticated;

revoke all on sequence public.paquete_grupos_entrega_codigo_seq from anon, authenticated, service_role;
grant usage on sequence public.paquete_grupos_entrega_codigo_seq to authenticated;

-- ── Sin acceso por la API ─────────────────────────────────────
-- Ni Admin ni Guard las usan por la Data API; las que se escriben lo
-- hacen desde funciones SECURITY DEFINER (audit_log vía
-- registrar_auditoria) o no se usan todavía.
revoke all on public.audit_log from anon, authenticated, service_role;
revoke all on public.calles from anon, authenticated, service_role;
revoke all on public.casas from anon, authenticated, service_role;
revoke all on public.departamentos from anon, authenticated, service_role;
revoke all on public.edificios from anon, authenticated, service_role;
revoke all on public.manzanas from anon, authenticated, service_role;
revoke all on public.estados_paquete from anon, authenticated, service_role;
revoke all on public.permisos from anon, authenticated, service_role;
revoke all on public.rol_permisos from anon, authenticated, service_role;
revoke all on public.plantillas_notificacion from anon, authenticated, service_role;
revoke all on public.reservas_codigo_gateflow from anon, authenticated, service_role;

-- ── Objetos futuros ───────────────────────────────────────────
-- Lo que creen migraciones posteriores (como postgres) no hereda
-- nada para los roles de la API: cada migración concede lo suyo.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
