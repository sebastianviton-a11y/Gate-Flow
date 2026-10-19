import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Hashes y token de tiempo de /registro. Nada de esto guarda ni
 * registra correo o IP en claro: solo HMAC-SHA256 con
 * REGISTRO_HASH_PEPPER (secreto del servidor). Sin el pepper, los
 * hashes no se pueden recalcular desde fuera.
 */

/** Tiempo mínimo de llenado: menos de esto es un bot. */
export const TIEMPO_MINIMO_MS = 4_000;
/** Tiempo máximo: después de esto el formulario se considera expirado. */
export const TIEMPO_MAXIMO_MS = 60 * 60 * 1000;

export function hmacHex(pepper: string, valor: string): string {
  return createHmac("sha256", pepper).update(valor, "utf8").digest("hex");
}

export function hashEmail(pepper: string, emailNormalizado: string): string {
  return hmacHex(pepper, `email:${emailNormalizado}`);
}

export function hashIp(pepper: string, ip: string | null): string | null {
  return ip ? hmacHex(pepper, `ip:${ip}`) : null;
}

/** `<ms>.<firma>`: el servidor lo emite al renderizar el formulario. */
export function emitirTokenTiempo(pepper: string, ahoraMs: number = Date.now()): string {
  const ts = String(Math.floor(ahoraMs));
  return `${ts}.${hmacHex(pepper, `t:${ts}`)}`;
}

export type VerificacionToken = { ok: true; edadMs: number } | { ok: false; motivo: "invalido" | "rapido" | "expirado" };

export function verificarTokenTiempo(pepper: string, token: string, ahoraMs: number = Date.now()): VerificacionToken {
  const [ts, firma] = token.split(".");
  if (!ts || !firma || !/^\d{1,16}$/.test(ts) || !/^[0-9a-f]{64}$/.test(firma)) {
    return { ok: false, motivo: "invalido" };
  }
  const esperada = Buffer.from(hmacHex(pepper, `t:${ts}`), "hex");
  const recibida = Buffer.from(firma, "hex");
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) {
    return { ok: false, motivo: "invalido" };
  }
  const edadMs = ahoraMs - Number(ts);
  if (edadMs < TIEMPO_MINIMO_MS) return { ok: false, motivo: "rapido" };
  if (edadMs > TIEMPO_MAXIMO_MS) return { ok: false, motivo: "expirado" };
  return { ok: true, edadMs };
}

/**
 * IP del cliente tal como la ve Netlify (x-nf-client-connection-ip);
 * si no está, la primera de x-forwarded-for. null si no hay ninguna:
 * entonces solo aplica el límite por correo.
 */
export function ipDesdeHeaders(obtener: (nombre: string) => string | null): string | null {
  const directa = obtener("x-nf-client-connection-ip")?.trim();
  if (directa) return directa.slice(0, 64);
  const reenviada = obtener("x-forwarded-for")?.split(",")[0]?.trim();
  return reenviada ? reenviada.slice(0, 64) : null;
}
