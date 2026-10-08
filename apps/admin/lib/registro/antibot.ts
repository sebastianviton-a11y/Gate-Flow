/**
 * Desafío anti-bot de /registro: Cloudflare Turnstile (widget en el
 * formulario + verificación del token en el servidor).
 *
 *   TURNSTILE_SITE_KEY    clave pública del widget (la lee el servidor y
 *                         se la pasa al formulario).
 *   TURNSTILE_SECRET_KEY  clave secreta para siteverify.
 *
 * Entorno de clientes (cualquier host que no sea de pruebas, ver
 * lib/entorno.ts): las dos claves son obligatorias y NO pueden ser las
 * claves de prueba de Cloudflare (siempre aprueban). Si faltan o son de
 * prueba, /registro queda deshabilitado: nunca abierto sin desafío.
 * Entorno de pruebas (localhost, staging, previews): sin claves se omite
 * (y se avisa en el log); con claves —de prueba o reales— se exige.
 */
import { esEntornoDePruebas } from "../entorno";

export interface ResultadoAntibot {
  ok: boolean;
  proveedor: "ninguno" | "turnstile";
  motivo?: string;
}

export type ConfigAntibot =
  | { modo: "turnstile"; siteKey: string; secreto: string; dePrueba: boolean }
  | { modo: "omitido" }
  | { modo: "deshabilitado"; motivo: "sin_claves" | "claves_incompletas" | "claves_de_prueba_fuera_de_pruebas" };

/**
 * Claves de prueba documentadas por Cloudflare: "1x" (siempre aprueba),
 * "2x" (siempre rechaza), "3x" (fuerza desafío / token ya usado), con
 * relleno de ceros. https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export function esClaveDePruebaTurnstile(clave: string): boolean {
  return /^[0-9]x0{15,}[A-Z]{2}$/.test(clave.trim());
}

export function configuracionAntibot(entorno: Readonly<Record<string, string | undefined>>): ConfigAntibot {
  const siteKey = (entorno.TURNSTILE_SITE_KEY ?? "").trim();
  const secreto = (entorno.TURNSTILE_SECRET_KEY ?? "").trim();
  const pruebas = esEntornoDePruebas(entorno.NEXT_PUBLIC_ADMIN_APP_URL);
  if (!siteKey && !secreto) return pruebas ? { modo: "omitido" } : { modo: "deshabilitado", motivo: "sin_claves" };
  if (!siteKey || !secreto) return { modo: "deshabilitado", motivo: "claves_incompletas" };
  const dePrueba = esClaveDePruebaTurnstile(siteKey) || esClaveDePruebaTurnstile(secreto);
  if (dePrueba && !pruebas) return { modo: "deshabilitado", motivo: "claves_de_prueba_fuera_de_pruebas" };
  return { modo: "turnstile", siteKey, secreto, dePrueba };
}

interface OpcionesAntibot {
  secreto?: string;
  ip?: string | null;
  fetchFn?: typeof fetch;
}

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verificarDesafio(token: string | null, opciones: OpcionesAntibot = {}): Promise<ResultadoAntibot> {
  const secreto = opciones.secreto?.trim();
  if (!secreto) {
    return { ok: true, proveedor: "ninguno" };
  }
  if (!token || token.length > 2048) {
    return { ok: false, proveedor: "turnstile", motivo: "sin_token" };
  }

  const cuerpo = new URLSearchParams({ secret: secreto, response: token });
  if (opciones.ip) cuerpo.set("remoteip", opciones.ip);

  try {
    const fetchFn = opciones.fetchFn ?? fetch;
    const respuesta = await fetchFn(TURNSTILE_VERIFY_URL, { method: "POST", body: cuerpo, cache: "no-store" });
    const datos = (await respuesta.json()) as { success?: boolean; "error-codes"?: string[] };
    return datos.success === true
      ? { ok: true, proveedor: "turnstile" }
      : { ok: false, proveedor: "turnstile", motivo: (datos["error-codes"] ?? []).join(",") || "rechazado" };
  } catch {
    // Falla cerrado: si el verificador no responde, no se registra.
    return { ok: false, proveedor: "turnstile", motivo: "verificador_no_disponible" };
  }
}
