import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoIncidencia =
  | "danado"
  | "abierto"
  | "mojado"
  | "etiqueta_ilegible"
  | "destinatario_desconocido"
  | "rechazado"
  | "devuelto"
  | "extraviado";

export type EstadoIncidencia = "abierta" | "en_seguimiento" | "resuelta";

export const TIPO_INCIDENCIA_LABEL: Record<TipoIncidencia, string> = {
  danado: "Dañado",
  abierto: "Abierto",
  mojado: "Mojado",
  etiqueta_ilegible: "Etiqueta ilegible",
  destinatario_desconocido: "Destinatario desconocido",
  rechazado: "Rechazado por el residente",
  devuelto: "Devuelto a la paquetería",
  extraviado: "Extraviado",
};

export interface Incidencia {
  id: string;
  paqueteId: string;
  paqueteCodigoGateflow: string;
  unidadIdentificador: string;
  tipo: TipoIncidencia;
  estado: EstadoIncidencia;
  descripcion: string | null;
  reportadaPorNombre: string;
  resueltaPorNombre: string | null;
  creadaEn: string;
  resueltaEn: string | null;
  totalFotografias: number;
}

export interface ReportarIncidenciaInput {
  tenantId: string;
  paqueteId: string;
  tipo: TipoIncidencia;
  descripcion?: string | null;
  reportadaPor: string;
}

/** BR-21: toda incidencia queda asociada a un paquete existente — por
 * eso este input siempre exige paqueteId, nunca crea una "suelta". */
export async function reportarIncidencia(supabase: SupabaseClient, input: ReportarIncidenciaInput): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("incidencias")
    .insert({
      tenant_id: input.tenantId,
      paquete_id: input.paqueteId,
      tipo: input.tipo,
      descripcion: input.descripcion?.trim() || null,
      reportada_por: input.reportadaPor,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export interface SubirFotografiaIncidenciaInput {
  tenantId: string;
  incidenciaId: string;
  archivo: File;
  tomadaPor: string;
}

/**
 * Reutiliza el bucket "evidencia" (migración 12) en vez de crear uno
 * nuevo — su policy de INSERT solo exige que el primer segmento de la
 * ruta sea el tenant_id, sin importar qué haya después, así que
 * `{tenantId}/incidencias/{incidenciaId}/...` ya queda cubierto sin
 * ningún cambio de RLS.
 */
export async function subirFotografiaIncidencia(supabase: SupabaseClient, input: SubirFotografiaIncidenciaInput): Promise<void> {
  const extension = input.archivo.name.split(".").pop() ?? "jpg";
  const path = `${input.tenantId}/incidencias/${input.incidenciaId}/${crypto.randomUUID()}.${extension}`;

  const { error: errorSubida } = await supabase.storage.from("evidencia").upload(path, input.archivo, {
    contentType: input.archivo.type || "image/jpeg",
    upsert: false,
  });
  if (errorSubida) throw errorSubida;

  const { error: errorInsert } = await supabase.from("incidencia_fotografias").insert({
    incidencia_id: input.incidenciaId,
    storage_path: path,
    tomada_por: input.tomadaPor,
  });
  if (errorInsert) throw errorInsert;
}

interface IncidenciaRow {
  id: string;
  tipo: string;
  estado: string;
  descripcion: string | null;
  created_at: string;
  resuelta_en: string | null;
  paquetes: { codigo_gateflow: string; unidades: { identificador: string } | null } | null;
  reportada: { nombre_completo: string } | null;
  resuelta: { nombre_completo: string } | null;
  incidencia_fotografias: { id: string }[] | null;
}

const INCIDENCIA_SELECT = `
  id, tipo, estado, descripcion, created_at, resuelta_en,
  paquetes ( codigo_gateflow, unidades ( identificador ) ),
  reportada:users!incidencias_reportada_por_fkey ( nombre_completo ),
  resuelta:users!incidencias_resuelta_por_fkey ( nombre_completo ),
  incidencia_fotografias ( id )
`;

function mapIncidenciaRow(row: IncidenciaRow): Incidencia {
  return {
    id: row.id,
    paqueteId: "", // no se necesita en el listado — se completa en obtenerIncidenciasPaquete cuando aplica
    paqueteCodigoGateflow: row.paquetes?.codigo_gateflow ?? "—",
    unidadIdentificador: row.paquetes?.unidades?.identificador ?? "—",
    tipo: row.tipo as TipoIncidencia,
    estado: row.estado as EstadoIncidencia,
    descripcion: row.descripcion,
    reportadaPorNombre: row.reportada?.nombre_completo ?? "—",
    resueltaPorNombre: row.resuelta?.nombre_completo ?? null,
    creadaEn: row.created_at,
    resueltaEn: row.resuelta_en,
    totalFotografias: row.incidencia_fotografias?.length ?? 0,
  };
}

/** Para la pantalla de administración — todas las incidencias del
 * tenant, más recientes primero, con filtro opcional por estado. */
export async function listarIncidencias(supabase: SupabaseClient, tenantId: string, estado?: EstadoIncidencia): Promise<Incidencia[]> {
  let consulta = supabase.from("incidencias").select(INCIDENCIA_SELECT).eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (estado) consulta = consulta.eq("estado", estado);

  const { data, error } = await consulta;
  if (error) throw error;
  return ((data ?? []) as unknown as IncidenciaRow[]).map(mapIncidenciaRow);
}

/** Para el detalle de un paquete — sus incidencias, si tiene alguna. */
export async function obtenerIncidenciasPaquete(supabase: SupabaseClient, paqueteId: string): Promise<Incidencia[]> {
  const { data, error } = await supabase
    .from("incidencias")
    .select(INCIDENCIA_SELECT)
    .eq("paquete_id", paqueteId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as IncidenciaRow[]).map((row) => ({ ...mapIncidenciaRow(row), paqueteId }));
}

export async function resolverIncidencia(supabase: SupabaseClient, incidenciaId: string, resueltaPor: string): Promise<void> {
  const { error } = await supabase
    .from("incidencias")
    .update({ estado: "resuelta", resuelta_por: resueltaPor, resuelta_en: new Date().toISOString() })
    .eq("id", incidenciaId);
  if (error) throw error;
}

export async function cambiarEstadoSeguimiento(supabase: SupabaseClient, incidenciaId: string): Promise<void> {
  const { error } = await supabase.from("incidencias").update({ estado: "en_seguimiento" }).eq("id", incidenciaId);
  if (error) throw error;
}
