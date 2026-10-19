import { cookies } from "next/headers";
import {
  COOKIE_TENANT,
  SELECT_MEMBRESIAS_ACCESO,
  resolverAccesoUsuario,
  type DecisionAccesoUsuario,
  type FilaMembresia,
  type ResultadoAccesoUsuario,
} from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";

/** Pantalla pública (sin consultas) para residenciales no operativos. */
export const RUTA_SERVICIO_INACTIVO = "/servicio-inactivo";

export interface AccesoGuard {
  filas: FilaMembresia[];
  resultado: ResultadoAccesoUsuario;
}

/**
 * Misma lógica que Admin (@gateflow/auth), en modo "guard":
 * usuario → TODAS sus membresías activas (sin limit) → gf_tenant de
 * Guard (cookie propia de este dominio) → membresía de ese tenant →
 * suspensión → suscripción → rol. Sin mensajes comerciales.
 */
export async function leerAccesoGuard(userId: string): Promise<AccesoGuard> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_tenants")
    .select(SELECT_MEMBRESIAS_ACCESO)
    .eq("user_id", userId)
    .eq("activo", true);
  const filas = (data ?? []) as FilaMembresia[];
  return {
    filas,
    resultado: resolverAccesoUsuario({ error, filas, cookieTenantId: cookies().get(COOKIE_TENANT)?.value, app: "guard" }),
  };
}

export async function decisionGuard(userId: string): Promise<DecisionAccesoUsuario> {
  return (await leerAccesoGuard(userId)).resultado.decision;
}

/** Suspendido, trial vencido, suscripción inactiva o sin suscripción. */
export function esServicioInactivo(decision: DecisionAccesoUsuario): boolean {
  return decision.tipo === "suspendido" || decision.tipo === "suscripcion";
}
