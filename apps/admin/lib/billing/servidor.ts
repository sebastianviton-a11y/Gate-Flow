import "server-only";
import Stripe from "stripe";
import { createServerSupabaseClient, createServiceRoleClient } from "@gateflow/supabase";
import { iniciarCheckout, type ResultadoCheckout } from "./checkout";
import { configuracionStripe } from "./config";
import { StripeBillingProvider } from "./proveedores/stripe";
import { procesarWebhook, type ResultadoAplicar, type RespuestaWebhook } from "./webhook";
import type { EventoNormalizado } from "./tipos";

/**
 * Cableado de billing en el servidor de Admin: variables de entorno,
 * cliente de servicio (solo RPC de billing) y proveedor. Nada de esto
 * llega al navegador: las claves no llevan prefijo NEXT_PUBLIC_.
 *
 *   STRIPE_SECRET_KEY                 sk_test_… (live solo con
 *                                     STRIPE_PERMITIR_LIVE=true y nunca
 *                                     en staging/preview: config.ts)
 *   STRIPE_WEBHOOK_SECRET             whsec_… del endpoint
 *   STRIPE_PORTAL_CONFIGURATION_ID    bpc_… (portal: cancelar al final
 *                                     del periodo, sin cambio de plan)
 */

/** Versión de API fijada (la del SDK instalado). */
export const STRIPE_API_VERSION = "2026-09-30.endive" as const;

function log(mensaje: string, datos: Record<string, unknown>) {
  // Solo ids, tipos y resultados: nunca email, tarjeta ni payload.
  console.info(`[GateFlow] ${mensaje}`, datos);
}

/**
 * null si Stripe no está configurado o la configuración no es segura
 * (lib/billing/config.ts: clave live sin STRIPE_PERMITIR_LIVE=true, o
 * live en staging/preview). Nunca registra el valor de una clave.
 */
export function proveedorStripe(): StripeBillingProvider | null {
  const config = configuracionStripe(process.env);
  if (!config.ok) {
    if (config.motivo !== "sin_clave" && config.motivo !== "sin_webhook_secret") {
      console.error(`[GateFlow] billing deshabilitado: configuración de Stripe rechazada (${config.motivo}).`);
    }
    return null;
  }
  const cliente = new Stripe(config.clave, {
    apiVersion: STRIPE_API_VERSION,
    // El webhook hace 2–3 consultas: deben caber en el límite de una
    // función de Netlify. Si algo falla → 500 y Stripe reintenta.
    maxNetworkRetries: 1,
    timeout: 8_000,
    appInfo: { name: "Gate Flow" },
  });
  return new StripeBillingProvider(cliente, config.webhookSecret, config.portalConfiguracionId);
}

/** tenants.pais con la sesión del usuario (RLS: solo un residencial al que pertenece). */
export async function paisDeTenantServidor(tenantId: string): Promise<string | null> {
  const { data } = await createServerSupabaseClient().from("tenants").select("pais").eq("id", tenantId).maybeSingle();
  return (data as { pais: string | null } | null)?.pais ?? null;
}

/** URL pública de Admin para success/cancel/return: de configuración, nunca del Host. */
export function urlBaseAdmin(): string | null {
  const url = (process.env.NEXT_PUBLIC_ADMIN_APP_URL ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^/\s]+$/.test(url) || /^http:\/\/localhost(:\d+)?$/.test(url) ? url : null;
}

export async function iniciarCheckoutServidor(entrada: {
  userId: string;
  tenantId: string;
  planId: unknown;
  emailPagador: string | null;
}): Promise<ResultadoCheckout> {
  const proveedor = proveedorStripe();
  const urlBase = urlBaseAdmin();
  if (!proveedor || !urlBase) return { ok: false, motivo: "configuracion" };

  // Lecturas con la sesión del usuario (RLS: solo su residencial).
  const sesion = createServerSupabaseClient();
  const servicio = createServiceRoleClient();

  return iniciarCheckout(
    {
      proveedor,
      urlBase,
      log,
      paisDelTenant: (tenantId) => paisDeTenantServidor(tenantId),
      async contarViviendas(tenantId) {
        const [{ data: s }, { count }] = await Promise.all([
          sesion.from("suscripciones").select("viviendas_declaradas").eq("tenant_id", tenantId).maybeSingle(),
          sesion.from("unidades").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("activo", true),
        ]);
        return { declaradas: (s as { viviendas_declaradas: number | null } | null)?.viviendas_declaradas ?? null, unidadesActivas: count ?? 0 };
      },
      async crearCheckoutEnBase({ userId, tenantId, plan, expiraEn }) {
        const { data, error } = await servicio.rpc("billing_crear_checkout", {
          p_user_id: userId,
          p_tenant_id: tenantId,
          p_plan: plan.id,
          p_provider: proveedor.id,
          p_moneda: plan.moneda,
          p_monto: plan.monto,
          p_expires_at: expiraEn.toISOString(),
        });
        if (error) throw new Error(error.message);
        const r = data as { checkout_id: string; anteriores: string[] | null };
        return { checkoutId: r.checkout_id, anteriores: r.anteriores ?? [] };
      },
      async registrarCheckoutProveedor(checkoutId, providerCheckoutId) {
        const { error } = await servicio.rpc("billing_registrar_checkout_proveedor", {
          p_checkout_id: checkoutId,
          p_provider_checkout_id: providerCheckoutId,
        });
        if (error) throw new Error(error.message);
      },
      async clienteExistente(tenantId) {
        const { data } = await sesion.from("suscripciones").select("provider, provider_customer_id").eq("tenant_id", tenantId).maybeSingle();
        const fila = data as { provider: string | null; provider_customer_id: string | null } | null;
        return fila?.provider === proveedor.id ? fila.provider_customer_id : null;
      },
    },
    entrada,
  );
}

export async function aplicarEventoEnBase(evento: EventoNormalizado, provider: string): Promise<ResultadoAplicar> {
  const { data, error } = await createServiceRoleClient().rpc("billing_aplicar_evento", {
    p_provider: provider,
    p_event_id: evento.eventId,
    p_tipo: evento.tipo,
    p_estado: evento.estado,
    p_provider_checkout_id: evento.providerCheckoutId,
    p_client_reference_id: evento.clientReferenceId,
    p_subscription_id: evento.subscriptionId,
    p_customer_id: evento.customerId,
    p_current_period_end: evento.currentPeriodEnd?.toISOString() ?? null,
    p_cancel_at_period_end: evento.cancelAtPeriodEnd,
    p_version_at: evento.versionAt.toISOString(),
    p_moneda: evento.moneda,
    p_monto: evento.monto,
    p_intervalo: evento.intervalo,
    p_impago_desde: evento.impagoDesde?.toISOString() ?? null,
    p_estado_proveedor: evento.estadoProveedor,
  });
  if (error) throw new Error(error.message);
  return data as ResultadoAplicar;
}

export async function procesarWebhookStripe(cuerpoCrudo: string, cabeceras: Headers): Promise<RespuestaWebhook> {
  const proveedor = proveedorStripe();
  if (!proveedor) return { status: 503, body: JSON.stringify({ error: "no_configurado" }) };
  return procesarWebhook({ proveedor, log, aplicarEvento: (e) => aplicarEventoEnBase(e, proveedor.id) }, cuerpoCrudo, cabeceras);
}

/** Portal del proveedor para el cliente del residencial (tarjeta, cancelar al final). */
export async function urlGestionServidor(tenantId: string): Promise<string | null> {
  const proveedor = proveedorStripe();
  const urlBase = urlBaseAdmin();
  if (!proveedor || !urlBase) return null;
  const { data } = await createServerSupabaseClient()
    .from("suscripciones")
    .select("provider, provider_customer_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const fila = data as { provider: string | null; provider_customer_id: string | null } | null;
  if (fila?.provider !== proveedor.id || !fila.provider_customer_id) return null;
  try {
    return (await proveedor.crearSesionGestion(fila.provider_customer_id, `${urlBase}/suscripcion`)).url;
  } catch {
    log("billing.portal_fallo", { tenant_id: tenantId });
    return null;
  }
}

/** Hay proveedor y URL pública configurados: se puede ofrecer el checkout. */
export function checkoutDisponible(): boolean {
  return Boolean(proveedorStripe() && urlBaseAdmin());
}

export function gestionDisponible(): boolean {
  const config = configuracionStripe(process.env);
  return config.ok && Boolean(config.portalConfiguracionId);
}
