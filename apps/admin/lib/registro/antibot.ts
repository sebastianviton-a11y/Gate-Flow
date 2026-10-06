/**
 * Desafío anti-bot de /registro. Preparado para Cloudflare Turnstile:
 * con TURNSTILE_SECRET_KEY configurada se exige y verifica el token;
 * sin ella (staging hoy) se deja pasar y se avisa en el log. Antes de
 * producción la clave debe existir (ver docs/operations/REGISTRO_TRIAL.md).
 */

export interface ResultadoAntibot {
  ok: boolean;
  proveedor: "ninguno" | "turnstile";
  motivo?: string;
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
    const respuesta = await fetchFn(TURNSTILE_VERIFY_URL, { method: "POST", body: cuerpo });
    const datos = (await respuesta.json()) as { success?: boolean; "error-codes"?: string[] };
    return datos.success
      ? { ok: true, proveedor: "turnstile" }
      : { ok: false, proveedor: "turnstile", motivo: (datos["error-codes"] ?? []).join(",") || "rechazado" };
  } catch {
    // Falla cerrado: si el verificador no responde, no se registra.
    return { ok: false, proveedor: "turnstile", motivo: "verificador_no_disponible" };
  }
}
