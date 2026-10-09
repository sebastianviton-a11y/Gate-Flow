import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Registro de residentes por enlace — lado de la administración.
 * Lecturas por RLS (solo admin_residencial/super_admin del residencial
 * ven enlaces y solicitudes) y escrituras por las funciones de la base
 * (20261011000000_residentes_enlace.sql), que validan rol, residencial
 * operativo y datos. Ninguna aprobación sobrescribe datos existentes.
 */

export interface EnlaceResidentes {
  id: string;
  token: string;
  creadoEn: string;
}

export async function obtenerEnlaceResidentes(supabase: SupabaseClient, tenantId: string): Promise<EnlaceResidentes | null> {
  const { data, error } = await supabase
    .from("residentes_enlaces")
    .select("id, token, created_at")
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, token: data.token, creadoEn: data.created_at } : null;
}

/** URL para compartir. El token va después del #: el navegador no lo envía al servidor. */
export function urlEnlaceResidentes(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/alta-residente#${token}`;
}

/** Texto que acompaña al enlace al compartirlo (se puede editar antes de enviar). */
export const TEXTO_COMPARTIR_ENLACE =
  "Para que la guardia pueda avisarte por WhatsApp cuando llegue un paquete, carga tus datos en este enlace:";

/**
 * Compartir el enlace por WhatsApp sin destinatario: quien comparte elige
 * el grupo o el chat y envía. Nunca se manda nada solo.
 */
export function urlCompartirEnlaceWhatsApp(urlEnlace: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${TEXTO_COMPARTIR_ENLACE} ${urlEnlace}`)}`;
}

export async function generarEnlaceResidentes(supabase: SupabaseClient, tenantId: string): Promise<EnlaceResidentes> {
  const { data, error } = await supabase.rpc("residentes_enlace_generar", { p_tenant_id: tenantId });
  if (error) throw error;
  const r = data as { id: string; token: string };
  return { id: r.id, token: r.token, creadoEn: new Date().toISOString() };
}

export async function desactivarEnlaceResidentes(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const { error } = await supabase.rpc("residentes_enlace_desactivar", { p_tenant_id: tenantId });
  if (error) throw error;
}

export type TipoCoincidencia = "telefono_contacto" | "telefono_residente" | "nombre_en_direccion" | "solicitud_pendiente";

export interface CoincidenciaResidente {
  tipo: TipoCoincidencia;
  unidadId: string | null;
  direccion: string | null;
  nombre: string | null;
}

export interface SolicitudResidente {
  id: string;
  nombre: string;
  apellido: string;
  direccion: string;
  telefono: string;
  recibidaEn: string;
  viviendaSugerida: { id: string; direccion: string; conContacto: boolean } | null;
  coincidencias: CoincidenciaResidente[];
}

function mapCoincidencias(v: unknown): CoincidenciaResidente[] {
  return ((v ?? []) as Array<{ tipo: TipoCoincidencia; unidad_id: string | null; direccion: string | null; nombre: string | null }>).map((c) => ({
    tipo: c.tipo,
    unidadId: c.unidad_id,
    direccion: c.direccion,
    nombre: c.nombre,
  }));
}

export async function listarSolicitudesResidentes(supabase: SupabaseClient, tenantId: string): Promise<SolicitudResidente[]> {
  const { data, error } = await supabase.rpc("residentes_solicitudes_revision", { p_tenant_id: tenantId });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((s) => {
    const sugerida = s.vivienda_sugerida as { id: string; direccion: string; con_contacto: boolean } | null;
    return {
      id: s.id as string,
      nombre: s.nombre as string,
      apellido: s.apellido as string,
      direccion: s.direccion as string,
      telefono: s.telefono as string,
      recibidaEn: s.created_at as string,
      viviendaSugerida: sugerida ? { id: sugerida.id, direccion: sugerida.direccion, conContacto: sugerida.con_contacto } : null,
      coincidencias: mapCoincidencias(s.coincidencias),
    };
  });
}

export type MotivoNoAprobada =
  | "ya_revisada"
  | "no_operativo"
  | "datos_invalidos"
  | "unidad_no_valida"
  | "direccion_existente"
  | "direccion_inactiva"
  | "ya_registrado"
  | "posible_duplicado";

export type ResultadoAprobacion =
  | { ok: true; resultado: "vivienda_nueva" | "contacto_principal" | "residente_adicional"; unidadId: string }
  | { ok: false; motivo: MotivoNoAprobada; unidadId?: string; direccion?: string; coincidencias?: CoincidenciaResidente[] };

export async function aprobarSolicitudResidente(
  supabase: SupabaseClient,
  args: {
    solicitudId: string;
    nombre: string;
    apellido: string;
    direccion: string;
    telefono: string;
    /** null: vivienda nueva con esta dirección. */
    unidadId: string | null;
    confirmarDuplicado: boolean;
  },
): Promise<ResultadoAprobacion> {
  const { data, error } = await supabase.rpc("residentes_solicitud_aprobar", {
    p_solicitud_id: args.solicitudId,
    p_nombre: args.nombre,
    p_apellido: args.apellido,
    p_direccion: args.direccion,
    p_telefono: args.telefono,
    p_unidad_id: args.unidadId,
    p_confirmar_duplicado: args.confirmarDuplicado,
  });
  if (error) throw error;
  const r = data as { ok: boolean; resultado?: string; unidad_id?: string; motivo?: MotivoNoAprobada; direccion?: string; coincidencias?: unknown };
  if (r.ok) return { ok: true, resultado: r.resultado as "vivienda_nueva", unidadId: r.unidad_id as string };
  return {
    ok: false,
    motivo: r.motivo as MotivoNoAprobada,
    unidadId: r.unidad_id,
    direccion: r.direccion,
    coincidencias: r.coincidencias ? mapCoincidencias(r.coincidencias) : undefined,
  };
}

export type MotivoRechazo = "duplicado" | "datos_incorrectos" | "no_reside" | "otro";

export async function rechazarSolicitudResidente(
  supabase: SupabaseClient,
  solicitudId: string,
  motivo: MotivoRechazo,
): Promise<{ ok: boolean; motivo?: string }> {
  const { data, error } = await supabase.rpc("residentes_solicitud_rechazar", { p_solicitud_id: solicitudId, p_motivo: motivo });
  if (error) throw error;
  return data as { ok: boolean; motivo?: string };
}

/** Personas sin cuenta aprobadas como residentes adicionales de una vivienda. */
export interface ResidenteAdicional {
  id: string;
  unidadId: string;
  nombre: string;
  apellido: string;
  telefono: string;
  desde: string;
}

export async function listarResidentesAdicionales(supabase: SupabaseClient, tenantId: string): Promise<ResidenteAdicional[]> {
  const { data, error } = await supabase
    .from("residentes_unidades")
    .select("id, unidad_id, nombre, apellido, telefono, fecha_inicio")
    .eq("tenant_id", tenantId)
    .eq("origen", "enlace")
    .is("fecha_fin", null)
    .order("fecha_inicio");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    unidadId: r.unidad_id,
    nombre: r.nombre ?? "",
    apellido: r.apellido ?? "",
    telefono: r.telefono ?? "",
    desde: r.fecha_inicio,
  }));
}

export async function actualizarResidenteAdicional(
  supabase: SupabaseClient,
  args: { id: string; nombre: string; apellido: string; telefono: string },
): Promise<{ ok: boolean; motivo?: string }> {
  const { data, error } = await supabase.rpc("residentes_adicional_actualizar", {
    p_id: args.id,
    p_nombre: args.nombre,
    p_apellido: args.apellido,
    p_telefono: args.telefono,
  });
  if (error) throw error;
  return data as { ok: boolean; motivo?: string };
}

export async function quitarResidenteAdicional(supabase: SupabaseClient, id: string): Promise<{ ok: boolean; motivo?: string }> {
  const { data, error } = await supabase.rpc("residentes_adicional_quitar", { p_id: id });
  if (error) throw error;
  return data as { ok: boolean; motivo?: string };
}
