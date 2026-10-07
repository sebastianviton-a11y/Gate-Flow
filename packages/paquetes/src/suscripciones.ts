import type { SupabaseClient } from "@supabase/supabase-js";
import { estadoEfectivoSuscripcion, type EstadoEfectivoSuscripcion } from "@gateflow/auth/client";
import type { Suscripcion } from "@gateflow/types";

/**
 * Lectura del estado de suscripción de un residencial (tabla
 * suscripciones, migración 20261006000000). La lógica del estado
 * efectivo vive en @gateflow/auth (acceso.ts), la misma que decide el
 * acceso de Admin y Guard; esto solo adapta la fila camelCase.
 */

export type SituacionSuscripcion = EstadoEfectivoSuscripcion;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Pura. past_due/canceled → inactiva (no operan); sin fila →
 * sin_suscripcion (falla cerrado).
 */
export function situacionSuscripcion(suscripcion: Suscripcion | null, ahora: Date = new Date()): SituacionSuscripcion {
  return estadoEfectivoSuscripcion(
    suscripcion
      ? {
          estado: suscripcion.estado,
          trial_ends_at: suscripcion.trialEndsAt,
          current_period_end: suscripcion.currentPeriodEnd,
          cancel_at_period_end: suscripcion.cancelAtPeriodEnd,
        }
      : null,
    ahora,
  );
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
  plan: Suscripcion["plan"];
  provider: Suscripcion["provider"];
  provider_customer_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}

/** Lee con la sesión del usuario: RLS solo deja ver la de sus tenants. */
export async function obtenerSuscripcion(supabase: SupabaseClient, tenantId: string): Promise<Suscripcion | null> {
  const { data, error } = await supabase
    .from("suscripciones")
    .select(
      "id, tenant_id, estado, trial_started_at, trial_ends_at, viviendas_declaradas, origen, plan, provider, provider_customer_id, current_period_end, cancel_at_period_end",
    )
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
    plan: fila.plan,
    provider: fila.provider,
    currentPeriodEnd: fila.current_period_end,
    cancelAtPeriodEnd: fila.cancel_at_period_end === true,
    tieneClienteProveedor: Boolean(fila.provider_customer_id),
  };
}
