# Batería automatizada: billing + lifecycle

Prueba de punta a punta del ciclo trial → pago → renovación/gracia/cancelación,
con datos **sintéticos** y sin tocar producción ni datos reales.

```bash
pnpm test:billing                      # A + B: seguro para CI (sin red, sin credenciales, sin staging)
pnpm test:billing:e2e                  # A + B + C local (+ staging / Stripe TEST solo con opt-in)
node tests/billing/run.mjs --staging   # solo C-staging (opt-in)
node tests/billing/run.mjs --stripe    # solo S Stripe TEST (opt-in)
```

**Estado:** las capas A, B y C-local corren y pasan; C-staging corrió contra la
base de staging (revertido). La integración con **Stripe TEST real (capa S)
está escrita y validada contra `stripe-mock`, pero todavía no se ejecutó
contra Stripe** (no hay runner con red y credenciales): la batería **no** está
terminada hasta correr S y los pasos manuales de `STRIPE.md`.

Al final imprime una tabla por escenario (1–20), los fallos, lo omitido, los
fixtures creados/eliminados/residuos por capa y
`TOTAL / PASS / FAIL / SKIPPED / RESIDUOS / DURACION` + `RESULTADO: PASS|FAIL`.
Código de salida 1 si hay un FAIL o algún residuo.

## Capas

| Capa | Qué ejecuta | Dónde | Escribe |
|---|---|---|---|
| **A** | `apps/admin/lib/__tests__/billing-bateria.test.ts` + las suites de billing existentes | Node (tsx) | nada |
| **B** | `tests/billing/db/escenarios.sql` vía `db/run-local.sh` | Postgres local desechable `gf_billing_test` (todas las migraciones) | todo revertido |
| **B2** | `billing-bateria-pipeline.test.ts`: firma real → `procesarWebhook` → `StripeBillingProvider` (API simulada) → `servidor.aplicarEventoEnBase` → PostgREST → RPC | pila local | base local, fixtures borrados por id |
| **C-local** | `tests/billing/e2e/run-local.mjs`: Admin y Guard reales (`next build/start`), HTTP y Playwright | pila local | base local, fixtures borrados por id |
| **C-staging** | `tests/billing/staging/run-staging.sh`: el MISMO paquete SQL de la capa B + comprobaciones HTTP | staging (opt-in) | **sí: filas sintéticas dentro de una transacción, revertidas** (ver abajo) |
| **S** | `apps/admin/lib/__tests__/billing-stripe-integracion.test.ts`: Stripe TEST real (test clocks, webhooks reales a staging) → nuestro normalizador y regla de acceso. Ver `STRIPE.md` | Stripe TEST + staging (opt-in, workflow manual) | objetos en Stripe TEST (borrados) y eventos en staging (borrados por id) |

### Pila local (C)
Postgres local (`gf_billing_e2e`) → PostgREST → `e2e/gateway.mjs`, que imita
`/rest/v1` y `/auth/v1/user` (JWT HS256 con un secreto aleatorio por corrida;
nunca se imprime) → Admin y Guard compilados contra esa URL. La sesión de
Playwright es una cookie `sb-localhost-auth-token` firmada con ese secreto; no
existe GoTrue ni usuarios reales. `e2e/sin-red-stripe.cjs` (precarga) **bloquea
cualquier salida a `*.stripe.com`** desde los servidores Next y anota el
intento, así que el CTA llega hasta el proveedor sin contactarlo.

Requisitos (si falta alguno, la capa queda **SKIP**, nunca PASS):

```bash
export PGHOST=/tmp PGPORT=54329 PGUSER=postgres          # Postgres local
export GF_POSTGREST_BIN=/ruta/a/postgrest                 # v12.x
export GF_PLAYWRIGHT_CORE_DIR=/ruta/con/node_modules      # npm i playwright-core
export GF_CHROMIUM=/ruta/a/chrome                          # opcional
```

## Seguridad de los datos

- **Producción**: ningún script acepta el ref `xlozkpygubyiuxopmdxw` ni `gateflow.mx`.
- **Staging**: solo con `GF_BILLING_E2E_STAGING=1` + `GF_STAGING_DB_URL` que
  contenga `sfuckzzqejerrifuypby`; nunca con `CI=true`. La URL no se imprime.
  **El runner de staging SÍ escribe**: dentro de UNA transacción inserta y
  modifica filas sintéticas (empresa, 6 tenants, 13 usuarios en `auth.users` y
  `public.users`, membresías, suscripciones, unidades, calles, checkouts,
  eventos de billing y auditoría que generan las RPC), ejecuta el teardown por
  ids y termina con la excepción que revierte todo. Mientras dura (segundos, con
  `statement_timeout` 120 s y `lock_timeout` 5 s) esas filas no son visibles
  para otras sesiones y solo se bloquean filas sintéticas. Lo que el rollback no
  deshace: el consumo de recursos (WAL, estadísticas); no consume secuencias
  (las tablas tocadas usan uuid). Antes y después compara un hash de 11 tablas
  y cuenta filas `ZZ_AUTOTEST_`. Las comprobaciones HTTP no escriben si el
  sistema funciona bien (firma inválida → 401 antes de tocar la base); si
  escribieran, el hash posterior lo detecta como FAIL.
- **Paquete SQL**: `begin;` sin `commit`, y el bloque final **siempre** termina en
  la excepción `GF_AUTOTEST_RESULTADOS:{json}` → rollback, incluso si quien lo
  ejecuta lo olvida. Lleva `statement_timeout` y `lock_timeout`.
- **Marcas**: empresa/tenants `ZZ_AUTOTEST_<fecha>_<azar>…` con
  `observaciones = gf-autotest:<run>`; usuarios
  `zz_autotest+<run>-<rol>@gateflow.invalid` (dominio reservado, no recibe
  correo); eventos `evt_<run>_…`; checkouts `cs_test_<run>_…`.
- **Teardown** (`db/teardown.sql`, el mismo en B y C): borra **solo por ids
  registrados**, nunca un DELETE genérico; aborta sin borrar nada si un id no
  lleva la marca del run o si un DELETE afecta un número de filas distinto del
  esperado. Luego cuenta residuos en 11 tablas (deben ser 0).
- **Datos reales**: hash antes/después de tenants, suscripciones, membresías,
  usuarios, empresas, unidades, checkouts, eventos y auditoría (dentro de la
  transacción en B y, en staging, también desde fuera tras el rollback).
- **Stripe**: ninguna llamada real. Firma con `Stripe.webhooks` offline; la API
  es un cliente simulado; en C-local la red hacia Stripe está bloqueada.
- **Tiempo**: instantes fijos (capa A) o relativos a `now()` de la transacción
  (B/C); nunca se cambia el reloj.

## Escenarios

| # | Escenario | A | B | B2 | C-local |
|---|---|---|---|---|---|
| 1 | Trial activo | decisión Admin/Guard, sin checkout | operativo, `estado_no_permite` | | activo → dashboard / gestión |
| 2 | Trial vencido | → `/suscripcion`, Guard bloqueado | no operativo, frontera exacta, datos intactos | | Playwright Admin y Guard |
| 3 | Checkout válido | núcleo con Stripe simulado, solo `planId` | 1 checkout, plan/monto, sin activación | núcleo + RPC por PostgREST | clic en "Activar plan" |
| 4 | `checkout.session.completed` | normalización (refetch) | active, ids, periodo, auditoría | base real | dashboard y Guard desbloqueados |
| 5 | Idempotencia | 200 sin efectos | `duplicado`, hash igual | base real | |
| 6 | Otro tenant (W04) | no cancela | `suscripcion_de_otro_tenant`, B intacto | base real | |
| 7 | Duplicada mismo tenant | cancela solo la nueva | `suscripcion_duplicada`, reintento | base real | |
| 8 | `cancel_at_period_end` | aviso, límite exacto | operativo antes / no en el límite | | Admin y Guard bloqueados |
| 9 | `past_due` en gracia | aviso de pago | día 3 y 1 s antes de 7 días | base real | aviso + Guard opera |
| 10 | `past_due` fuera de gracia | bloqueo; **PENDIENTE**: renovación fallida real (ver `STRIPE.md`) | frontera de 7 días, día 8 | | "Actualizar método de pago" |
| 11 | `invoice.paid` | factura → suscripción | active + auditoría | base real | Guard desbloqueado |
| 12 | `subscription.deleted` | canceled | canceled, datos intactos, realta | base real | planes de nuevo |
| 13 | Fuera de orden | refetch, versión monótona | `obsoleto` (más viejo / misma versión) | base real | |
| 14 | Firma inválida | 4 variantes → 401, 0 consultas | | 401, 0 escrituras | HTTP 401 |
| 15 | Config inválida | live/staging/sin secreto | | 503, 0 escrituras, log sin secretos | HTTP 503, log |
| 16 | Viviendas | ≤50 / 51–150 / >150 / max() | mismas fronteras en la base | | plan deshabilitado |
| 17 | Roles | admin sí; guardia/residente/super_admin no | `billing:rol` | | guardia → Guard |
| 18 | Multitenant | `gf_tenant` revalidado | rol por tenant | | cookie ajena → falla cerrado |
| 19 | Integridad referencial | | FK, únicos, checks, inmutable | | |
| 20 | Teardown | salvaguardas estáticas | aborta sin marca; 0 residuos; hash | | 0 residuos; hash |

## CI

| Workflow | Disparo | Qué corre | Credenciales |
|---|---|---|---|
| `billing-tests.yml` | cada pull request | `pnpm test:billing` (A + B; un SKIP de A/B es FAIL por `GF_BILLING_EXIGIR`) con un `postgres:17` desechable, y la capa S completa contra `stripe-mock` | ninguna |
| `billing-staging.yml` | manual, escribiendo `staging`, environment `billing-staging` | `node tests/billing/run.mjs --staging` | `GF_STAGING_DB_URL` |
| `billing-stripe-test.yml` | manual, escribiendo `stripe-test`, environment `billing-stripe-test` | `node tests/billing/run.mjs --stripe` | `STRIPE_TEST_SECRET_KEY`, `GF_STAGING_DB_URL` |

Dependencias del job de PR: Node 20 (como Netlify), pnpm 9.0.0 (de
`packageManager`), `pnpm install --no-frozen-lockfile` (el repo no versiona
`pnpm-lock.yaml`), cliente `psql`/`createdb`/`dropdb` (preinstalado en
`ubuntu-24.04`; si falta, se instala `postgresql-client`), servicio
`postgres:17` con `trust` y servicio `stripe/stripe-mock:v0.206.0`. `tsx` se
obtiene con `npx -y`. Staging y Stripe TEST nunca corren en un PR: además del
opt-in, `run.mjs`, `run-staging.sh` y la capa S rechazan `CI=true` salvo
`workflow_dispatch` con la confirmación escrita.

## Stripe

Rechazo del pago inicial vs. fallo de una factura de renovación, qué depende
de la configuración de la cuenta, qué está automatizado, qué queda manual y el
**hallazgo pendiente sobre la gracia de `past_due`**: ver [`STRIPE.md`](STRIPE.md).
