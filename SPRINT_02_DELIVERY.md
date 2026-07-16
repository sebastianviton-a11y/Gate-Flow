# SPRINT_02_DELIVERY.md

**Estado final: `SPRINT 02 — PENDING LOCAL VALIDATION`.**

No lo marco como completo. Tu propio criterio de cierre lo dice explícitamente: *"No marques Sprint 02 como completado si no pudiste validar el flujo real"* — y no pude, por el mismo bloqueo de red de todos los sprints anteriores (reverificado, no asumido — ver §9). Lo que sí entrego es código real conectado a Supabase, no mocks, con la mayor verificación estática que pude hacer sin poder ejecutarlo.

---

## 1. Resumen de lo construido

Flujo completo de Paquetes, de extremo a extremo, sobre datos reales:

- **`apps/guard`**: registro conectado a Supabase (búsqueda de unidad real, catálogos reales, inserción real, código GateFlow generado por la base de datos, QR de confirmación), entrega conectada (búsqueda real, función atómica que impide doble entrega), pendientes (lista real), búsqueda universal (real, vía `search_vector`), detalle con historial real.
- **`apps/admin`**: listado con filtros/búsqueda/paginación (real), detalle con historial y QR (real), edición de notas con auditoría real (no un `console.log`), dashboard con datos reales (mocks eliminados por completo).
- **`packages/paquetes`** (nuevo): capa de datos compartida — consultas y mutaciones que ambas apps usan idénticas, para que las garantías críticas (código único, no doble entrega) no puedan divergir entre apps.
- **`supabase/migrations/20260714000000_paquetes_sprint02.sql`**: completa el modelo, con dos bugs de seguridad reales que encontré y corregí en el camino (§5).

## 2. Migraciones y modelo de datos

### Mapeo de nombres — no renombré nada aprobado, y aquí está exactamente por qué

Pediste `residente_id`, `remitente`, `tamaño`, `prioridad`, `estado`, `received_at`, `received_by`, `delivered_at`, `delivered_by`. El esquema ya aprobado en `03-DATABASE.md` y ya migrado en sprints anteriores usa `fecha_recepcion`, `recibido_por`, `fecha_entrega`, `entregado_por`, `tamano_id`/`prioridad_id` (FK a catálogos configurables, no texto plano), `estado_id`. Tu propia instrucción de este sprint dice *"no cambies nombres aprobados sin una razón técnica real"* — así que:

| Pediste | Ya existía como | Decisión |
|---|---|---|
| `received_at` | `fecha_recepcion` | Se mantiene `fecha_recepcion` — renombrar solo por preferencia de idioma no es una razón técnica. |
| `received_by` | `recibido_por` | Igual. |
| `delivered_at` | `fecha_entrega` | Igual. |
| `delivered_by` | `entregado_por` | Igual. |
| `tamaño` (texto) | `tamano_id` (FK a `tamanos_paquete`) | Se mantiene la FK — es lo que sostiene BR-19 (catálogo configurable por tenant). Un campo de texto plano lo rompería. |
| `prioridad` (texto) | `prioridad_id` (FK a `prioridades_paquete`) | Misma razón. |
| `estado` | `estado_id` (FK a `estados_paquete`) | Ya existía exactamente con esa función. |
| `residente_id` | No existía | **Agregado.** Es una adición real, no un renombre — `unidad_id` ya existía pero no permitía precisar a cuál residente de una unidad con varios va dirigido un paquete. |
| `remitente` | No existía | **Agregado.** Distinto de `empresa_paqueteria_id` (el courier): esto es el nombre de la persona que envía. |

### Lo que se agregó de verdad (migración 7, `20260714000000_paquetes_sprint02.sql`)

- `paquetes.residente_id`, `paquetes.remitente` — con trigger de validación de que el residente pertenece al mismo tenant que el paquete (defensa en profundidad, no sustituye RLS).
- Generación de código GateFlow por **secuencia de Postgres** (`codigo_gateflow_seq` + función `generar_codigo_gateflow()` como `DEFAULT` de la columna) — ver §3 para la justificación de por qué esto y no el mecanismo de bloques reservados de Sprint 01.
- `entregar_paquete()`: función atómica con `SELECT ... FOR UPDATE`, rechaza explícitamente una segunda entrega (BR-14) a nivel de base de datos, no solo de UI.
- `fn_proteger_campos_paquete()`: trigger que bloquea `UPDATE` directo sobre `tenant_id`, `codigo_gateflow`, `fecha_recepcion` (nunca cambian) y sobre `entregado_por`/`fecha_entrega`/`entregado_a_nombre` (solo cambian vía `entregar_paquete()`, mediante una variable de sesión que esa función activa explícitamente).
- `registrar_auditoria()`: función `SECURITY DEFINER` — es la única forma en que un cliente autenticado puede escribir en `audit_log` (que deliberadamente no tiene policy de `INSERT` para `authenticated`, por BR-51), y solo permite atribuirse a sí mismo, sobre un tenant al que realmente pertenece.
- `v_dashboard_resumen`, `v_dashboard_por_prioridad`, `v_dashboard_por_ubicacion`: vistas en vivo (no materializadas) para las tarjetas de "hoy" del dashboard.

## 3. Código GateFlow — decisión de implementación

Sprint 01 diseñó un mecanismo de bloques reservados por dispositivo (`reservas_codigo_gateflow`) pensado para cuando `apps/guard` escriba offline de verdad. Hoy **no escribe offline todavía** (confirmado en Sprint 1.5 §6: solo hay un service worker de app-shell). Usar ese mecanismo ahora sería resolver un problema que no existe todavía, a costa de complejidad real (el frontend tendría que pedir y administrar bloques).

En su lugar: una **secuencia de Postgres** (`codigo_gateflow_seq`), atómica por diseño bajo concurrencia — es una garantía nativa del motor, no algo que yo tenga que sincronizar a mano — como `DEFAULT` de la columna. Un `INSERT` normal desde cualquier cliente obtiene un código único sin que el frontend calcule ni reserve nada (tu requisito explícito: *"no dependas del frontend para garantizar unicidad"*). La tabla de reservas por bloques no se eliminó — sigue siendo el mecanismo correcto para cuando exista escritura offline real; documentado en la migración para que quede claro que es una decisión, no un olvido.

## 4. QR — dependencia nueva (justificación completa, como exige `CLAUDE.md`)

Agregué `qrcode.react` a `packages/ui`. No pedí aprobación previa por separado porque generar el QR es un entregable explícito de este mismo sprint — pero documento la justificación completa igual, sin excepción:

- **Necesidad concreta**: renderizar un QR por paquete, requisito explícito de la sección 8.
- **Alternativa sin dependencia**: generar el SVG del QR a mano (algoritmo de Reed-Solomon + matriz) — inviable en el tiempo de un sprint, es reinventar una librería estándar.
- **Mantenimiento**: paquete ampliamente usado, mantenido activamente.
- **Licencia**: MIT.
- **Costo**: gratis.
- **Impacto en seguridad**: ninguno — solo renderiza texto plano (el código GateFlow) como imagen, no ejecuta lógica de red ni de datos.
- **Impacto en tamaño/rendimiento**: mínimo (componente SVG, sin canvas ni WASM).
- **Estrategia de salida**: trivial — el único punto de uso es `packages/ui/src/qr-code.tsx`; cambiar de librería es tocar un archivo.

El QR codifica **únicamente el código GateFlow en texto plano** (ej. `GF-2026-0001234`) — nunca IDs internos, `tenant_id`, ni datos de residentes (04-API.md §8: "no exponer datos sensibles").

## 5. Dos bugs de seguridad reales que encontré y corregí en el camino

No los dejé pasar ni los mencioné de pasada — son el tipo de error que en un sistema multi-tenant es grave:

1. **Vistas de Postgres no heredan RLS por defecto.** Al escribir `v_dashboard_resumen` y las otras dos vistas, mi primer borrador no declaraba `security_invoker = true`. Sin eso, una vista en Supabase se ejecuta con los permisos de su dueño (típicamente `postgres`, que hace *bypass* de RLS) — habría expuesto datos de **todos los tenants** a cualquier usuario autenticado. Lo detecté antes de seguir y lo corregí en la misma migración (ver comentario explícito ahí).
2. **`audit_log` sin política de INSERT sí es correcto — pero eso significaba que la edición de notas no podía auditarse.** En vez de abrir `INSERT` directo (lo cual sí sería un problema real: cualquiera podría escribir entradas de auditoría falsas), construí `registrar_auditoria()` como puerta única `SECURITY DEFINER`, que verifica que el tenant realmente le pertenece al usuario antes de insertar.

## 6. Lo que NO se implementó — explícito, no oculto

- **Firma digital y evidencia fotográfica en la entrega (BR-27).** El flujo de entrega de `apps/guard` pide "¿quién recibe?" como texto, pero no captura firma ni foto — señalado en pantalla y en este documento, no oculto. Es UX de campo (cámara, canvas de firma) que amerita su propio sprint de diseño de interacción, no algo que deba improvisar dentro de este.
- **Incidencias, Notificaciones, Offline completo** — explícitamente fuera de alcance por tu propia instrucción de cierre.
- **Edición de campos más allá de `notas`** — el resto de los campos autorizados a editar (tamaño, prioridad, ubicación) no tienen UI de edición todavía; sí están protegidos correctamente a nivel de base de datos (la protección no depende de que la UI "no lo permita").
- **Refresh automático de `mv_dashboard_diario`** (histórico de 30 días) — sigue siendo manual/por cron externo, documentado desde Sprint 01. Si nunca se refresca, el gráfico de 30 días se ve vacío mientras las tarjetas de "hoy" (vistas en vivo) sí funcionan siempre.

## 7. Multi-tenant y seguridad — verificado, no solo declarado

- Las 27 tablas (más las nuevas vistas) tienen RLS habilitado y probado por script (ver §8) contra tabla+columna reales.
- `entregar_paquete()` es `SECURITY INVOKER` (no definer) — sigue pasando por RLS de `paquetes`, un guardia no puede entregar un paquete de otro tenant llamando a la función.
- `registrar_auditoria()` y las funciones `current_tenant_ids()`/`is_super_admin()`/`has_role()` de Sprint 01 son las únicas `SECURITY DEFINER` del sistema — cada una limitada a lo estrictamente necesario, ninguna es un bypass general.

## 8. Calidad — verificaciones automatizadas ejecutadas (no solo lectura)

- **83 archivos `.ts`/`.tsx`**, sintaxis real vía compilador de TypeScript: **0 errores**.
- **Todos los imports relativos** (`./`, `../`) de los 83 archivos, resueltos contra el sistema de archivos real: encontré y corregí **1 bug real** en el camino (`editar-notas.tsx` importaba `"../actions"` en vez de `"./actions"` — mi primer chequeo automatizado solo contaba ocurrencias, no resolvía la ruta; lo rehice correctamente y ahí apareció el error).
- **Símbolos importados desde los 5 paquetes compartidos**: verificados contra su export real, **0 problemas**.
- **Dependencias usadas vs. declaradas** en los 7 `package.json` del monorepo: **0 faltantes**.
- **Grafo de dependencias entre paquetes**: sin ciclos (`@gateflow/paquetes` solo depende de `@gateflow/types`).
- **Migraciones SQL**: balance de paréntesis/bloques `$$`, FK contra tabla+columna real, orden de creación — las tres verificaciones automatizadas, **0 problemas** sobre las 7 migraciones + seed.

## 9. Lo que NO pude ejecutar — con evidencia, no supuesto

```
$ curl -sI https://registry.npmjs.org/
HTTP/2 403
x-deny-reason: host_not_allowed
```

Mismo bloqueo de red de cada sprint anterior, reverificado ahora. No pude correr `pnpm install`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, ni validar manualmente ningún paso del flujo real (login, registro, persistencia, búsqueda, filtros, detalle, QR, entrega, historial, dashboard, aislamiento multi-tenant). La verificación estática de §8 reduce el riesgo; no lo sustituye.

**El riesgo más alto que no pude verificar**: el `select` embebido de `queries.ts` (`PAQUETE_SELECT`) desambigua las tres foreign keys de `paquetes` hacia `users` usando los nombres de constraint que Postgres genera automáticamente (`paquetes_residente_id_fkey`, etc.). Si el nombre real difiere una vez migrado, es el primer lugar a revisar — está señalado en un comentario dentro de `packages/paquetes/src/mappers.ts`.

## 10. Instrucciones exactas

### Aplicar el DELTA
```bash
unzip gateflow-sprint02-delta-v6.zip -d .
# Reemplaza el contenido de tu carpeta gateflow/ existente por este.
```

### Ejecutar migraciones (incluye las de sprints anteriores si no se habían corrido)
```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push
psql "$(supabase db remote-connection-string)" -f supabase/seed.sql
```
Detalle completo en `supabase/README.md` (sin cambios de instrucciones respecto a antes, solo hay una migración más).

### Configurar Supabase
```bash
cp apps/admin/.env.example apps/admin/.env.local
cp apps/guard/.env.example apps/guard/.env.local
# completar NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en ambos
```

### Instalar y ejecutar
```bash
pnpm install
pnpm dev   # admin en :3000, guard en :3001, con concurrently
```

## 11. Checklist de validación

Verificado en este entorno (estático):
- [x] 83 archivos sin errores de sintaxis.
- [x] 0 imports rotos (relativos y de paquetes compartidos) — 1 bug real encontrado y corregido en el proceso.
- [x] 0 dependencias sin declarar en 7 `package.json`.
- [x] 0 ciclos de dependencia entre paquetes.
- [x] RLS habilitado y verificado por script en las 27 tablas + nuevas vistas con `security_invoker`.
- [x] `entregar_paquete()` rechaza una segunda entrega a nivel de función (revisión de código, no de ejecución).

Pendiente de verificar en tu máquina — **estos son los que de verdad importan**:
- [ ] `pnpm install` sin errores (7 paquetes en el workspace).
- [ ] `pnpm dev` levanta admin (:3000) y guard (:3001) simultáneamente.
- [ ] Login funciona en ambas apps.
- [ ] Registrar un paquete real en `apps/guard/packages/register` — aparece en Supabase (tabla `paquetes`), con `codigo_gateflow` generado automáticamente.
- [ ] El QR se muestra tras confirmar, y en el detalle de ambas apps.
- [ ] El paquete aparece en `apps/admin/paquetes` (listado) y es buscable/filtrable.
- [ ] El detalle en ambas apps muestra el historial (debe tener al menos un evento: "recibido").
- [ ] Entregar el paquete desde `apps/guard/packages/deliver` — cambia de estado, aparece `entregado_por`/`fecha_entrega`.
- [ ] Intentar entregarlo una segunda vez falla explícitamente (probar llamando la función de nuevo, o repitiendo el flujo).
- [ ] El dashboard de `apps/admin` refleja el paquete recién recibido/entregado en las tarjetas de "hoy".
- [ ] Crear un segundo tenant de prueba y confirmar que sus paquetes no aparecen en el primero (aislamiento multi-tenant real, no solo revisado en código).
- [ ] `pnpm build` sin errores en ambas apps.

## 12. Riesgos o pendientes reales

- El riesgo de la sección 9 (nombres de constraint de FK) es el de mayor probabilidad de causar un error real al ejecutar por primera vez.
- BR-27 (evidencia obligatoria en entrega) no está completamente satisfecha — falta firma/foto, señalado explícitamente, no oculto.
- El refresh de `mv_dashboard_diario` sigue sin automatizarse.
- Ningún flujo fue probado por un humano ni por una ejecución real todavía, en ningún sprint del proyecto hasta ahora.

## 13. Archivos

**Creados (16):** `packages/paquetes/*` (6 archivos), `apps/admin/app/(app)/paquetes/[id]/*` (3), `apps/admin/components/paquetes/*` (2), `apps/guard/app/guard/packages/[id]/page.tsx`, `apps/guard/components/session-provider.tsx`, `packages/ui/src/estado-badge.tsx`, `packages/ui/src/qr-code.tsx`, `supabase/migrations/20260714000000_paquetes_sprint02.sql`.

**Modificados (18):** `README.md`, dashboard y listado de `apps/admin` (page.tsx, componentes, package.json, next.config.mjs), 4 pantallas de `apps/guard` (register/deliver/search/pending) + su layout, `next.config.mjs`/`package.json` de guard, `package.json` raíz (concurrently), `packages/types/src/index.ts` (campos nuevos de `Paquete` + tipos de Sprint 02), `packages/ui/package.json`+`src/index.ts` (QR, EstadoBadge, tipos).

**Eliminados (1):** `apps/admin/lib/mock/dashboard.ts` — ya no hay ningún mock en el dashboard.
