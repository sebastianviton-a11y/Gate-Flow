import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { resolverZonaHoraria } from "@gateflow/types";

/** Combina clases de Tailwind resolviendo conflictos (patrón estándar shadcn/ui). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extrae un mensaje de error legible sin asumir que lo lanzado es una
 * instancia de `Error`. Bug real encontrado en producción: Supabase
 * (PostgREST) lanza objetos planos `{ message, code, details, hint }`,
 * no `new Error(...)` — un `catch (e) { e instanceof Error ? e.message : ... }`
 * evalúa a `false` para esos objetos y oculta el mensaje real detrás de
 * un texto genérico, exactamente el síntoma reportado ("No se pudo
 * registrar el paquete." sin más detalle, con un error real de Supabase
 * detrás). Esta función cubre ambos casos.
 */
export function obtenerMensajeError(error: unknown, mensajePorDefecto: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return mensajePorDefecto;
}

/** Error propio para distinguir "se agotó el tiempo" de cualquier otro
 * fallo — así el llamador puede mostrar el mensaje correcto sin tener
 * que inspeccionar texto. */
export class ErrorTiempoAgotado extends Error {
  constructor() {
    super("Se agotó el tiempo de espera.");
    this.name = "ErrorTiempoAgotado";
  }
}

/**
 * Ejecuta una operación con un límite de tiempo real — nunca deja un
 * spinner girando para siempre. `fn` recibe la señal de un
 * AbortController que se cancela automáticamente si se agota el
 * tiempo, para que cualquier llamada que sí acepte una señal (fetch
 * directo, por ejemplo) pueda cortar la petición de red real; las
 * llamadas de Supabase usadas hoy en GateFlow no aceptan una señal
 * externa, así que para ellas esto no cancela la petición en curso en
 * el servidor — pero sí garantiza que la INTERFAZ deje de esperar y
 * pase a mostrar un error después de `timeoutMs`, que es el problema
 * real que esto resuelve (un botón "Guardando…" que nunca termina).
 */
export async function ejecutarConTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs = 9000): Promise<T> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeoutMs);

  try {
    return await Promise.race([
      fn(controlador.signal),
      new Promise<never>((_, reject) => {
        controlador.signal.addEventListener("abort", () => reject(new ErrorTiempoAgotado()));
      }),
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Distingue "no hay conexión / el servidor no respondió" de un error
 * real de la aplicación (validación, permisos, etc.) — un `TypeError`
 * de `fetch` fallido es la señal estándar del navegador para "no se
 * pudo ni siquiera hacer la petición".
 */
export function esErrorDeRed(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network/i.test(error.message);
}

/** Mensaje correcto según el tipo de fallo — sin conexión, tiempo
 * agotado, o cualquier otro error — para nunca mostrar un genérico
 * cuando ya se sabe la causa real. */
export function obtenerMensajeErrorConTimeout(error: unknown, mensajePorDefecto: string): string {
  if (error instanceof ErrorTiempoAgotado) {
    return "La operación tardó demasiado y se canceló. Verifica tu conexión e intenta de nuevo.";
  }
  if (esErrorDeRed(error)) {
    return "Sin conexión a internet. Verifica tu red e intenta de nuevo.";
  }
  return obtenerMensajeError(error, mensajePorDefecto);
}

/**
 * Formato de fechas visibles. La zona es SIEMPRE la del residencial
 * (`tenants.timezone`, en `session.tenant.timezone`), que se pasa en cada
 * llamada: un residencial de Argentina ve la hora de Buenos Aires y uno
 * de Cancún la de Cancún, aunque el código corra en el servidor de
 * Netlify (UTC) o en un navegador de otra zona. La resolución de la zona
 * (y su respaldo para datos sin zona) vive en @gateflow/types.
 *
 * No crear ningún otro `toLocaleString`/`toLocaleDateString` suelto en
 * ninguna pantalla — siempre pasar por estas funciones.
 */

/** Fecha + hora en la zona del residencial (ej. "3/8/2026, 2:46:49 p.m."). */
export function formatearFechaHora(
  iso: string | null | undefined,
  zonaHoraria: string | null | undefined,
  opciones?: Intl.DateTimeFormatOptions,
): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { timeZone: resolverZonaHoraria(zonaHoraria), ...opciones });
}

/** Solo fecha, sin hora, en la zona del residencial (ej. "3/8/2026"). */
export function formatearFecha(
  iso: string | null | undefined,
  zonaHoraria: string | null | undefined,
  opciones?: Intl.DateTimeFormatOptions,
): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { timeZone: resolverZonaHoraria(zonaHoraria), ...opciones });
}

/**
 * Un día que YA es local ("YYYY-MM-DD", p. ej. del dashboard). Se formatea
 * en UTC a propósito: la clave no es un instante, y convertirla a otra
 * zona la correría un día (el 9 se vería como 8 en Argentina).
 */
export function formatearClaveDia(clave: string, opciones?: Intl.DateTimeFormatOptions): string {
  return new Date(`${clave}T12:00:00Z`).toLocaleDateString("es-MX", { timeZone: "UTC", ...opciones });
}
