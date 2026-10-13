# Suscripción manual desde Super Admin

Permite operar residenciales sin proveedor de cobro (Argentina antes de
Mercado Pago): extender la prueba, activar el servicio hasta una fecha y
mover esa fecha. Es una activación **administrativa**: no cobra, no usa
Stripe ni Mercado Pago y no crea checkouts ni eventos de billing.

Migración: `supabase/migrations/20261013000000_superadmin_suscripcion_manual.sql`
(rollback: `supabase/rollback/20261013000000_superadmin_suscripcion_manual.down.sql`).

## Modelo (sin columnas nuevas)

| Acción | Desde | Resultado |
|---|---|---|
| Extender prueba | `trialing` (vigente o vencida) | sigue `trialing`; `trial_ends_at` = fin del día elegido |
| Activar manualmente | `trialing`, `expired`, `canceled`, `past_due` sin proveedor | `active`, `origen = alta_manual`, `current_period_end` = fin del día elegido, `cancel_at_period_end = true`, plan opcional |
| Extender vigencia | `active` manual con vencimiento (incluso ya vencida) | `current_period_end` más adelante |

* "Hasta el 30/11" = acceso durante todo el 30/11 en la zona del
  residencial (`tenants.timezone`): el corte es la medianoche local del
  01/12.
* El vencimiento no necesita cron ni webhook: `tenant_operativo()` ya
  trata `active + cancel_at_period_end` como operativo solo mientras
  `now() < current_period_end` (y `estadoEfectivoSuscripcion` en
  `packages/auth/src/acceso.ts` es la misma regla). **tenant_operativo no
  cambió.**
* Al vencer, un residencial de México puede contratar con Stripe:
  `billing_crear_checkout` ya lo permite para `active + cancel_at_period_end`
  con el periodo terminado. Mientras la activación rige, no.
* `provider`, `provider_customer_id` y `provider_subscription_id` quedan
  en NULL: no hay proveedor ficticio.

## Reglas

* Solo Super Admin: `is_super_admin()` dentro de cada función (42501).
  EXECUTE solo para `authenticated`; `anon` y `service_role`, revocados
  (también contra los default privileges de Supabase). Ningún rol tiene
  UPDATE directo sobre `suscripciones`.
* Nunca sobre una suscripción con proveedor (Stripe; más adelante Mercado
  Pago): error `gestionada_por_proveedor`, la fila no cambia.
* Tampoco sobre las altas manuales sin vencimiento (residenciales
  anteriores al trial): `activa_sin_vencimiento`.
* Fechas: desde hoy (local); como mucho 180 días (prueba) o 2 años
  (activación) adelante; extender nunca acorta y activar durante una
  prueba vigente no la acorta (`fecha_anterior`).
* Plan opcional (`hasta-50` / `hasta-150`), validado contra las viviendas
  igual que el checkout (`plan_insuficiente`). Sin plan = acuerdo a medida.
* Con un checkout del proveedor abierto, no se activa (`checkout_abierto`).
* FOR UPDATE sobre la única suscripción del residencial y UPDATE por id +
  tenant + estado leído: exactamente 1 fila o error. Misma fecha que la
  vigente → `sin_cambios` (doble envío o dos Super Admin a la vez), sin
  auditoría duplicada.

## Auditoría

`audit_log` (entidad `suscripciones`, `entidad_id` = la suscripción,
`user_id` = el Super Admin, `created_at`):

* `superadmin.trial_extendido`
* `superadmin.suscripcion_activada_manual`
* `superadmin.suscripcion_vigencia_extendida`

`datos_anteriores` / `datos_nuevos`: estado, origen, plan y fechas, más la
fecha elegida, la zona horaria y `cobro: ninguno`. Sin datos personales ni
tokens.

## Pantalla (Super Admin → Residenciales → detalle → «Suscripción»)

* Muestra estado, origen, fin de la prueba, vigencia, proveedor, plan,
  viviendas declaradas y si el residencial puede operar hoy (misma regla
  que `tenant_operativo`), con las fechas en su zona horaria.
* Solo ofrece las acciones que la base acepta para ese estado: prueba →
  «Extender prueba» y «Activar manualmente»; activación manual →
  «Extender vigencia»; cancelada/vencida sin proveedor → «Activar
  manualmente»; con Stripe → «Esta suscripción está gestionada por
  Stripe.» y ninguna acción; alta manual sin vencimiento → sin acciones.
* Fecha explícita ("hasta, incluido") con los límites de la base y una
  confirmación antes de guardar: «Este residencial podrá usar Gate Flow
  hasta el 30/11/2026. Esta acción no genera ningún cobro automático.»
  (+ "No usa Stripe ni Mercado Pago").
* Server actions (`apps/admin/app/superadmin/suscripcion-actions.ts`):
  sesión de super_admin, validación de la entrada y la RPC con el JWT de
  quien opera (nunca la clave de servicio).
* El panel del residencial no dice "cancelada": en `/suscripcion` muestra
  «Activa hasta el …» y, en los últimos 7 días, la línea discreta «Tu
  suscripción está activa hasta el …».
* El historial queda en `audit_log`; Super Admin todavía no lo ve en la
  pantalla (`authenticated` no tiene SELECT sobre `audit_log`).

## Desactivar

No hay acción nueva. Una activación manual vence sola en su fecha; para
cortar antes, la vía existente es cambiar el estado del servicio del
residencial a "suspendido" (`superadmin_cambiar_estado_servicio`).

## Pruebas

* `supabase/tests/security/93_suscripcion_manual.sql` (fase SM de
  `run-local.sh`) y `concurrencia_suscripcion_manual.sh` (dos sesiones).
* `supabase/tests/grants/93_suscripcion_manual.sql` (grants de un proyecto
  nuevo de Supabase).
* `apps/admin/lib/__tests__/suscripcion-manual.test.ts` (acciones por
  estado, fechas, textos, errores, aviso del residencial).
* `tests/superadmin/e2e-suscripcion-manual.mjs` (opt-in, local: Admin real
  + PostgREST + Playwright; prueba vencida → extender → activar → extender
  con doble clic → vencimiento → bloqueo; Stripe intacto; teardown con hash).
