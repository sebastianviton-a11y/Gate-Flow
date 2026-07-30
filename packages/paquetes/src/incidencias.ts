import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoIncidencia =
  | "danado" | "abierto" | "mojado" | "etiqueta_ilegible"
  | "destinatario_desconocido" | "rechazado" | "devuelto" | "extraviado"
  | "golpeado" | "roto" | "empaque_deteriorado" | "contenido_incompleto" | "otro";

export type EstadoIncidencia = "abierta" | "en_seguimiento" | "resuelta";
export type NivelDanio = "leve" | "moderado" | "grave";

export const TIPO_INCIDENCIA_LABEL: Record<TipoIncidencia, string> = {
  danado: "Dañado",
  abierto: "Abierto",
  mojado: "Mojado",
  etiqueta_ilegible: "Etiqueta ilegible",
  destinatario_desconocido: "Destinatario desconocido",
  rechazado: "Rechazado por el residente",
  devuelto: "Devuelto a la paquetería",
  extraviado: "Extraviado",
  golpeado: "Paquete golpeado",
  roto: "Paquete roto",
  empaque_deteriorado: "Empaque deteriorado",
  contenido_incompleto: "Posible contenido incompleto",
  otro: "Otro",
};

export const NIVEL_DANIO_LABEL: Record<NivelDanio, string> = {
  leve: "Leve",
  moderado: "Moderado",
  grave: "Grave",
};

export interface Incidencia {
  id: string;
  paqueteId: string;
  paqueteCodigoGateflow: string;
  unidadIdentificador: string;
  tipo: TipoIncidencia;
  estado: EstadoIncidencia;
  descripcion: string | null;
  nivelDanio: NivelDanio | null;
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
  nivelDanio?: NivelDanio | null;
  reportadaPor: string;
}

/** BR-21: toda incidencia queda asociada a un paquete existente. Se
 * mantiene para el flujo MANUAL (apps/guard/.../incidents/new) — el
 * flujo desde el registro usa registrarPaqueteConIncidencia, que es
 * transaccional (ver más abajo). */
export async function reportarIncidencia(supabase: SupabaseClient, input: ReportarIncidenciaInput): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("incidencias")
    .insert({
      tenant_id: input.tenantId,
      paquete_id: input.paqueteId,
      tipo: input.tipo,
      descripcion: input.descripcion?.trim() || null,
      nivel_danio: input.nivelDanio ?? null,
      reportada_por: input.reportadaPor,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

// ── Registro de paquete CON incidencia en un solo paso ──────────────
// Usa la función SQL transaccional registrar_paquete_con_incidencia:
// si el insert de la incidencia falla, el paquete tampoco queda creado
// (ambos ocurren dentro de la misma transacción de Postgres).
export interface RegistrarPaqueteConIncidenciaInput {
  tenantId: string;
  unidadId: string;
  residenteId: string | null;
  remitente: string | null;
  empresaPaqueteriaId: string | null;
  numeroGuia: string | null;
  tamanoId: string | null;
  prioridadId: string | null;
  ubicacionId: string;
  notas: string | null;
  recibidoPor: string;
  tipoIncidencia: TipoIncidencia;
  descripcionIncidencia: string | null;
  nivelDanio: NivelDanio;
}

export async function registrarPaqueteConIncidencia(
  supabase: SupabaseClient,
  input: RegistrarPaqueteConIncidenciaInput,
): Promise<{ paqueteId: string; incidenciaId: string }> {
  const { data, error } = await supabase.rpc("registrar_paquete_con_incidencia", {
    p_tenant_id: input.tenantId,
    p_unidad_id: input.unidadId,
    p_residente_id: input.residenteId,
    p_remitente: input.remitente,
    p_empresa_paqueteria_id: input.empresaPaqueteriaId,
    p_numero_guia: input.numeroGuia,
    p_tamano_id: input.tamanoId,
    p_prioridad_id: input.prioridadId,
    p_ubicacion_id: input.ubicacionId,
    p_notas: input.notas,
    p_recibido_por: input.recibidoPor,
    p_tipo_incidencia: input.tipoIncidencia,
    p_descripcion_incidencia: input.descripcionIncidencia,
    p_nivel_danio: input.nivelDanio,
  });
  if (error) throw error;
  const fila = Array.isArray(data) ? data[0] : data;
  return { paqueteId: fila.paquete_id, incidenciaId: fila.incidencia_id };
}

export interface SubirFotografiaIncidenciaInput {
  tenantId: string;
  incidenciaId: string;
  archivo: File;
  tomadaPor: string;
}

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
  nivel_danio: string | null;
  created_at: string;
  resuelta_en: string | null;
  paquetes: { codigo_gateflow: string; unidades: { identificador: string } | null } | null;
  reportada: { nombre_completo: string } | null;
  resuelta: { nombre_completo: string } | null;
  incidencia_fotografias: { id: string }[] | null;
}

const INCIDENCIA_SELECT = `
  id, tipo, estado, descripcion, nivel_danio, created_at, resuelta_en,
  paquetes ( codigo_gateflow, unidades ( identificador ) ),
  reportada:users!incidencias_reportada_por_fkey ( nombre_completo ),
  resuelta:users!incidencias_resuelta_por_fkey ( nombre_completo ),
  incidencia_fotografias ( id )
`;

function mapIncidenciaRow(row: IncidenciaRow): Incidencia {
  return {
    id: row.id,
    paqueteId: "",
    paqueteCodigoGateflow: row.paquetes?.codigo_gateflow ?? "—",
    unidadIdentificador: row.paquetes?.unidades?.identificador ?? "—",
    tipo: row.tipo as TipoIncidencia,
    estado: row.estado as EstadoIncidencia,
    descripcion: row.descripcion,
    nivelDanio: (row.nivel_danio as NivelDanio) ?? null,
    reportadaPorNombre: row.reportada?.nombre_completo ?? "—",
    resueltaPorNombre: row.resuelta?.nombre_completo ?? null,
    creadaEn: row.created_at,
    resueltaEn: row.resuelta_en,
    totalFotografias: row.incidencia_fotografias?.length ?? 0,
  };
}

/** Firma sin cambios respecto a la versión actual — no se convierte a
 * un objeto de filtros para no romper la página del servidor que ya
 * la llama con esta forma. Los filtros nuevos (tipo, nivel de daño,
 * unidad, fecha) se resuelven en el cliente (incidencias-client.tsx)
 * sobre el arreglo ya cargado. */
export async function listarIncidencias(supabase: SupabaseClient, tenantId: string, estado?: EstadoIncidencia): Promise<Incidencia[]> {
  let consulta = supabase.from("incidencias").select(INCIDENCIA_SELECT).eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (estado) consulta = consulta.eq("estado", estado);
  const { data, error } = await consulta;
  if (error) throw error;
  return ((data ?? []) as unknown as IncidenciaRow[]).map(mapIncidenciaRow);
}

export async function obtenerIncidenciasPaquete(supabase: SupabaseClient, paqueteId: string): Promise<Incidencia[]> {
  const { data, error } = await supabase
    .from("incidencias")
    .select(INCIDENCIA_SELECT)
    .eq("paquete_id", paqueteId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as IncidenciaRow[]).map((row) => ({ ...mapIncidenciaRow(row), paqueteId }));
}

export async function resolverIncidencia(
  supabase: SupabaseClient,
  incidenciaId: string,
  resueltaPor: string,
  comentarioResolucion?: string,
): Promise<void> {
  const { error } = await supabase
    .from("incidencias")
    .update({
      estado: "resuelta",
      resuelta_por: resueltaPor,
      resuelta_en: new Date().toISOString(),
      comentario_resolucion: comentarioResolucion?.trim() || null,
    })
    .eq("id", incidenciaId);
  if (error) throw error;
}

export async function cambiarEstadoSeguimiento(supabase: SupabaseClient, incidenciaId: string): Promise<void> {
  const { error } = await supabase.from("incidencias").update({ estado: "en_seguimiento" }).eq("id", incidenciaId);
  if (error) throw error;
}
