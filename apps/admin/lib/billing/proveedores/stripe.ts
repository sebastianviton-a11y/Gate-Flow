import Stripe from "stripe";
import type {
  BillingProvider,
  CheckoutProveedor,
  DatosCheckoutProveedor,
  EstadoNormalizado,
  EventoNormalizado,
  EventoVerificado,
} from "../tipos";

/**
 * Adaptador Stripe (V1, México). Única pieza que conoce el SDK.
 *   - Checkout hospedado en modo subscription, precio inline (price_data)
 *     con el monto del catálogo: no hace falta crear productos/precios.
 *   - Nuestro checkout_id viaja como client_reference_id; la metadata es
 *     solo informativa (la autoridad es billing_checkouts).
 *   - Webhook: firma con STRIPE_WEBHOOK_SECRET sobre el cuerpo crudo y
 *     ventana de 5 minutos; después se vuelve a consultar el recurso
 *     (sesión, suscripción o factura) y se normaliza su estado actual,
 *     así el orden de llegada de los eventos no importa.
 */

/** Subconjunto del cliente que usa el adaptador (los tests lo reemplazan). */
export interface ClienteStripe {
  checkout: { sessions: Pick<Stripe["checkout"]["sessions"], "create" | "retrieve" | "list" | "expire"> };
  subscriptions: Pick<Stripe["subscriptions"], "retrieve" | "cancel">;
  invoices: Pick<Stripe["invoices"], "retrieve">;
  billingPortal: { sessions: Pick<Stripe["billingPortal"]["sessions"], "create"> };
}

/** Tolerancia de la firma (segundos): fuera de ella, el evento se rechaza. */
export const TOLERANCIA_FIRMA_SEGUNDOS = 300;

const EVENTOS_SESION = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"]);
const EVENTOS_SUSCRIPCION = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);
const EVENTOS_FACTURA = new Set(["invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed"]);

/** Eventos que hay que suscribir en el endpoint de Stripe (docs/operations/BILLING.md). */
export const EVENTOS_STRIPE = [...EVENTOS_SESION, ...EVENTOS_SUSCRIPCION, ...EVENTOS_FACTURA];

function idDe(valor: string | { id: string } | null | undefined): string | null {
  if (!valor) return null;
  return typeof valor === "string" ? valor : valor.id;
}

/**
 * Estado de Stripe → nuestro. Nada que no esté pagado activa:
 * incomplete / incomplete_expired / trialing se ignoran (no usamos
 * trials de Stripe: el trial de 30 días es nuestro y ya terminó; un
 * rechazo del PAGO INICIAL deja la suscripción incomplete → ignorada).
 * unpaid (reintentos agotados) y paused siguen siendo un impago: past_due,
 * pero NUNCA abren ni extienden la gracia (impagoDesde null; si ya había un
 * episodio, la base conserva su inicio). El status real viaja aparte
 * (estadoProveedor) y queda en el detalle del evento.
 */
export function estadoDeSuscripcionStripe(status: string): EstadoNormalizado {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
      return "canceled";
    default:
      return "ignorar";
  }
}

export class StripeBillingProvider implements BillingProvider {
  readonly id = "stripe" as const;

  constructor(
    private readonly cliente: ClienteStripe,
    private readonly webhookSecret: string,
    private readonly portalConfiguracionId: string | null,
  ) {}

  async crearCheckout(datos: DatosCheckoutProveedor): Promise<CheckoutProveedor> {
    const sesion = await this.cliente.checkout.sessions.create(
      {
        mode: "subscription",
        client_reference_id: datos.checkoutId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: datos.plan.moneda.toLowerCase(),
              unit_amount: datos.plan.monto,
              recurring: { interval: "month", interval_count: 1 },
              product_data: { name: `Gate Flow · ${datos.plan.nombre}` },
            },
          },
        ],
        ...(datos.customerId ? { customer: datos.customerId } : datos.emailPagador ? { customer_email: datos.emailPagador } : {}),
        // Informativo; nunca autoridad.
        metadata: { checkout_id: datos.checkoutId, tenant_id: datos.tenantId, plan: datos.plan.id },
        subscription_data: { metadata: { checkout_id: datos.checkoutId, tenant_id: datos.tenantId, plan: datos.plan.id } },
        success_url: datos.urlExito,
        cancel_url: datos.urlCancelar,
        expires_at: Math.floor(datos.expiraEn.getTime() / 1000),
        locale: "es-419",
        allow_promotion_codes: false,
      },
      // Doble clic / reintento de la acción: la misma sesión.
      { idempotencyKey: `checkout-${datos.checkoutId}` },
    );
    if (!sesion.url) throw new Error("Stripe no devolvió URL de checkout");
    return { providerCheckoutId: sesion.id, url: sesion.url };
  }

  async expirarCheckout(providerCheckoutId: string): Promise<void> {
    const sesion = await this.cliente.checkout.sessions.retrieve(providerCheckoutId);
    if (sesion.status === "open") await this.cliente.checkout.sessions.expire(providerCheckoutId);
  }

  verificarWebhook(cuerpoCrudo: string, cabeceras: Headers): EventoVerificado | null {
    const firma = cabeceras.get("stripe-signature");
    if (!firma || !this.webhookSecret) return null;
    try {
      const evento = Stripe.webhooks.constructEvent(cuerpoCrudo, firma, this.webhookSecret, TOLERANCIA_FIRMA_SEGUNDOS);
      const objeto = (evento.data?.object ?? null) as { id?: unknown } | null;
      return { id: evento.id, tipo: evento.type, objetoId: typeof objeto?.id === "string" ? objeto.id : null };
    } catch {
      return null;
    }
  }

  async normalizarEvento(evento: EventoVerificado): Promise<EventoNormalizado> {
    // La versión es el instante de la consulta: un snapshot posterior
    // siempre gana a uno anterior, sin importar el orden de los eventos.
    const versionAt = new Date();
    const base: EventoNormalizado = {
      eventId: evento.id,
      tipo: evento.tipo,
      estado: "ignorar",
      providerCheckoutId: null,
      clientReferenceId: null,
      subscriptionId: null,
      customerId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      impagoDesde: null,
      estadoProveedor: null,
      versionAt,
      moneda: null,
      monto: null,
      intervalo: null,
    };
    if (!evento.objetoId) return base;

    if (EVENTOS_SESION.has(evento.tipo)) {
      const sesion = await this.cliente.checkout.sessions.retrieve(evento.objetoId);
      const conSesion = { ...base, providerCheckoutId: sesion.id, clientReferenceId: sesion.client_reference_id ?? null };
      if (evento.tipo === "checkout.session.expired") return { ...conSesion, estado: "checkout_expirado" };
      const subscriptionId = idDe(sesion.subscription as string | { id: string } | null);
      if (sesion.mode !== "subscription" || sesion.status !== "complete" || sesion.payment_status !== "paid" || !subscriptionId) {
        return conSesion;
      }
      return this.desdeSuscripcion(conSesion, subscriptionId, sesion);
    }

    let subscriptionId: string | null = null;
    if (EVENTOS_SUSCRIPCION.has(evento.tipo)) {
      subscriptionId = evento.objetoId;
    } else if (EVENTOS_FACTURA.has(evento.tipo)) {
      const factura = await this.cliente.invoices.retrieve(evento.objetoId);
      subscriptionId = idDe(factura.parent?.subscription_details?.subscription as string | { id: string } | null | undefined);
    }
    if (!subscriptionId) return base;

    // Asociación con NUESTRO checkout: la sesión que creó la suscripción.
    const sesiones = await this.cliente.checkout.sessions.list({ subscription: subscriptionId, limit: 1 });
    const sesion = sesiones.data[0] ?? null;
    return this.desdeSuscripcion(
      { ...base, providerCheckoutId: sesion?.id ?? null, clientReferenceId: sesion?.client_reference_id ?? null },
      subscriptionId,
      sesion,
    );
  }

  private async desdeSuscripcion(
    base: EventoNormalizado,
    subscriptionId: string,
    sesion: Stripe.Checkout.Session | null,
  ): Promise<EventoNormalizado> {
    const suscripcion = await this.cliente.subscriptions.retrieve(subscriptionId);
    const items = suscripcion.items?.data ?? [];
    const item = items.length === 1 ? items[0] : undefined;
    const precio = item?.price;
    const intervalo = precio?.recurring && precio.recurring.interval_count === 1 ? precio.recurring.interval : null;
    // Fin del periodo vigente; con cancelación programada (cancel_at), lo
    // que llegue antes. Ojo: tras una renovación fallida Stripe ya avanzó el
    // periodo, así que en past_due esto es el FIN del periodo impago.
    const finPeriodo = item?.current_period_end ?? null;
    const finEfectivo = suscripcion.cancel_at && finPeriodo ? Math.min(suscripcion.cancel_at, finPeriodo) : finPeriodo;
    const estado = estadoDeSuscripcionStripe(suscripcion.status);
    // Inicio del impago: el inicio del periodo que no se pudo cobrar. Lo
    // fija Stripe (no la hora de recepción) y no cambia con los reintentos.
    // Hipótesis (tests/billing/STRIPE.md, verificada por P3/P6): la factura
    // impaga se crea en ese instante y su primer cobro es posterior. Solo
    // con status past_due: unpaid/paused nunca abren gracia.
    const inicioPeriodo = item?.current_period_start ?? null;
    return {
      ...base,
      estado,
      subscriptionId: suscripcion.id,
      customerId: idDe(suscripcion.customer as string | { id: string } | null) ?? idDe(sesion?.customer as string | { id: string } | null),
      currentPeriodEnd: finEfectivo ? new Date(finEfectivo * 1000) : null,
      cancelAtPeriodEnd: suscripcion.status === "active" && (suscripcion.cancel_at_period_end || suscripcion.cancel_at !== null),
      impagoDesde: suscripcion.status === "past_due" && inicioPeriodo ? new Date(inicioPeriodo * 1000) : null,
      estadoProveedor: suscripcion.status,
      // Una sola línea con cantidad 1; si no, el monto no se puede
      // comparar con el checkout y la activación se rechaza.
      moneda: precio?.currency ? precio.currency.toUpperCase() : null,
      monto: item && precio?.unit_amount != null && (item.quantity ?? 1) === 1 ? precio.unit_amount : null,
      intervalo,
    };
  }

  async cancelarSuscripcion(subscriptionId: string): Promise<void> {
    const actual = await this.cliente.subscriptions.retrieve(subscriptionId);
    if (actual.status === "canceled" || actual.status === "incomplete_expired") return;
    await this.cliente.subscriptions.cancel(subscriptionId, { prorate: false, invoice_now: false });
  }

  async crearSesionGestion(customerId: string, urlRetorno: string): Promise<{ url: string }> {
    if (!this.portalConfiguracionId) throw new Error("Portal de Stripe sin configurar");
    const sesion = await this.cliente.billingPortal.sessions.create({
      customer: customerId,
      return_url: urlRetorno,
      // Configuración propia: cancelar al final del periodo, sin cambio de plan.
      configuration: this.portalConfiguracionId,
      locale: "es-419",
    });
    return { url: sesion.url };
  }
}
