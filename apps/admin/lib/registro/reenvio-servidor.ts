import { createHash } from "node:crypto";
import { ESPERA_REENVIO_MS, resultadoReenvio, type ResultadoReenvio } from "./reenvio";
import { correoValido, normalizarEmail } from "./validacion";

/**
 * Lógica del reenvío del correo de confirmación (acción de /login), sin
 * Next ni Supabase: lo externo entra por `DepsReenvio`, así se prueba
 * con dobles.
 *
 * Solo reenvía la verificación de un usuario que YA existe (Supabase
 * auth.resend type "signup", el mismo envío que usa /registro). No crea
 * usuarios, residenciales ni suscripciones, no usa la clave de servicio
 * y no devuelve tokens: Supabase genera un enlace nuevo (el anterior
 * deja de servir) y lo manda por correo.
 *
 * Sin enumeración: la respuesta es la misma para un correo pendiente,
 * uno ya confirmado o uno que no existe (Supabase responde igual a los
 * tres), y el límite de la app se aplica antes de llamar a Supabase y
 * por igual a cualquier correo.
 */

export interface DepsReenvio {
  /** URL pública de este Admin (urlPublicaAdmin); null → no se envía nada. */
  urlAdmin: string | null;
  enviar(email: string, redirectTo: string): Promise<{ ok: true } | { ok: false; estado?: number; codigo?: string }>;
  /** Límite propio de la app (por correo y por IP). */
  permitido(email: string): boolean;
  /** Solo eventos y códigos: nunca el correo, la IP ni tokens. */
  log(evento: string, datos?: Record<string, string | number | undefined>): void;
}

export async function ejecutarReenvio(deps: DepsReenvio, emailCrudo: unknown): Promise<ResultadoReenvio> {
  const email = typeof emailCrudo === "string" ? normalizarEmail(emailCrudo) : "";
  if (!correoValido(email)) {
    deps.log("reenvio_confirmacion.correo_invalido");
    return resultadoReenvio("error");
  }
  if (!deps.urlAdmin) {
    deps.log("reenvio_confirmacion.sin_url_admin");
    return resultadoReenvio("error");
  }
  if (!deps.permitido(email)) {
    deps.log("reenvio_confirmacion.limite_app");
    return resultadoReenvio("espera");
  }

  let r: Awaited<ReturnType<DepsReenvio["enviar"]>>;
  try {
    // El destino lo fija el servidor; el navegador solo manda el correo.
    r = await deps.enviar(email, `${deps.urlAdmin}/confirmar-cuenta`);
  } catch {
    deps.log("reenvio_confirmacion.excepcion");
    return resultadoReenvio("error");
  }
  if (r.ok) {
    deps.log("reenvio_confirmacion.solicitado");
    return resultadoReenvio("enviado");
  }
  if (r.estado === 429 || /rate_limit/.test(r.codigo ?? "")) {
    deps.log("reenvio_confirmacion.limite_supabase", { estado: r.estado, codigo: r.codigo });
    return resultadoReenvio("espera");
  }
  deps.log("reenvio_confirmacion.fallo", { estado: r.estado, codigo: r.codigo });
  return resultadoReenvio("error");
}

function huella(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

/**
 * Límite en memoria del servidor: un reenvío por correo cada
 * ESPERA_REENVIO_MS y como mucho `maxPorIp` por IP en `ventanaIpMs`.
 * Guarda solo huellas (sha256), nunca el correo ni la IP. Es por
 * instancia del servidor: el límite persistente es el de Supabase (por
 * usuario y por proyecto); este frena clics y scripts sobre una misma
 * instancia sin escribir en la base.
 */
export class LimitadorReenvio {
  private readonly ultimoPorCorreo = new Map<string, number>();
  private readonly porIp = new Map<string, number[]>();

  constructor(
    private readonly ahora: () => number = Date.now,
    private readonly opciones = { esperaPorCorreoMs: ESPERA_REENVIO_MS, maxPorIp: 10, ventanaIpMs: 10 * 60_000, maxClaves: 5_000 },
  ) {}

  permitir(email: string, ip: string | null): boolean {
    const t = this.ahora();
    this.podar(t);
    const claveCorreo = huella(`correo:${email}`);
    const ultimo = this.ultimoPorCorreo.get(claveCorreo);
    if (ultimo !== undefined && t - ultimo < this.opciones.esperaPorCorreoMs) return false;
    if (ip) {
      const claveIp = huella(`ip:${ip}`);
      const recientes = (this.porIp.get(claveIp) ?? []).filter((x) => t - x < this.opciones.ventanaIpMs);
      if (recientes.length >= this.opciones.maxPorIp) return false;
      recientes.push(t);
      this.porIp.set(claveIp, recientes);
    }
    this.ultimoPorCorreo.set(claveCorreo, t);
    return true;
  }

  private podar(t: number) {
    if (this.ultimoPorCorreo.size + this.porIp.size < this.opciones.maxClaves) return;
    for (const [k, v] of this.ultimoPorCorreo) if (t - v >= this.opciones.esperaPorCorreoMs) this.ultimoPorCorreo.delete(k);
    for (const [k, v] of this.porIp) if (v.every((x) => t - x >= this.opciones.ventanaIpMs)) this.porIp.delete(k);
  }
}
