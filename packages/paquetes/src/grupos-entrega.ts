import type { SupabaseClient } from "@supabase/supabase-js";

export type EstadoGrupoEntrega = "pendiente" | "parcial" | "completado" | "cancelado";

export interface GrupoEntrega {
  id: string;
  tenantId: string;
  unidadId: string;
  residenteId: string | null;
  estado: EstadoGrupoEntrega;
  codigoGrupo: string | null;
  token: string;
  cantidadTotal: number;
  cantidadEntregada: number;
  whatsappEnviado: boolean;
  fechaEntrega: string | null;
  createdAt: string;
}

interface FilaGrupoEntrega {
  id: string;
  tenant_id: string;
  unidad_id: string;
  residente_id: string | null;
  estado: EstadoGrupoEntrega;
  codigo_grupo: string | null;
  token: string;
  cantidad_total: number;
  cantidad_entregada: number;
  whatsapp_enviado: boolean;
  fecha_entrega: string | null;
  created_at: string;
}

function mapearGrupo(fila: FilaGrupoEntrega): GrupoEntrega {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    unidadId: fila.unidad_id,
    residenteId: fila.residente_id,
    estado: fila.estado,
    codigoGrupo: fila.codigo_grupo,
    token: fila.token,
    cantidadTotal: fila.cantidad_total,
    cantidadEntregada: fila.cantidad_entregada,
    whatsappEnviado: fila.whatsapp_enviado,
    fechaEntrega: fila.fecha_entrega,
    createdAt: fila.created_at,
  };
}

/**
 * Revisa si la unidad ya tiene un grupo de entrega abierto ANTES de
 * registrar el paquete nuevo — así la pantalla de registro puede
 * mostrar el aviso ("Este residente ya tiene N paquetes pendientes")
 * con datos reales, no solo suponer que puede haber uno.
 */
export async function buscarGrupoAbiertoDeUnidad(
  supabase: SupabaseClient,
  tenantId: string,
  unidadId: string,
): Promise<GrupoEntrega | null> {
  const { data, error } = await supabase
    .from("paquete_grupos_entrega")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("unidad_id", unidadId)
    .in("estado", ["pendiente", "parcial"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapearGrupo(data as FilaGrupoEntrega) : null;
}

/** "Agregar al grupo existente" (opción predeterminada, BR de agrupación §2). */
export async function obtenerOCrearGrupoEntrega(
  supabase: SupabaseClient,
  tenantId: string,
  unidadId: string,
  residenteId: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc("obtener_o_crear_grupo_entrega", {
    p_tenant_id: tenantId,
    p_unidad_id: unidadId,
    p_residente_id: residenteId,
  });
  if (error) throw error;
  return data as string;
}

/** "Crear un grupo separado" — a propósito, aunque ya exista uno abierto. */
export async function crearGrupoEntregaSeparado(
  supabase: SupabaseClient,
  tenantId: string,
  unidadId: string,
  residenteId: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc("crear_grupo_entrega_separado", {
    p_tenant_id: tenantId,
    p_unidad_id: unidadId,
    p_residente_id: residenteId,
  });
  if (error) throw error;
  return data as string;
}

/** Liga un paquete ya registrado a un grupo, y recalcula el total del grupo. */
export async function ligarPaqueteAGrupo(supabase: SupabaseClient, paqueteId: string, grupoId: string): Promise<void> {
  const { error: errorUpdate } = await supabase.from("paquetes").update({ grupo_entrega_id: grupoId }).eq("id", paqueteId);
  if (errorUpdate) throw errorUpdate;

  const { error: errorRecalculo } = await supabase.rpc("recalcular_grupo_entrega", { p_grupo_id: grupoId });
  if (errorRecalculo) throw errorRecalculo;
}

export async function obtenerGrupoEntrega(supabase: SupabaseClient, grupoId: string): Promise<GrupoEntrega | null> {
  const { data, error } = await supabase.from("paquete_grupos_entrega").select("*").eq("id", grupoId).maybeSingle();
  if (error) throw error;
  return data ? mapearGrupo(data as FilaGrupoEntrega) : null;
}

export async function marcarWhatsappGrupoEnviado(supabase: SupabaseClient, grupoId: string): Promise<void> {
  const { error } = await supabase
    .from("paquete_grupos_entrega")
    .update({ whatsapp_enviado: true, whatsapp_enviado_en: new Date().toISOString() })
    .eq("id", grupoId);
  if (error) throw error;
}

/**
 * Entrega total o parcial de un grupo — reutiliza entregar_paquete()
 * por cada paquete_id (no reimplementa esa lógica). Los paquetes que
 * no se incluyan en paqueteIds permanecen pendientes.
 */
export async function entregarGrupoPaquetes(
  supabase: SupabaseClient,
  grupoId: string,
  paqueteIds: string[],
  entregadoPor: string,
  entregadoANombre: string,
): Promise<void> {
  const { error } = await supabase.rpc("entregar_grupo_paquetes", {
    p_grupo_id: grupoId,
    p_paquete_ids: paqueteIds,
    p_entregado_por: entregadoPor,
    p_entregado_a_nombre: entregadoANombre,
  });
  if (error) throw error;
}

/**
 * Construye el mensaje consolidado de WhatsApp para un grupo —
 * paralelo a construirMensajeNotificacion (que es por paquete
 * individual), con el singular/plural exacto que pide la
 * especificación. No modifica ni reemplaza la función existente:
 * un paquete que nunca se agrupó sigue usando la de siempre.
 */
export function construirMensajeNotificacionGrupo(
  cantidadTotal: number,
  nombreResidencial: string,
  nombreDestinatario: string,
  codigoGrupo: string,
  urlVerQr: string | undefined,
): string {
  const textoCantidad = cantidadTotal === 1 ? "1 paquete" : `${cantidadTotal} paquetes`;
  const lineas = [
    `Hola, ${nombreDestinatario}.`,
    "",
    `Has recibido ${textoCantidad} en ${nombreResidencial}.`,
    "",
    "Puedes recogerlos en recepción presentando el siguiente código QR.",
    "",
    `Código de retiro: ${codigoGrupo}`,
  ];
  if (urlVerQr) lineas.push("", urlVerQr);
  lineas.push("", "Por favor, no compartas este código con otras personas.");
  return lineas.join("\n");
}

export function construirEnlaceWhatsAppGrupo(
  telefonoDestinatario: string | null,
  mensaje: string,
): { url: string } | null {
  if (!telefonoDestinatario) return null;
  const telefonoLimpio = telefonoDestinatario.replace(/\D/g, "");
  return { url: `https://wa.me/${telefonoLimpio}?text=${encodeURIComponent(mensaje)}` };
}
