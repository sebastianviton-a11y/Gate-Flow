/**
 * Validación de la configuración de Stripe ANTES de crear el cliente.
 * Pura (sin process.env ni server-only) para poder probarla. Si no es
 * válida, billing no se inicializa: /suscripcion muestra "Pagos en línea
 * no disponibles" y el webhook responde 503. Nunca devuelve ni registra
 * el valor de una clave.
 *
 *   - sin clave o sin webhook secret        → deshabilitado
 *   - clave con formato desconocido         → deshabilitado
 *   - clave live (sk_live_/rk_live_) sin
 *     STRIPE_PERMITIR_LIVE=true             → deshabilitado
 *   - clave live en un host de staging,
 *     preview o local (aunque haya permiso) → deshabilitado
 */

export type MotivoConfigStripe = "sin_clave" | "sin_webhook_secret" | "clave_invalida" | "live_no_permitido" | "live_en_staging";

export type ConfigStripe =
  | { ok: true; clave: string; webhookSecret: string; portalConfiguracionId: string | null; modo: "test" | "live" }
  | { ok: false; motivo: MotivoConfigStripe };

/** process.env o un objeto equivalente (tests). Variables usadas:
 * STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PORTAL_CONFIGURATION_ID,
 * STRIPE_PERMITIR_LIVE, NEXT_PUBLIC_ADMIN_APP_URL. */
export type EntornoStripe = Readonly<Record<string, string | undefined>>;

/** Hosts donde Stripe live nunca se permite. */
export function esEntornoNoProductivo(urlAdmin: string | undefined): boolean {
  let host: string;
  try {
    host = new URL(urlAdmin ?? "").hostname.toLowerCase();
  } catch {
    // Sin URL válida no se puede saber dónde corre: se trata como no productivo.
    return true;
  }
  return /staging|deploy-preview|preview|localhost|127\.0\.0\.1/.test(host) || /--/.test(host);
}

export function configuracionStripe(entorno: EntornoStripe): ConfigStripe {
  const clave = (entorno.STRIPE_SECRET_KEY ?? "").trim();
  const webhookSecret = (entorno.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!clave) return { ok: false, motivo: "sin_clave" };
  if (!webhookSecret) return { ok: false, motivo: "sin_webhook_secret" };
  const modo = /^(sk|rk)_live_/.test(clave) ? "live" : /^(sk|rk)_test_/.test(clave) ? "test" : null;
  if (!modo) return { ok: false, motivo: "clave_invalida" };
  if (modo === "live") {
    if (entorno.STRIPE_PERMITIR_LIVE !== "true") return { ok: false, motivo: "live_no_permitido" };
    if (esEntornoNoProductivo(entorno.NEXT_PUBLIC_ADMIN_APP_URL)) return { ok: false, motivo: "live_en_staging" };
  }
  return { ok: true, clave, webhookSecret, portalConfiguracionId: entorno.STRIPE_PORTAL_CONFIGURATION_ID?.trim() || null, modo };
}
