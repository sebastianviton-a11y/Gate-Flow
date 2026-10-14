# supabase/tests

Pruebas de integración y de RLS contra PostgreSQL.

## security/ — privilegios E1 / E2 / E4

Verifican que la metadata de un signUp no otorga roles (E1), que nadie
fabrica membresías desde el cliente (E2), que los permisos de admin se
evalúan en el tenant de la fila (E4a) y que `tenant_id` es inmutable
(E4b), además del endurecimiento de funciones y una regresión del uso
real de Admin y Guard.

| Archivo | Contenido |
|---|---|
| `harness/supabase_stub.sql` | Emula roles, `auth` y `storage` de Supabase sobre un Postgres pelado. **Nunca** contra un proyecto real. |
| `00_fixtures.sql` | Tenants P/A/B y usuarios (super, admins, guardias, mixto, admin_ab, solo). |
| `01_helpers.sql` | Esquema `tests` con `pass/fail/como/debe_fallar/debe_funcionar/filas/igual`. |
| `10_…` a `60_…` | Suites. Cada caso corre en su transacción con `ROLLBACK`. |
| `run-local.sh` | Recrea la base, aplica todo y recorre base → A → C → rollbacks. |

```bash
PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/security/run-local.sh
```

Requiere un PostgreSQL 15+ local desechable (el script hace `dropdb`/
`createdb` de `$GF_TEST_DB`, por defecto `gf_security_test`). La fase
"0" (esquema sin la migración A) es informativa: sus FAIL muestran los
riesgos que la migración cierra. Las demás deben terminar en 0 FAIL, y
cada rollback debe dejar el catálogo idéntico al estado anterior.

## grants/ — mínimo privilegio + reconciliación con producción

Imita un proyecto Supabase nuevo como staging: default privileges que
no conceden SELECT/INSERT/UPDATE/DELETE a la API y pgcrypto en el schema
`extensions` (`harness/acl_staging.sql`, `harness/extensions_supabase.sql`).

| Archivo | Contenido |
|---|---|
| `10_matriz.sql` | Matriz exacta de privilegios por objeto × rol (falta o sobra = FAIL). |
| `20_flujos.sql` | Flujos reales de Admin/Guard, aislamiento A/B, vistas materializadas, anon. |
| `30_migracion_a.sql` | `otorgar_membresia` y `UPDATE (activo)` con la migración A. |
| `40_reconciliacion.sql` | Incidencias (`nivel_danio`, 13 tipos), registro con y sin incidencia, historial, entrega, aislamiento. |
| `50_grupos.sql` | Grupos de entrega: obtener/crear, separado, token, flujo real de Guard, escaneo, entrega parcial/total, aislamiento. |
| `60_rollout_auth.sql` | Auth por etapa del rollout (S0 sin A, SA con A, SC con C): login por rol, invitación vieja (metadata) y nueva (`otorgar_membresia`), aceptación, E1/E2/E4. Un hueco abierto antes de la migración que lo cierra sale como PENDIENTE; después, como FAIL. |
| `contrato_selects.py` | Cada `select`/`insert`/`update`/`rpc` del código contra el esquema migrado. |

```bash
PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/grants/run-local.sh
```

Recorre base → grants → reconciliación → migración A (y A sobre un
`has_role_in_tenant` preexistente, como en producción) → fase C, con
sus rollbacks. Los casos `PENDIENTE` son fallos conocidos cuya corrección
espera aprobación; se listan aparte y no cuentan como FAIL.

## Documentos legales (fase LG, 20261014000000)

| Archivo | Contenido |
|---|---|
| `security/92_documentos_legales.sql` | Fase 1 inactiva: sin versiones, requisitos ni permisos; ciclo de versiones inmutable, auditoría, TRUNCATE, pendientes/registro multitenant por país, alcance de residencial, consentimiento y revocación, evidencia inmutable que sobrevive a la cuenta y al residencial, descarte solo de un alta fallida. Concede EXECUTE a `authenticated` solo dentro de cada transacción de prueba. |
| `security/concurrencia_aceptaciones.sh` | Dos sesiones reales (Acuerdo del mismo residencial, doble envío, residenciales distintos) en una **copia** desechable de la base: la evidencia no se puede borrar. |
| `grants/97_documentos_legales.sql` | Con los default privileges de staging, ningún privilegio de tabla, de columna ni EXECUTE para la API. |

Ambos runners aplican LG después de SM, verifican que el catálogo solo
gana objetos legales, revierten (idéntico a SM), reaplican y, con una
versión cargada, comprueban que el rollback aborta sin cambios. Detalle
en `docs/operations/LEGAL.md`.

## Lectura pública de documentos (fase LP, 20261015000000)

| Archivo | Contenido |
|---|---|
| `security/91_documentos_legales_lectura.sql` | Con documentos ficticios en todos los estados: `anon` y `authenticated` leen vigentes, una versión publicada o retirada por id y el historial por país (vigente, anterior, retirada, programada); nunca un borrador ni un aprobado sin publicar ni quién aprobó; la vigente del historial coincide con `documentos_legales_vigentes`; parámetros inválidos → 22023; sin acceso a tablas ni a `documentos_pendientes`/`registrar_aceptaciones`; `service_role` sin EXECUTE; leer no escribe; admins de dos residenciales y anon leen lo mismo. |
| `grants/98_documentos_legales_lectura.sql` | Con los default privileges de staging, EXECUTE de la API solo en las tres lecturas (anon y authenticated) y ningún privilegio de tabla. |

Ambos runners aplican LP después de LG, comprueban que el catálogo solo
gana la función de historial y esos EXECUTE, revierten (idéntico a LG),
reaplican y revierten LP antes que LG. `92`/`97` (fase LG) tienen en
cuenta si LP está aplicada.

## Pendientes conocidos

Ninguno en el flujo de paquetes. La reconciliación
(`20260729200000_reconciliacion_paridad_produccion.sql`) resolvió el
historial (`fn_registrar_historial_paquete` sin `SECURITY DEFINER`), el
drift de incidencias y los grupos de entrega (`gen_random_bytes` con
`search_path = public`). Detalle en `docs/operations/DRIFT_PRODUCCION.md`.
