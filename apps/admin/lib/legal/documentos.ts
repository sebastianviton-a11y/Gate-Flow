/**
 * Documentos legales públicos (/terminos, /privacidad, /acuerdo-datos):
 * catálogo, parámetros de la URL y lectura. Sin imports de Next ni de
 * Supabase, para poder probarlo (lib/__tests__/legal-paginas.test.ts).
 *
 * Qué versión está vigente lo decide SIEMPRE la base
 * (documentos_legales_historial calcula la situación de cada versión con
 * now() del servidor): ni la página ni el navegador comparan fechas.
 * Solo existen para la API las tres lecturas de documentos publicados
 * (migración 20261015000000); nunca un borrador ni un aprobado sin
 * publicar.
 */

export type ClaveDocumento = "terminos" | "privacidad" | "acuerdo_tratamiento";
export type Pais = "MX" | "AR";
export type Situacion = "vigente" | "programada" | "anterior" | "retirada";

export const DOCUMENTOS: Record<ClaveDocumento, { titulo: string; ruta: string }> = {
  terminos: { titulo: "Términos y Condiciones", ruta: "/terminos" },
  privacidad: { titulo: "Aviso de Privacidad", ruta: "/privacidad" },
  acuerdo_tratamiento: { titulo: "Acuerdo de Tratamiento de Datos", ruta: "/acuerdo-datos" },
};

export const PAISES: ReadonlyArray<{ codigo: Pais; nombre: string; zona: string }> = [
  { codigo: "MX", nombre: "México", zona: "America/Mexico_City" },
  { codigo: "AR", nombre: "Argentina", zona: "America/Argentina/Buenos_Aires" },
];
export const PAIS_POR_DEFECTO: Pais = "MX";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** ?pais=AR|ar → "AR"; cualquier otra cosa (o nada) → México. */
export function normalizarPais(valor: string | string[] | undefined): Pais {
  const v = (primero(valor) ?? "").trim().toUpperCase();
  return PAISES.some((p) => p.codigo === v) ? (v as Pais) : PAIS_POR_DEFECTO;
}

/** ?version=<uuid> → uuid en minúsculas; cualquier otra cosa → null (vigente). */
export function normalizarVersionId(valor: string | string[] | undefined): string | null {
  const v = (primero(valor) ?? "").trim();
  return RE_UUID.test(v) ? v.toLowerCase() : null;
}

export function nombrePais(pais: Pais): string {
  return PAISES.find((p) => p.codigo === pais)?.nombre ?? pais;
}

export function zonaPais(pais: Pais): string {
  return PAISES.find((p) => p.codigo === pais)?.zona ?? "America/Mexico_City";
}

/** Enlace a un documento: el país siempre explícito; la versión solo para el historial. */
export function hrefDocumento(clave: ClaveDocumento, pais: Pais, versionId?: string | null): string {
  const q = new URLSearchParams({ pais });
  if (versionId) q.set("version", versionId);
  return `${DOCUMENTOS[clave].ruta}?${q.toString()}`;
}

export interface VersionHistorial {
  versionId: string;
  version: string;
  pais: Pais;
  estado: "publicado" | "retirado";
  situacion: Situacion;
  vigenteDesde: string;
  publicadoEn: string;
  retiradoEn: string | null;
  resumenCambios: string | null;
  sha256: string;
}

export interface DocumentoPublicado {
  versionId: string;
  clave: ClaveDocumento;
  titulo: string;
  version: string;
  pais: Pais;
  estado: "publicado" | "retirado";
  situacion: Situacion;
  vigenteDesde: string;
  publicadoEn: string;
  retiradoEn: string | null;
  contenido: string;
  sha256: string;
}

export type ResultadoDocumento =
  | { tipo: "publicado"; pais: Pais; documento: DocumentoPublicado; historial: VersionHistorial[] }
  /** Sin versión vigente para el país (puede haber programadas o retiradas en el historial). */
  | { tipo: "pendiente"; pais: Pais; historial: VersionHistorial[] }
  /** La lectura no está disponible (migración sin aplicar, red, permisos): nunca se muestra un texto. */
  | { tipo: "no_disponible"; pais: Pais }
  /** ?version= de otra cosa: inexistente, de otro documento, borrador o aprobado sin publicar. */
  | { tipo: "version_no_encontrada"; pais: Pais; historial: VersionHistorial[] };

/** Lo mínimo de supabase-js que se usa: solo .rpc (nunca .from: las tablas no tienen permisos). */
export interface ClienteRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

type FilaHistorial = {
  version_id: string; version: string; jurisdiccion: string; estado: string; situacion: string;
  vigente_desde: string; publicado_en: string; retirado_en: string | null; resumen_cambios: string | null; contenido_sha256: string;
};
type FilaPublicado = {
  version_id: string; documento_clave: string; titulo: string; version: string; jurisdiccion: string; estado: string;
  vigente_desde: string; publicado_en: string; retirado_en: string | null; contenido: string; contenido_sha256: string;
};

const SITUACIONES: readonly Situacion[] = ["vigente", "programada", "anterior", "retirada"];

function aHistorial(filas: unknown): VersionHistorial[] | null {
  if (!Array.isArray(filas)) return null;
  const salida: VersionHistorial[] = [];
  for (const f of filas as FilaHistorial[]) {
    if (!f || typeof f.version_id !== "string" || !SITUACIONES.includes(f.situacion as Situacion)) return null;
    if (f.estado !== "publicado" && f.estado !== "retirado") return null;
    if (f.jurisdiccion !== "MX" && f.jurisdiccion !== "AR") return null;
    salida.push({
      versionId: f.version_id, version: f.version, pais: f.jurisdiccion, estado: f.estado, situacion: f.situacion as Situacion,
      vigenteDesde: f.vigente_desde, publicadoEn: f.publicado_en, retiradoEn: f.retirado_en, resumenCambios: f.resumen_cambios,
      sha256: f.contenido_sha256,
    });
  }
  return salida;
}

/** Errores de lectura: solo el código, sin datos de la petición. */
export type RegistroError = (contexto: string, codigo: string) => void;
const registrarPorDefecto: RegistroError = (contexto, codigo) => console.error(`[GateFlow] lectura legal no disponible (${contexto}): ${codigo}`);

async function historialDe(cliente: ClienteRpc, clave: ClaveDocumento, pais: Pais, registrar: RegistroError) {
  const { data, error } = await cliente.rpc("documentos_legales_historial", { p_clave: clave, p_pais: pais });
  if (error) {
    registrar("historial", error.code ?? "sin_codigo");
    return null;
  }
  const historial = aHistorial(data);
  if (!historial) registrar("historial", "forma_inesperada");
  return historial;
}

async function publicadoDe(cliente: ClienteRpc, versionId: string, registrar: RegistroError): Promise<FilaPublicado | null | "error"> {
  const { data, error } = await cliente.rpc("documento_legal_publicado", { p_version_id: versionId });
  if (error) {
    registrar("version", error.code ?? "sin_codigo");
    return "error";
  }
  const fila = Array.isArray(data) ? (data[0] as FilaPublicado | undefined) : undefined;
  return fila ?? null;
}

/**
 * Lee lo que la página debe mostrar. Sin versionId: la vigente para el
 * país (o "pendiente"). Con versionId: esa versión, solo si es una
 * publicada o retirada DE ESTE documento; si es de otro país, la página
 * pasa a ese país (el historial que se muestra es siempre el del país de
 * la versión).
 */
export async function leerDocumentoLegal(
  cliente: ClienteRpc,
  clave: ClaveDocumento,
  paisPedido: Pais,
  versionId: string | null,
  registrar: RegistroError = registrarPorDefecto,
): Promise<ResultadoDocumento> {
  let pais = paisPedido;
  let historial: VersionHistorial[] | null;
  try {
    historial = await historialDe(cliente, clave, pais, registrar);
    if (!historial) return { tipo: "no_disponible", pais };

    let objetivo: string | null = versionId;
    if (!objetivo) {
      objetivo = historial.find((h) => h.situacion === "vigente")?.versionId ?? null;
      if (!objetivo) return { tipo: "pendiente", pais, historial };
    }

    const fila = await publicadoDe(cliente, objetivo, registrar);
    if (fila === "error") return { tipo: "no_disponible", pais };
    if (!fila || fila.documento_clave !== clave || (fila.estado !== "publicado" && fila.estado !== "retirado")) {
      return versionId ? { tipo: "version_no_encontrada", pais, historial } : { tipo: "pendiente", pais, historial };
    }
    if (fila.jurisdiccion !== pais) {
      if (fila.jurisdiccion !== "MX" && fila.jurisdiccion !== "AR") return { tipo: "version_no_encontrada", pais, historial };
      pais = fila.jurisdiccion;
      historial = await historialDe(cliente, clave, pais, registrar);
      if (!historial) return { tipo: "no_disponible", pais };
    }
    const enHistorial = historial.find((h) => h.versionId === fila.version_id);
    if (!enHistorial) return versionId ? { tipo: "version_no_encontrada", pais, historial } : { tipo: "pendiente", pais, historial };

    return {
      tipo: "publicado",
      pais,
      historial,
      documento: {
        versionId: fila.version_id, clave, titulo: fila.titulo, version: fila.version, pais, estado: fila.estado,
        situacion: enHistorial.situacion, vigenteDesde: fila.vigente_desde, publicadoEn: fila.publicado_en,
        retiradoEn: fila.retirado_en, contenido: fila.contenido, sha256: fila.contenido_sha256,
      },
    };
  } catch (e) {
    registrar("excepcion", e instanceof Error ? e.name : "desconocida");
    return { tipo: "no_disponible", pais };
  }
}

export const ETIQUETA_SITUACION: Record<Situacion, string> = {
  vigente: "Vigente",
  programada: "Próxima versión",
  anterior: "Versión anterior",
  retirada: "Retirada",
};
