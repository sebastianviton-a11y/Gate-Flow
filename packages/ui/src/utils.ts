import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
