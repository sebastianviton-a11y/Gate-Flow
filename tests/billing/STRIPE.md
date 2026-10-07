# Plan de pruebas con Stripe TEST

Dos fallos de cobro distintos que **no** deben confundirse:

| | Rechazo del **pago inicial** | Fallo de una **factura de renovación** |
|---|---|---|
| Cuándo | El admin paga por primera vez en el Checkout hospedado (trial vencido o realta) | La suscripción ya está `active` y llega el fin del periodo |
| Qué hace Stripe | Checkout muestra el rechazo y deja reintentar; **no** emite `checkout.session.completed`; si se abandona, la sesión expira (`checkout.session.expired`, 60 min). Por API, la suscripción nace `incomplete` → `incomplete_expired` a las 23 h | Crea la factura del periodo nuevo, **avanza `current_period_end` al periodo nuevo** e intenta cobrar (~1 h después); si falla: `invoice.payment_failed` y la suscripción pasa a `past_due`. Luego reintenta según la configuración de la cuenta |
| Qué hace Gate Flow | Nada se activa: `incomplete*` → `ignorar`; el checkout queda `created` → `expired`; el residencial sigue bloqueado por trial vencido. **Nunca** `past_due` | `past_due` con 7 días de gracia (aviso de pago en Admin, Guard opera); `invoice.paid` → `active`; al agotarse los reintentos, lo que diga la configuración |
| Tarjetas TEST | Checkout: `4000 0000 0000 0002` (rechazo genérico), `4000 0000 0000 9995` (fondos insuficientes), `4000 0027 6000 3184` (3DS) · API: `pm_card_chargeCustomerFail` | `pm_card_chargeCustomerFail` (`4000 0000 0000 0341`): se adjunta bien y **todos** los cobros fallan |
| Cómo se valida | Capa S · P2 (API) + Checkout hospedado (manual) | Capa S · P3 (test clock) y P6 (residencial sintético activado por Checkout, cadena real completa) |

## Hallazgo pendiente antes de preproducción: la gracia de `past_due`

La regla vigente (`tenant_operativo`, `estadoEfectivoSuscripcion`,
`docs/operations/BILLING.md`) es `now < current_period_end + 7 días`, y el
normalizador guarda el `current_period_end` del ítem de la suscripción. Pero en
una renovación fallida Stripe **ya avanzó** ese `current_period_end` al final
del periodo impago. Resultado: la gracia efectiva sería ≈ **1 mes + 7 días**
desde el fallo, y el aviso "Actualiza tu método de pago antes del …" mostraría
esa fecha. Los tests anteriores no lo detectaban porque modelaban `past_due`
con un `current_period_end` en el pasado.

- La capa A lo registra como **PENDIENTE** (escenario 10) con el objeto que
  devuelve Stripe tras una renovación fallida; pasa a PASS cuando se corrija.
- La capa S lo **confirma contra Stripe real** (P3 con test clock y P6 con la
  cadena completa en staging) y falla si la gracia efectiva supera 7 días.
- Corrección propuesta (requiere aprobación; no se implementó): medir la
  gracia desde el fallo — p. ej. guardar el inicio del periodo impago
  (`current_period_start` del ítem, o el `period_start` de la factura abierta)
  al aplicar `past_due` y usarlo en `tenant_operativo`, en
  `estadoEfectivoSuscripcion` y en el aviso. Implica migración + TS + tests.

## Qué depende de la configuración de la cuenta de Stripe

El calendario de reintentos (Smart Retries o un calendario fijo) y la acción
**cuando fallan todos los reintentos** (cancelar la suscripción, marcarla
`unpaid` o dejarla `past_due`) son ajustes del Dashboard
(Configuración → Billing → Recuperación de ingresos). **No se pueden leer por
API** y esta batería no los cambia. P3 los **observa**: avanza el test clock en
pasos de 3 días hasta 45 días y registra la traza (`+Nd:estado`) y el estado
final, que luego pasa por nuestro normalizador:

| Estado final en Stripe | Normalizado | Acceso en Gate Flow |
|---|---|---|
| `canceled` | `canceled` | bloqueado |
| `unpaid` | `past_due` | **gracia según `current_period_end`** → ver hallazgo |
| `past_due` (sin acción) | `past_due` | ídem |

P3 falla si con el estado final el residencial sigue operativo.

## Automatización

| Qué | Dónde corre | Estado |
|---|---|---|
| Firma real de webhooks, normalización, regla de acceso con objetos simulados | Capa A (cada PR) | automatizado |
| Forma de TODAS las solicitudes a Stripe de la capa S (66), contra la especificación OpenAPI oficial | Job `stripe-mock` (cada PR) | automatizado |
| P1 configuración: endpoint del webhook de staging habilitado y suscrito a los 11 eventos; Customer Portal (cancelar al final del periodo, sin cambio de plan, actualizar tarjeta) | Capa S, workflow manual | automatizado, **no ejecutado aún** |
| P2 rechazo del pago inicial (API): `incomplete` → `incomplete_expired`, ignorado | Capa S | automatizado, no ejecutado |
| P3 renovación fallida con test clock: `past_due`, gracia medida desde el fallo, recuperación con `invoices.pay`, reintentos hasta el estado final | Capa S | automatizado, no ejecutado |
| P4 cancelación al final del periodo → `canceled` | Capa S | automatizado, no ejecutado |
| P5 webhooks reales: Stripe entregó y staging aceptó (2xx) cada evento (`pending_webhooks = 0`), quedaron registrados sin tocar ningún tenant, y se borran por id | Capa S | automatizado, no ejecutado |
| P6 renovación fallida REAL de un residencial sintético activado por Checkout (`billing_cycle_anchor = now` con tarjeta que falla → webhook → staging `past_due` → `tenant_operativo` → `invoice.paid` → `active`) | Capa S + 1 paso manual previo | automatizado, no ejecutado |

Limpieza de la capa S: borra sus test clocks (Stripe borra con ellos clientes
y suscripciones) y, en staging, los `billing_eventos` de la prueba por id
(solo los `sin_asociacion` / `ignorado` / `rechazado`, sin tenant). Producto y
precio fixture (`lookup_key gf_autotest_…`) se crean una vez y se reutilizan.
Stripe TEST no envía correos a clientes; los correos de prueba son
`@example.com`.

## Bloqueos que quedan (precisos)

1. **No hay runner autorizado todavía.** Este entorno no tiene red hacia
   `*.stripe.com`, `*.supabase.co` ni `*.netlify.app`, ni credenciales; el repo
   no tenía CI. Los workflows manuales `billing-stripe-test.yml` y
   `billing-staging.yml` son ese runner una vez que:
   - la rama esté en GitHub (no autorizado aún: sin push);
   - existan los environments `billing-stripe-test` y `billing-staging` con
     revisores obligatorios;
   - estén sus secretos: `STRIPE_TEST_SECRET_KEY` (clave restringida
     `rk_test_` de la cuenta de pruebas) y `GF_STAGING_DB_URL` (rol con
     lectura y borrado sobre `billing_eventos`; el runner de staging necesita
     además escribir dentro de su transacción revertida).
     Permisos de la clave restringida: Test clocks, Customers, Payment
     methods, Subscriptions, Invoices, Products y Prices (escritura);
     Checkout Sessions, Events, Webhook endpoints y Customer portal (lectura).
     Si la cuenta no ofrece permiso de test clocks para claves restringidas,
     usar una `sk_test_` solo en ese environment protegido.
2. **Checkout hospedado (UI de Stripe).** La activación inicial y el rechazo
   inicial *en la UI* (`checkout.stripe.com`) no tienen API: requieren
   navegador. Se dejan manuales (paso previo de P6). Automatizarlos con
   Playwright en el runner es posible pero no se puede validar desde aquí.
3. **Customer Portal (UI).** Actualizar tarjeta y cancelar desde el portal es UI
   de Stripe: manual. P1 verifica su configuración por API (solo lectura).
4. **Configuración de reintentos.** Solo observable (P3); cambiarla está fuera
   de alcance.
5. **Hallazgo de la gracia** (arriba): bloquea preproducción hasta decidir y
   aplicar la corrección.

## Paso manual previo a P6 (staging, Stripe TEST)

1. Crear un residencial **sintético** (`ZZ_AUTOTEST_…` en el nombre y
   `observaciones = gf-autotest:<run>`) con el trial vencido.
2. Con su admin, pagar en el Checkout hospedado con `4242 4242 4242 4242`.
3. Confirmar en staging que quedó `active` y tomar su `provider_subscription_id`.
4. Ejecutar el workflow manual con `GF_STRIPE_SUSCRIPCION_SINTETICA=sub_…`
   (P6 se niega a tocar una suscripción que no sea de un residencial
   `ZZ_AUTOTEST_`).
