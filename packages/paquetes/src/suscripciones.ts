import type { SupabaseClient } from "@supabase/supabase-js";
import type { Suscripcion } from "@gateflow/types";

/**
 * Lectura del estado de suscripción de un residencial (tabla
 * suscripciones, migración 20261006000000). Todavía no bloquea nada:
 * solo informa. El bloqueo al vencer el trial es la siguiente fase.
 */

export type SituacionSuscripcion = "trial_activo" | "activa" | "vencida" | "sin_suscripcion";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Pura. `past_due` cuenta como activa (periodo de gracia; el bloqueo se
 * decide en la fase de pagos). `sin_suscripcion` debería ser
 * excepcional: el backfill de la migración dio active + alta_manual a
 * todos los residenciales existentes.
 */
export function situacionSuscripcion(suscripcion: Suscripcion | null, ahora: Date = new Date()): SituacionSuscripcion {
  if (!suscripcion) return "sin_suscripcion";
  switch (suscripcion.estado) {
    case "active":
    case "past_due":
      return "activa";
    case "trialing": {
      const fin = suscripcion.trialEndsAt ? Date.parse(suscripcion.trialEndsAt) : Number.NaN;
      return Number.isFinite(fin) && fin > ahora.getTime() ? "trial_activo" : "vencida";
    }
    default:
      return "vencida";
  }
}

/** Días completos que faltan para que termine el trial; null si no está en trial. */
export function diasRestantesTrial(suscripcion: Suscripcion | null, ahora: Date = new Date()): number | null {
  if (!suscripcion || suscripcion.estado !== "trialing" || !suscripcion.trialEndsAt) return null;
  const fin = Date.parse(suscripcion.trialEndsAt);
  if (!Number.isFinite(fin)) return null;
  return Math.max(0, Math.ceil((fin - ahora.getTime()) / MS_POR_DIA));
}

interface FilaSuscripcion {
  id: string;
  tenant_id: string;
  estado: Suscripcion["estado"];
  trial_started_at: string | null;
  trial_ends_at: string | null;
  viviendas_declaradas: number | null;
  origen: Suscripcion["origen"];
}

/** Lee con la sesión del usuario: RLS solo deja ver la de sus tenants. */
export async function obtenerSuscripcion(supabase: SupabaseClient, tenantId: string): Promise<Suscripcion | null> {
  const { data, error } = await supabase
    .from("suscripciones")
    .select("id, tenant_id, estado, trial_started_at, trial_ends_at, viviendas_declaradas, origen")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const fila = data as FilaSuscripcion;
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    estado: fila.estado,
    trialStartedAt: fila.trial_started_at,
    trialEndsAt: fila.trial_ends_at,
    viviendasDeclaradas: fila.viviendas_declaradas,
    origen: fila.origen,
  };
}
