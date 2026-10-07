# Billing (V1: Stripe, México, MXN)

Estado: implementado y probado **solo en local**. Sin migraciones en
staging, sin claves, sin webhook ni productos creados en Stripe.

## Principio

`public.suscripciones` es la única fuente de operación. Stripe nunca
autoriza nada por sí mismo: solo un evento con firma verificada,
reconsultado a Stripe y aplicado por `billing_aplicar_evento` puede
cambiar `suscripciones.estado`. El navegador solo elige `planId`; la
URL de éxito no activa nada.

## Arquitectura

```
/suscripcion ── elegirPlanAction(planId) ─► lib/billing/checkout.ts (núcleo)
                  │  usuario + gf_tenant (leerAccesoAdmin) → autorizacion.ts
                  │  catálogo (catalogo.ts) → viviendas → RPC billing_crear_checkout
                  ▼
           BillingProvider (tipos.ts) ── StripeBillingProvider (proveedores/stripe.ts)
                  │  Checkout hospedado, modo subscription, client_reference_id = nuestro checkout
                  ▼
Stripe ── POST /api/billing/webhook/stripe ─► lib/billing/webhook.ts (núcleo)
                  firma (cuerpo crudo) → reconsulta → normaliza → RPC billing_aplicar_evento
```

- Núcleo (`checkout.ts`, `webhook.ts`, `autorizacion.ts`, `catalogo.ts`)
  sin Next, sin Supabase, sin SDK: dependencias inyectadas.
- `proveedores/stripe.ts`: única pieza que conoce el SDK `stripe`.
- `servidor.ts` (`server-only`): variables de entorno, cliente de
  servicio y cableado.
- Un proveedor nuevo (p. ej. Mercado Pago) = otra clase que implemente
  `BillingProvider` + su ruta `/api/billing/webhook/<proveedor>` + su
  valor en los CHECK de `provider`. El núcleo no cambia.

## Modelo de datos (`20261008100000_billing_base.sql`)

| Objeto | Para qué |
|---|---|
| `suscripciones.plan` | plan pagado (`hasta-50` / `hasta-150`) |
| `suscripciones.provider` | quién cobra (`stripe`) |
| `suscripciones.provider_customer_id` | portal de gestión; realta con el mismo cliente |
| `suscripciones.provider_subscription_id` | asocia eventos de renovación/fallo/cancelación; único por proveedor |
| `suscripciones.current_period_end` | fin del periodo vigente; base de la cancelación al final del periodo (**no** de la gracia: en una renovación fallida Stripe ya lo adelantó al periodo impago) |
| `suscripciones.impago_desde` | inicio del episodio de impago vigente (`20261009000000`): `current_period_start` del periodo impago; solo con `past_due` (check); base de la gracia |
| `suscripciones.cancel_at_period_end` | cancelación pedida, efectiva al final |
| `suscripciones.provider_version_at` | instante del último snapshot aplicado (descarta los viejos) |
| `billing_checkouts` | intento de pago creado por nuestro servidor (tenant, usuario, plan, moneda, monto en centavos, estado `created/completed/expired/canceled`) |
| `billing_eventos` | idempotencia `unique(provider, provider_event_id)` + resultado; sin payload ni datos personales |

Filas existentes: columnas nulas / `cancel_at_period_end = false`; los
trials y las altas manuales no cambian.

`20261009000000` **no rellena** `impago_desde`: no existe una fecha fiable
del inicio del impago en la base (`current_period_end` es justamente el
dato equivocado y `billing_eventos` no guarda payload). Una fila que ya
esté en `past_due` queda sin gracia (falla cerrado) hasta el siguiente
evento de Stripe, que trae `current_period_start` y la fija. La migración
avisa con un NOTICE cuántas filas `past_due` hay (staging: 0 en la última revisión; producción aún sin billing).

## Estados

| Estado | Operativo (`tenant_operativo`, `estadoEfectivoSuscripcion`) |
|---|---|
| `trialing` | mientras `now() < trial_ends_at` (sin cambios) |
| `active` | sí; con `cancel_at_period_end`, solo mientras `now() < current_period_end` |
| `past_due` | gracia: mientras `now() < impago_desde + 7 días`; sin `impago_desde` → no (falla cerrado) |
| `canceled`, `expired` | no |

Transiciones que aplica `billing_aplicar_evento`:

- trial vencido / `expired` / `canceled` → `active` (primer pago, con checkout nuestro y monto exacto);
- `active` → `active` (renovación; nuevo `current_period_end`);
- `active` → `past_due` (cobro fallido; abre el episodio: `impago_desde`) → `active` (recuperado; lo cierra: `impago_desde = null`);
- `past_due` → `past_due` (reintento fallido, `unpaid`, duplicado o evento fuera de orden): `impago_desde` **nunca avanza** (se conserva el más temprano); si faltaba, el primer evento con una fecha fiable lo fija;
- `past_due` → `canceled` (reintentos agotados, según la configuración de la cuenta): bloqueado, `impago_desde = null`;
- `active` + `cancel_at_period_end` (cancelación pedida) → `canceled` (fin del periodo);
- nunca vuelve a `trialing`; nunca toca `tenants.estado_servicio` (un residencial suspendido sigue suspendido aunque pague).

Durante el trial vigente **no se cobra** (la RPC rechaza el checkout).

## Webhook

`POST /api/billing/webhook/stripe` (fuera del middleware de sesión):

1. Firma `Stripe-Signature` sobre el **cuerpo crudo** con
   `STRIPE_WEBHOOK_SECRET`, ventana de 5 minutos. Inválida → 401, sin
   escrituras.
2. Se vuelve a consultar el recurso (sesión, suscripción o factura) y se
   normaliza el estado **actual**; la metadata de Stripe se ignora.
3. Asociación: la sesión de checkout de la suscripción →
   `billing_checkouts.provider_checkout_id` (nuestra fila) → tenant. Sin
   checkout nuestro: `provider_subscription_id` ya guardado. Ninguno →
   `sin_asociacion` (200, registrado, sin cambios).
4. `billing_aplicar_evento` en **una transacción**: registra el evento
   (si ya existía → `duplicado`, sin efectos) → `SELECT … FOR UPDATE` de
   la suscripción (serializa eventos concurrentes) → identidad de la
   suscripción → versión → monto/moneda/intervalo contra el checkout →
   transición → auditoría.
5. Error de red o de base → 500 (Stripe reintenta; el evento no quedó
   registrado).

Eventos a suscribir en el endpoint: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.expired`,
`customer.subscription.created|updated|deleted|paused|resumed`,
`invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`.

Resultados en `billing_eventos.resultado`: `aplicado`, `obsoleto`,
`ignorado`, `sin_asociacion`, `rechazado` (con `detalle.motivo`),
`suscripcion_duplicada`.

## Idempotencia y concurrencia

- Mismo evento dos veces (o a la vez): una sola fila; la segunda llamada
  espera al commit de la primera y devuelve `duplicado` (probado con dos
  sesiones reales en el runner).
- Snapshot más viejo que el aplicado → `obsoleto`.
- Un solo checkout abierto por residencial: crear otro cancela el
  anterior en la base y lo expira en Stripe.
- Dos pagos simultáneos: la primera suscripción queda; la segunda →
  `suscripcion_duplicada`, el servidor la **cancela en Stripe** y
  `provider_subscription_id` no se pisa. El primer cargo de la
  duplicada se reembolsa a mano (ver Recovery).

## Cancelación y gracia

- Cancelación: al final del periodo pagado (portal de Stripe con
  configuración propia). El acceso se corta en `current_period_end`
  aunque no llegue el webhook.
- Cobro fallido de una renovación: **exactamente 7 días de gracia desde
  el inicio del impago** (`impago_desde`). Admin muestra un banner
  fuerte con "Actualizar método de pago" y la fecha de fin de la gracia
  (también en `/suscripcion`); Guard opera normal. Después se bloquea
  igual que hoy. Detalle:
  - **Inicio del impago** = `current_period_start` del ítem de la
    suscripción cuando Stripe la reporta `past_due` (el inicio del periodo
    que no se pudo cobrar). No se usa la hora de recepción del webhook ni
    se inventa una fecha: si Stripe no la trae, `impago_desde` queda nulo
    y el residencial **no** tiene gracia hasta que un evento posterior la
    traiga. Una fecha posterior a la versión del evento + 5 min se
    descarta y queda en `billing_eventos.detalle.impago_desde_descartado`.
  - Reintentos, duplicados y eventos fuera de orden no reinician ni
    extienden el plazo; un pago exitoso (`active`) cierra el episodio y un
    impago posterior abre uno nuevo con su propio inicio.
  - Mapeo de estados finales de Stripe: `unpaid` → `past_due` con el mismo
    inicio (bloqueado al cumplirse los 7 días); `canceled` → `canceled`
    (bloqueado); `incomplete` / `incomplete_expired` (rechazo del **pago
    inicial**) → `ignorar`: nunca abre un impago.

## Variables (solo servidor; nunca `NEXT_PUBLIC_`)

| Variable | Valor |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` en staging |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` del endpoint |
| `STRIPE_PORTAL_CONFIGURATION_ID` | `bpc_…` (sin ella, "Administrar suscripción" lleva a soporte) |
| `STRIPE_PERMITIR_LIVE` | `true` solo en producción; sin ella una clave live deshabilita billing (en staging/preview, live nunca se acepta) |
| `NEXT_PUBLIC_ADMIN_APP_URL` | URL https de Admin (success/cancel/return); ya existente |

Sin `STRIPE_SECRET_KEY` o `STRIPE_WEBHOOK_SECRET`, `/suscripcion`
muestra "Pagos en línea no disponibles por ahora" y el webhook responde 503.

## Procedimiento test (staging)

1. Stripe en **modo test / sandbox**. Nada live (la app lo rechaza:
   `lib/billing/config.ts`).
2. Portal: la configuración propia (`bpc_…`) se crea por API desde
   Workbench → Shell (el Dashboard solo edita la configuración por
   defecto). Comando en la sección siguiente.
3. Webhook: Workbench → Webhooks → crear destino de eventos, **formato
   Snapshot** (no Thin: el handler espera `data.object.id`), destino
   "Webhook endpoint", URL `https://<admin-staging>/api/billing/webhook/stripe`,
   con los eventos de arriba. Copiar el signing secret (`whsec_…`).
4. Reintentos: Settings → Billing → Subscriptions and emails → Manage
   failed payments: reintentos que cubran ≥ 7 días; al agotarse,
   **cancelar** la suscripción.
5. Variables en Netlify (solo sitio Admin staging) como secretas.
6. Migraciones en staging, en orden y **antes** del deploy:
   `20261008100000_billing_base`, `20261008200000_tenant_operativo_billing`,
   `20261008300000_billing_evento_otro_tenant`,
   `20261009000000_billing_impago_desde` (cada una en una
   transacción con su registro en `schema_migrations`). El código nuevo
   lee `current_period_end`, `cancel_at_period_end` e `impago_desde` en
   todas las consultas de acceso (por eso `20261009000000` va antes del
   deploy; el parámetro nuevo de la RPC es opcional, así que el código
   anterior sigue funcionando mientras tanto).
7. Prueba con tarjetas de prueba de Stripe sobre un residencial
   sintético con trial vencido.

### Aplicar `20261009000000_billing_impago_desde` en staging (no aplicada)

Requiere autorización explícita; solo staging (`sfuckzzqejerrifuypby`).

1. Precheck (solo lectura): `select count(*) from suscripciones where
   estado = 'past_due'` (esperado 0; si no, esas filas quedan sin gracia
   hasta su próximo evento de Stripe), hash de `suscripciones` y la firma
   vigente de `billing_aplicar_evento` (14 argumentos) y su ACL.
2. Aplicar la migración en una transacción con su registro en
   `schema_migrations` (NOTICE con el conteo de `past_due`).
3. Desplegar Admin/Guard con el código que selecciona `impago_desde`
   **después** de la migración. Entre ambos pasos el código anterior
   llama la RPC sin `p_impago_desde` (opcional): un `past_due` nuevo en
   esa ventana queda sin gracia (falla cerrado) hasta el siguiente evento.
4. Verificar: una sola firma (15 argumentos) con EXECUTE solo para
   `service_role`; `tenant_operativo` con `impago_desde + 7 días`; check
   `suscripciones_impago_desde_check`; `tests/billing/staging/run-staging.sh`
   (opt-in, revertido) con 0 FAIL y hash igual; luego P3/P6 de la capa S
   cuando exista el runner.
5. Rollback: `supabase/rollback/20261009000000_billing_impago_desde.down.sql`
   tras revertir el código (el código nuevo selecciona la columna).

### Configuración del portal (Workbench → Shell, modo test)

```
stripe billing_portal configurations create \
  -d "business_profile[headline]=Gate Flow — administra tu suscripción" \
  -d "default_return_url=https://gateflow-admin-staging.netlify.app/suscripcion" \
  -d "features[payment_method_update][enabled]=true" \
  -d "features[invoice_history][enabled]=true" \
  -d "features[subscription_cancel][enabled]=true" \
  -d "features[subscription_cancel][mode]=at_period_end" \
  -d "features[subscription_cancel][proration_behavior]=none" \
  -d "features[subscription_update][enabled]=false" \
  -d "features[customer_update][enabled]=false"
```

El `id` de la respuesta (`bpc_…`) es `STRIPE_PORTAL_CONFIGURATION_ID`.

## Seguridad de claves

`lib/billing/config.ts` decide antes de crear el cliente de Stripe:
clave live (`sk_live_`/`rk_live_`) sin `STRIPE_PERMITIR_LIVE=true` →
billing deshabilitado; clave live en un host de staging, preview o local
→ deshabilitado aunque haya permiso. Nunca se registra el valor de una
clave.

## Precios

Montos MXN en `apps/admin/lib/billing/catalogo.ts`, **pendientes de
aprobación comercial** (`MONTOS_PENDIENTES_DE_APROBACION = true`).
Cambiar un precio solo afecta checkouts nuevos; las suscripciones
existentes conservan su precio (y la verificación de monto compara con
el checkout que las creó).

## Qué NO hacer a mano

- No cambiar `suscripciones.estado`/`provider*` por SQL para "activar"
  un pago: usar el flujo, o reenviar el evento desde Stripe.
- No borrar filas de `billing_eventos` (son la idempotencia).
- No crear suscripciones desde el dashboard de Stripe para un
  residencial: no tendrían checkout nuestro y no se asociarían.
- No cambiar precio/plan de una suscripción en Stripe: la activación o
  recuperación con otro monto se rechaza (`monto_no_coincide`).
- No usar la configuración por defecto del portal.

## Recovery

- Evento perdido o fallido: Stripe → Developers → Events → reenviar. Es
  idempotente; se reconsulta el estado actual.
- `sin_asociacion` / `rechazado`: revisar `billing_eventos.detalle`
  (motivo) y el checkout del residencial; corregir la causa y reenviar.
- `suscripcion_duplicada`: verificar en Stripe que la duplicada quedó
  cancelada y reembolsar su primer cargo.
- Residencial pagado pero bloqueado: comprobar `tenants.estado_servicio`
  (suspensión manual manda) y el último `billing_eventos` del tenant.

## Rollback

Orden inverso: `supabase/rollback/20261009000000_billing_impago_desde.down.sql`
(vuelve a la gracia desde `current_period_end` y borra `impago_desde`;
antes, revertir el código que la selecciona),
`supabase/rollback/20261008300000_billing_evento_otro_tenant.down.sql`,
`supabase/rollback/20261008200000_tenant_operativo_billing.down.sql`
y luego `supabase/rollback/20261008100000_billing_base.down.sql`
(verificados localmente: catálogo idéntico). Con cobros reales, el
rollback de `billing_base` borra la asociación con Stripe: exportar
antes `billing_checkouts`, `billing_eventos` y las columnas de proveedor.

## Pendientes antes de producción

- Aprobar los precios MXN (y si incluyen IVA); facturación CFDI fuera de alcance.
- Producción tiene grants amplios de anon/authenticated: alinear con
  staging antes del rollout (pendiente de la Fase 1).
- Lectura de campos sensibles en `tenants`/`suscripciones` por
  miembros (incluye `provider_customer_id`): revisar.
- Cuenta Stripe live, configuración de portal y endpoint live.
- Plan de upgrade cuando las viviendas superen el plan pagado (V1: aviso/soporte).
- Mercado Pago / Argentina.
