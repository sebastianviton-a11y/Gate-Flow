# supabase/ — Esquema definitivo de GateFlow

**No pude ejecutar estas migraciones contra un proyecto Supabase real.** No es una limitación que asumo — la verifiqué:

```
$ curl -sI https://api.supabase.com
HTTP/2 403
x-deny-reason: host_not_allowed
```

Este entorno no tiene acceso de red saliente hacia la infraestructura de Supabase (ni hacia el registro de npm para instalar el CLI). Tampoco hay un Postgres local disponible para levantar una instancia de prueba — lo intenté (`apt-get install postgresql`) y el mismo bloqueo de red lo impide. Lo que sí hice, y que va más allá de "escribir el SQL y esperar que funcione":

- Verificación automatizada de balance sintáctico (paréntesis, bloques `$$`, terminación de sentencias) sobre las 6 migraciones + `seed.sql`.
- Verificación automatizada de que **cada foreign key apunta a una tabla y columna que realmente existe** (27 tablas, decenas de FK, 0 problemas).
- Verificación automatizada de que **ninguna tabla se referencia antes de haberse creado** — el orden de los archivos de migración respeta las dependencias.
- Revisión manual de cada trigger y función (`fn_registrar_historial_paquete`, `fn_actualizar_search_vector_paquete`, `handle_new_auth_user`, helpers de RLS) columna por columna contra el esquema real.

Esto reduce mucho el riesgo, pero **no reemplaza ejecutarlo contra un Postgres real**, que es exactamente lo que sigue pendiente.

## Qué contiene

```
supabase/
  migrations/
    20260713230000_extensions_and_utils.sql   — pgcrypto, trigger set_updated_at()
    20260713230100_core_platform.sql          — tenants, roles, permisos, users, user_tenants,
                                                 calles, manzanas, edificios, unidades, casas,
                                                 departamentos, residentes_unidades, audit_log
    20260713230200_packages_module.sql        — ubicaciones, catálogos, paquetes, evidencia,
                                                 incidencias, notificaciones, código GateFlow
    20260713230300_search_and_dashboard.sql   — búsqueda universal (tsvector) y agregación
                                                 pre-calculada del dashboard
    20260713230400_rls_policies.sql           — aislamiento multi-tenant en las 27 tablas
    20260713230500_auth_provisioning.sql      — aprovisiona public.users al registrarse en Auth
    20260714000000_paquetes_sprint02.sql      — residente_id/remitente, código por secuencia,
                                                 entrega atómica, protección de campos, auditoría
    20260714010000_dashboard_promedio_entrega.sql — tiempo promedio de entrega en vivo
    20260714020000_unidades_contacto_informal.sql — contacto sin cuenta formal (importación masiva)
    20260714030000_notificaciones_demo.sql    — notificaciones sin destinatario con cuenta formal
    20260715000000_notificaciones_whatsapp.sql — plantillas de notificación + entrega automática
    20260716000000_storage_evidencia.sql      — bucket de Storage para evidencia + políticas por tenant
  seed.sql                                     — catálogos globales (roles, permisos, estados,
                                                 tamaños, prioridades, couriers)
  seed-staging.sql                             — datos demo para staging (NUNCA usar en producción)
```

## Decisión de implementación que debes conocer antes de correr esto

`02-ARCHITECTURE.md §12` describe RLS basado en claims custom (`tenant_id`, `role`) inyectados al JWT vía un Auth Hook configurado en el dashboard de Supabase. Ese hook **requiere configuración manual** (Authentication → Hooks) que no puedo hacer de forma remota.

Para que las políticas funcionen desde el primer `db push`, sin ningún paso de configuración adicional, las implementé contra `auth.uid()` (disponible siempre, sin configurar nada) mediante funciones `SECURITY DEFINER` (`current_tenant_ids()`, `is_super_admin()`, `has_role()`) que consultan `user_tenants` directamente. Es funcionalmente equivalente — el aislamiento es igual de real — pero cada fila evaluada hace un subquery en vez de leer un claim ya resuelto en el JWT. Para el volumen de un residencial esto no es un problema; es una optimización a reconsiderar solo si el volumen de tenants/consultas lo justifica más adelante.

## Cómo ejecutarlo

**Opción A — Supabase CLI (recomendada):**

```bash
npm install -g supabase
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push
psql "$(supabase db remote-connection-string)" -f supabase/seed.sql
```

**Opción B — SQL Editor del dashboard de Supabase (si no quieres instalar el CLI):**

Copia y pega, **en este orden exacto**, el contenido de cada archivo en `migrations/` (respetando el orden de los nombres, que ya están numerados) y ejecútalos uno por uno. Al final, ejecuta `seed.sql`.

## Verificación mínima después de correrlo

```sql
-- Deben existir 27 tablas en el esquema public.
select count(*) from information_schema.tables where table_schema = 'public';

-- RLS debe estar habilitado en todas las de negocio.
select tablename from pg_tables
where schemaname = 'public' and rowsecurity = false;
-- (debe devolver 0 filas)

-- Los catálogos deben tener datos.
select count(*) from public.roles;         -- 4
select count(*) from public.estados_paquete; -- 6
```

## Después de correr esto

1. Crea al menos un tenant de prueba y una fila en `user_tenants` para tu usuario de Auth — sin eso, `apps/web` seguirá cayendo en la sesión de demostración (`SPRINT_01_VALIDATION.md §6`), que es exactamente el comportamiento esperado y correcto hasta que exista esa fila.
2. Confirma los 6 puntos de `SPRINT_01_VALIDATION.md §7` (`pnpm install`, `pnpm dev`, login real, etc.).
3. Solo entonces el módulo de Paquetes de Sprint 02 se construye contra estas tablas reales — no contra los mocks de `lib/mock/dashboard.ts`.
