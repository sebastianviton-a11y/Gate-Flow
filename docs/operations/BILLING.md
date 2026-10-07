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
| `suscripciones.current_period_end` | fin del periodo pagado; base de la gracia y de la cancelación |
| `suscripciones.cancel_at_period_end` | cancelación pedida, efectiva al final |
| `suscripciones.provider_version_at` | instante del último snapshot aplicado (descarta los viejos) |
| `billing_checkouts` | intento de pago creado por nuestro servidor (tenant, usuario, plan, moneda, monto en centavos, estado `created/completed/expired/canceled`) |
| `billing_eventos` | idempotencia `unique(provider, provider_event_id)` + resultado; sin payload ni datos personales |

Filas existentes: columnas nulas / `cancel_at_period_end = false`; los
trials y las altas manuales no cambian.

## Estados

| Estado | Operativo (`tenant_operativo`, `estadoEfectivoSuscripcion`) |
|---|---|
| `trialing` | mientras `now() < trial_ends_at` (sin cambios) |
| `active` | sí; con `cancel_at_period_end`, solo mientras `now() < current_period_end` |
| `past_due` | gracia: mientras `now() < current_period_end + 7 días` |
| `canceled`, `expired` | no |

Transiciones que aplica `billing_aplicar_evento`:

- trial vencido / `expired` / `canceled` → `active` (primer pago, con checkout nuestro y monto exacto);
- `active` → `active` (renovación; nuevo `current_period_end`);
- `active` → `past_due` (cobro fallido) → `active` (recuperado);
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
- Cobro fallido: 7 días de gracia desde `current_period_end`. Admin
  muestra un banner fuerte con "Actualizar método de pago"; Guard opera
  normal. Después se bloquea igual que hoy.

## Variables (solo servidor; nunca `NEXT_PUBLIC_`)

| Variable | Valor |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` en staging |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` del endpoint |
| `STRIPE_PORTAL_CONFIGURATION_ID` | `bpc_…` (sin ella, "Administrar suscripción" lleva a soporte) |
| `STRIPE_PERMITIR_LIVE` | `true` solo en producción; sin ella una clave live deshabilita billing |
| `NEXT_PUBLIC_ADMIN_APP_URL` | URL https de Admin (success/cancel/return); ya existente |

Sin `STRIPE_SECRET_KEY` o `STRIPE_WEBHOOK_SECRET`, `/suscripcion`
muestra "Pagos en línea no disponibles por ahora" y el webhook responde 503.

## Procedimiento test (staging)

1. Stripe en **modo test**. Nada live.
2. Portal: Settings → Billing → Customer portal → crear una
   configuración con: actualizar método de pago ON; cancelar
   suscripción ON, modo **al final del periodo**; cambiar de plan OFF;
   pausar OFF. Copiar su id `bpc_…`.
3. Endpoint: Developers → Webhooks → `https://<admin-staging>/api/billing/webhook/stripe`
   con los eventos de arriba; copiar el signing secret.
4. Reintentos de cobro (Settings → Billing → Subscriptions): reintentos
   que cubran al menos 7 días; al agotarse, **cancelar** la suscripción.
5. Variables en Netlify (sitio Admin staging) como secretas.
6. Migraciones en staging, en orden: `20261008100000_billing_base`,
   `20261008200000_tenant_operativo_billing` (cada una en una
   transacción con su registro en `schema_migrations`). **Antes** del
   deploy: el código nuevo lee `current_period_end` y
   `cancel_at_period_end` en todas las consultas de acceso.
7. Prueba con tarjetas de prueba de Stripe sobre un residencial
   sintético con trial vencido.

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

Orden inverso: `supabase/rollback/20261008200000_tenant_operativo_billing.down.sql`
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
