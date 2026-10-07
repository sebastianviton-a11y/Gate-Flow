import type { PlanBilling } from "./catalogo";

/**
 * Contrato entre el núcleo de billing (checkout.ts, webhook.ts) y cada
 * proveedor. El núcleo no sabe quién cobra; un proveedor nuevo (p. ej.
 * Mercado Pago) es otra implementación de BillingProvider y su ruta de
 * webhook, sin tocar el núcleo. V1: solo Stripe.
 */

export type ProveedorBillingId = "stripe";

export interface DatosCheckoutProveedor {
  /** Nuestro billing_checkouts.id: viaja como referencia del cliente. */
  checkoutId: string;
  /** Solo informativo en la metadata del proveedor; nunca es autoridad. */
  tenantId: string;
  plan: PlanBilling;
  emailPagador: string | null;
  /** Cliente ya existente en el proveedor (realta tras cancelar). */
  customerId: string | null;
  urlExito: string;
  urlCancelar: string;
  expiraEn: Date;
}

export interface CheckoutProveedor {
  providerCheckoutId: string;
  url: string;
}

/** Evento con la firma ya verificada. Solo id, tipo e id del objeto. */
export interface EventoVerificado {
  id: string;
  tipo: string;
  objetoId: string | null;
}

/** Estado que el servidor deriva del recurso consultado de nuevo al proveedor. */
export type EstadoNormalizado = "active" | "past_due" | "canceled" | "checkout_expirado" | "ignorar";

export interface EventoNormalizado {
  eventId: string;
  tipo: string;
  estado: EstadoNormalizado;
  providerCheckoutId: string | null;
  clientReferenceId: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /**
   * Solo con estado past_due y status real past_due: inicio del periodo
   * impago según el proveedor (Stripe: current_period_start del ítem;
   * hipótesis verificada por la capa S P3/P6). Base de los 7 días de
   * gracia; null si el proveedor no lo da o el status es unpaid/paused
   * (nunca abren gracia: falla cerrado).
   */
  impagoDesde: Date | null;
  /**
   * Status real del proveedor (Stripe: subscription.status, p. ej. unpaid
   * aunque se normalice a past_due); null si el evento no trae suscripción.
   */
  estadoProveedor: string | null;
  /** Instante en que se consultó al proveedor (ordena los snapshots). */
  versionAt: Date;
  moneda: string | null;
  /** Centavos. */
  monto: number | null;
  intervalo: string | null;
}

export interface BillingProvider {
  readonly id: ProveedorBillingId;
  crearCheckout(datos: DatosCheckoutProveedor): Promise<CheckoutProveedor>;
  expirarCheckout(providerCheckoutId: string): Promise<void>;
  /** null = firma inválida o fuera de la ventana de tiempo. */
  verificarWebhook(cuerpoCrudo: string, cabeceras: Headers): EventoVerificado | null;
  /** Vuelve a consultar al proveedor; nunca usa el payload del evento como verdad. */
  normalizarEvento(evento: EventoVerificado): Promise<EventoNormalizado>;
  /** Cancela de inmediato (suscripción duplicada). Idempotente. */
  cancelarSuscripcion(subscriptionId: string): Promise<void>;
  crearSesionGestion(customerId: string, urlRetorno: string): Promise<{ url: string }>;
}

/** Errores de billing_crear_checkout ("billing:<código>"). */
export type MotivoCheckout =
  | "plan"
  | "viviendas"
  | "contacto"
  | "rol"
  | "estado"
  | "suspendido"
  | "limite"
  | "proveedor"
  | "configuracion"
  | "error";

export function motivoDeErrorRpc(mensaje: string | null | undefined): MotivoCheckout {
  const codigo = /billing:([a-z_]+)/.exec(mensaje ?? "")?.[1];
  switch (codigo) {
    case "plan":
      return "plan";
    case "viviendas":
      return "viviendas";
    case "rol":
      return "rol";
    case "estado_no_permite":
    case "sin_suscripcion":
      return "estado";
    case "suspendido":
      return "suspendido";
    case "limite_intentos":
      return "limite";
    default:
      return "error";
  }
}
