"use server";

import { createAnonServerClient, createServerSupabaseClient } from "@gateflow/supabase";
import { DOCUMENTOS_INVITACION, documentosMostrados, errorDeAceptacion, leerVersionIds, type DocumentoAceptable, type FilaVigente } from "@/lib/legal/aceptacion";
import type { Pais } from "@/lib/legal/documentos";
import { paisDeMembresias, type PaisInvitacion } from "@/lib/legal/pais-invitacion";

/**
 * País del residencial de la invitación, para enlazar sus documentos
 * legales. No recibe argumentos: el navegador no puede elegir el país ni
 * el residencial. Valida la sesión con getUser() (revalida el token) y
 * lee las membresías activas y el país de su residencial con el cliente
 * de la sesión (RLS: solo las propias). En el log, solo el motivo.
 */
export async function paisDeLaInvitacion(): Promise<PaisInvitacion> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: errorSesion,
  } = await supabase.auth.getUser();
  if (errorSesion || !user) return { estado: "indeterminado", motivo: "sin_sesion" };

  const { data, error } = await supabase.from("user_tenants").select("tenant_id, tenants(pais)").eq("user_id", user.id).eq("activo", true);
  const resultado = paisDeMembresias(error, data);
  if (resultado.estado !== "ok") console.error(`[GateFlow] aceptar-invitacion: país del residencial no determinado (${resultado.motivo})`);
  return resultado;
}

/**
 * Versiones vigentes de los documentos personales (Términos, Aviso de
 * Privacidad) del país: las que el formulario muestra y envía al aceptar.
 * Es información pública (lectura de la Fase 2); el residencial nunca
 * sale del navegador. null si no se pudieron leer.
 */
export async function documentosDeLaInvitacion(pais: Pais): Promise<DocumentoAceptable[] | null> {
  if (pais !== "MX" && pais !== "AR") return null;
  const { data, error } = await createAnonServerClient().rpc("documentos_legales_vigentes", { p_pais: pais });
  if (error) {
    console.error(`[GateFlow] aceptar-invitacion: no se leyeron los documentos vigentes (${error.code ?? ""})`);
    return null;
  }
  return documentosMostrados(data as FilaVigente[] | null, DOCUMENTOS_INVITACION);
}

export type ResultadoAceptacionInvitacion = { ok: true } | { ok: false; motivo: "actualizados" | "error" };

/**
 * Registra la aceptación de la persona invitada con la hora del SERVIDOR
 * (aceptar_documentos_invitacion). Recibe solo las versiones que se
 * mostraron: los residenciales son los de sus membresías activas (RLS) y
 * la RPC vuelve a exigir membresía, país y versión vigente. Si los
 * documentos cambiaron, pide aceptarlos de nuevo; ante cualquier error no
 * se continúa.
 */
export async function aceptarDocumentosDeLaInvitacion(versionIds: string[]): Promise<ResultadoAceptacionInvitacion> {
  const ids = leerVersionIds(Array.isArray(versionIds) ? versionIds : []);
  if (ids === null) return { ok: false, motivo: "actualizados" };
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: errorSesion,
  } = await supabase.auth.getUser();
  if (errorSesion || !user) return { ok: false, motivo: "error" };

  const { data, error } = await supabase.from("user_tenants").select("tenant_id").eq("user_id", user.id).eq("activo", true);
  const residenciales = (data ?? []).map((m) => (m as { tenant_id: string }).tenant_id).filter(Boolean);
  if (error || residenciales.length === 0) {
    console.error("[GateFlow] aceptar-invitacion: sin membresías activas para registrar la aceptación");
    return { ok: false, motivo: "error" };
  }
  for (const tenantId of residenciales) {
    const { error: errorRpc } = await supabase.rpc("aceptar_documentos_invitacion", { p_tenant_id: tenantId, p_version_ids: ids });
    if (errorRpc) {
      const motivo = errorDeAceptacion(errorRpc.message) === "actualizados" ? "actualizados" : "error";
      console.error(`[GateFlow] aceptar-invitacion: aceptación no registrada (${errorRpc.code ?? ""} ${motivo})`);
      return { ok: false, motivo };
    }
  }
  return { ok: true };
}
