/**
 * Aceptación de documentos legales en /registro y en /aceptar-invitacion
 * (Fase 3, migración 20261017000000). El formulario manda las versiones
 * que MOSTRÓ; la base las compara con las vigentes y registra la
 * evidencia (versión, hash y hora del servidor). Sin imports de Next ni
 * de Supabase, para poder probarlo (lib/__tests__/aceptacion-legal.test.ts).
 */
import type { ClaveDocumento } from "./documentos";

export interface DocumentoAceptable {
  versionId: string;
  clave: ClaveDocumento;
  titulo: string;
  version: string;
}

/** Fila de documentos_legales_vigentes(p_pais). */
export interface FilaVigente {
  version_id: string;
  documento_clave: string;
  titulo: string;
  version: string;
}

/** Registro: Términos, Aviso de Privacidad y Acuerdo de Tratamiento (el contrato del residencial). */
export const DOCUMENTOS_REGISTRO: readonly ClaveDocumento[] = ["terminos", "privacidad", "acuerdo_tratamiento"];
/** Invitación: solo los personales. El Acuerdo de Tratamiento lo acepta el residencial al registrarse. */
export const DOCUMENTOS_INVITACION: readonly ClaveDocumento[] = ["terminos", "privacidad"];

export const MAX_VERSIONES = 10;

export const MENSAJES_ACEPTACION = {
  actualizados: "Los documentos legales se actualizaron mientras completabas el formulario. Revísalos y vuelve a aceptarlos.",
  declaracion: "Confirma que tienes facultades para aceptar el Acuerdo de Tratamiento de Datos en nombre del residencial.",
  invalidos: "No pudimos confirmar los documentos que aceptaste. Recarga la página e inténtalo de nuevo.",
} as const;

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Las vigentes que se muestran, en orden fijo; cualquier otra clave se ignora. */
export function documentosMostrados(filas: readonly FilaVigente[] | null | undefined, claves: readonly ClaveDocumento[]): DocumentoAceptable[] {
  const porClave = new Map<string, FilaVigente>();
  for (const f of filas ?? []) if (f && typeof f.version_id === "string" && RE_UUID.test(f.version_id)) porClave.set(f.documento_clave, f);
  return claves.flatMap((clave) => {
    const f = porClave.get(clave);
    return f ? [{ versionId: f.version_id.toLowerCase(), clave, titulo: f.titulo, version: f.version }] : [];
  });
}

/** version_ids del formulario: uuids distintos (máx. 10) o null si algo no cuadra. */
export function leerVersionIds(valores: readonly unknown[] | null | undefined): string[] | null {
  const ids = (valores ?? []).map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""));
  if (ids.length > MAX_VERSIONES || ids.some((id) => !RE_UUID.test(id)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

/** ¿Lo que se mostró es exactamente lo vigente? (mismo conjunto de versiones) */
export function mismasVersiones(mostradas: readonly string[], vigentes: readonly string[]): boolean {
  const a = new Set(mostradas.map((x) => x.toLowerCase()));
  const b = new Set(vigentes.map((x) => x.toLowerCase()));
  return a.size === b.size && [...a].every((x) => b.has(x));
}

export type ErrorAceptacion = "actualizados" | "declaracion" | "no_disponible";

/** Error de la base (crear_cuenta_prueba / aceptar_documentos_invitacion) → motivo para la pantalla. */
export function errorDeAceptacion(detalle: string | null | undefined): ErrorAceptacion | null {
  const d = detalle ?? "";
  if (/documento_cambiado|aceptacion_faltante/.test(d)) return "actualizados";
  if (/falta_declaracion_facultades/.test(d)) return "declaracion";
  if (/documento_no_disponible/.test(d)) return "no_disponible";
  return null;
}
