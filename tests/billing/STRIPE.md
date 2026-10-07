# Plan de pruebas con Stripe TEST

Dos fallos de cobro distintos que **no** deben confundirse:

| | Rechazo del **pago inicial** | Fallo de una **factura de renovación** |
|---|---|---|
| Cuándo | El admin paga por primera vez en el Checkout hospedado (trial vencido o realta) | La suscripción ya está `active` y llega el fin del periodo |
| Qué hace Stripe | Checkout muestra el rechazo y deja reintentar; **no** emite `checkout.session.completed`; si se abandona, la sesión expira (`checkout.session.expired`, 60 min). Por API, la suscripción nace `incomplete` → `incomplete_expired` a las 23 h | Crea la factura del periodo nuevo, **avanza `current_period_end` al periodo nuevo** e intenta cobrar (~1 h después); si falla: `invoice.payment_failed` y la suscripción pasa a `past_due`. Luego reintenta según la configuración de la cuenta |
| Qué hace Gate Flow | Nada se activa: `incomplete*` → `ignorar`; el checkout queda `created` → `expired`; el residencial sigue bloqueado por trial vencido. **Nunca** `past_due` ni abre un impago | `past_due` con 7 días de gracia **desde el inicio del impago** (`impago_desde` = `current_period_start` del periodo impago; aviso de pago con la fecha en Admin, Guard opera); `invoice.paid` → `active` y cierra el episodio; al agotarse los reintentos, lo que diga la configuración |
| Tarjetas TEST | Checkout: `4000 0000 0000 0002` (rechazo genérico), `4000 0000 0000 9995` (fondos insuficientes), `4000 0027 6000 3184` (3DS) · API: `pm_card_chargeCustomerFail` | `pm_card_chargeCustomerFail` (`4000 0000 0000 0341`): se adjunta bien y **todos** los cobros fallan |
| Cómo se valida | Capa S · P2 (API) + Checkout hospedado (manual) | Capa S · P3 (test clock) y P6 (residencial sintético activado por Checkout, cadena real completa) |

## Gracia de `past_due`: hallazgo y corrección (`20261009000000`, pendiente de aplicar)

**Hallazgo.** La regla anterior (`tenant_operativo`,
`estadoEfectivoSuscripcion`) era `now < current_period_end + 7 días` y el
normalizador guardaba el `current_period_end` del ítem. En una renovación
fallida Stripe **ya avanzó** ese `current_period_end` al final del periodo
impago (typedoc de stripe-node 23 / API `2026-09-30.endive`:
`current_period_start` = "the start time of this subscription item's
current billing period"; la suscripción queda `past_due` mientras la
factura de ese periodo no se cobra). Resultado: gracia efectiva ≈ **1 mes +
7 días**. Los tests anteriores no lo detectaban porque modelaban `past_due`
con un `current_period_end` en el pasado.

**Corrección** (código en esta rama; la migración está preparada y **no**
aplicada en staging ni producción):

- `suscripciones.impago_desde`: inicio del episodio de impago =
  `current_period_start` del ítem cuando Stripe reporta `past_due`
  (referencia estable: es la misma en el fallo, en cada reintento y en
  cada evento duplicado o tardío del mismo periodo). No se usa la hora de
  recepción del webhook ni se inventan fechas.
- **Hipótesis H1 (sin confirmar con Stripe real).** Que
  `current_period_start` sea el inicio del impago se apoya en la
  documentación de tipos del SDK y en fixtures construidos con esa
  suposición; eso **no** lo demuestra. H1: en los flujos soportados
  (renovación `subscription_cycle`; y el cambio de ancla
  `billing_cycle_anchor=now` del P6, `subscription_update`) la factura
  impaga se crea en el `current_period_start` del ítem, su línea cubre el
  periodo que empieza ahí y el primer cobro fallido es posterior (≈ 1 h en
  una renovación). Si H1 es cierta, la gracia dura 7 días desde que el
  cobro vence (unos minutos u horas menos que 7 días desde el primer
  fallo). P3 y P6 la miden: `billing_reason`, `factura.created − cps`,
  `línea.period.start − cps`, `primer cobro fallido − cps` y, en P6,
  `impago_desde` guardado en staging `= cps`; fallan si no se cumple.
  **Fuera de H1** (no soportado hoy: el portal no permite cambiar de plan y
  la app no modifica suscripciones): una factura a mitad de periodo
  (prorrateo, factura manual) tendría un `current_period_start` anterior
  al impago y acortaría la gracia. Si alguna vez se habilita, hay que
  tomar la fecha de la factura impaga.
- Webhook de un episodio anterior recibido tarde: el servidor reconsulta la
  suscripción (estado actual) y la base no cambia un inicio ya fijado
  (inmutable dentro del episodio), así que nunca acorta ni reabre el
  episodio nuevo. Cubierto en B, B2 y P3.
- Gracia = `now < impago_desde + 7 días` en `tenant_operativo`,
  `estadoEfectivoSuscripcion`, el aviso de Admin y `/suscripcion`.
- La RPC no cambia el inicio mientras siga `past_due` (reintentos,
  `unpaid`, duplicados, eventos fuera de orden o de un episodio anterior),
  lo borra en `active`/`canceled` y descarta fechas futuras. `unpaid` y
  `paused` nunca lo abren ni lo fijan; el status real de Stripe queda en
  `billing_eventos.detalle.estado_proveedor`.
- Sin fecha fiable → sin gracia (falla cerrado) hasta el siguiente evento
  que la traiga. Filas `past_due` existentes: no se rellenan (ver
  `docs/operations/BILLING.md`).
- El escenario 10 dejó de ser **PENDIENTE**: es una aserción obligatoria en
  las capas A, B, B2 y C-local, y en CI (`GF_BILLING_EXIGIR`) cualquier
  PENDIENTE cuenta como FAIL.
- La capa S lo **confirma contra Stripe real** cuando corra: P3 comprueba
  `impagoDesde = current_period_start ≤ fallo`, la frontera exacta de 7
  días y que un reintento no lo mueve; P6 lee `impago_desde` de staging y
  exige una gracia de 7 días desde el fallo. **Aún no ejecutado contra
  Stripe** (sin runner autorizado).

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
| `unpaid` | `past_due` sin fecha propia (`estado_proveedor = unpaid`) | conserva el inicio del episodio (gracia ya vencida tras los reintentos); sin episodio previo, bloqueado. Nunca abre ni extiende la gracia |
| `past_due` (sin acción) | `past_due` | ídem |

P3 falla si con el estado final el residencial sigue operativo.

## Automatización

| Qué | Dónde corre | Estado |
|---|---|---|
| Firma real de webhooks, normalización, regla de acceso con objetos simulados | Capa A (cada PR) | automatizado |
| Forma de TODAS las solicitudes a Stripe de la capa S (66), contra la especificación OpenAPI oficial | Job `stripe-mock` (cada PR) | automatizado |
| P1 configuración: endpoint del webhook de staging habilitado y suscrito a los 11 eventos; Customer Portal (cancelar al final del periodo, sin cambio de plan, actualizar tarjeta) | Capa S, workflow manual | automatizado, **no ejecutado aún** |
| P2 rechazo del pago inicial (API): `incomplete` → `incomplete_expired`, ignorado | Capa S | automatizado, no ejecutado |
| P3 renovación fallida con test clock: `past_due`, `impagoDesde` = inicio del periodo impago, frontera de 7 días, reintento sin cambio, recuperación con `invoices.pay`, reintentos hasta el estado final | Capa S | automatizado, no ejecutado |
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
     Checkout Sessions, Charges, Events, Webhook endpoints y Customer portal
     (lectura). Charges: para fechar el primer cobro fallido (H1).
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
5. **Gracia de `past_due`** (arriba): corregida en código; falta aplicar
   `20261009000000` en staging (plan en `docs/operations/BILLING.md`) y
   confirmarla con P3/P6 contra Stripe TEST real.

## Paso manual previo a P6 (staging, Stripe TEST)

1. Crear un residencial **sintético** (`ZZ_AUTOTEST_…` en el nombre y
   `observaciones = gf-autotest:<run>`) con el trial vencido.
2. Con su admin, pagar en el Checkout hospedado con `4242 4242 4242 4242`.
3. Confirmar en staging que quedó `active` y tomar su `provider_subscription_id`.
4. Ejecutar el workflow manual con `GF_STRIPE_SUSCRIPCION_SINTETICA=sub_…`
   (P6 se niega a tocar una suscripción que no sea de un residencial
   `ZZ_AUTOTEST_`).
