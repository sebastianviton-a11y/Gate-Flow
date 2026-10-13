"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { superadminActivarSuscripcionManual, superadminExtenderSuscripcionManual, superadminExtenderTrial } from "@gateflow/paquetes";
import {
  codigoDeError,
  mensajeError,
  proveedorDeError,
  validarEntrada,
  type AccionSuscripcion,
  type PlanManual,
  type ResultadoAccion,
} from "@/lib/superadmin/suscripcion-manual";

/**
 * Suscripción manual desde Super Admin. Cada acción:
 *   1. exige sesión de super_admin (en modo soporte el rol efectivo es
 *      admin_residencial: no puede);
 *   2. valida la forma de la entrada (uuid, "YYYY-MM-DD", plan);
 *   3. llama la RPC con el JWT de quien opera (cliente del servidor, sin
 *      clave de servicio): la base vuelve a verificar is_super_admin(),
 *      estado, proveedor y fechas, actualiza exactamente 1 fila y audita.
 * Nunca cobra ni toca Stripe/Mercado Pago. El log lleva acción y código,
 * no datos del residencial.
 */
async function ejecutar(
  accion: AccionSuscripcion,
  tenantId: unknown,
  hasta: unknown,
  plan: unknown,
  llamar: (supabase: ReturnType<typeof createServerSupabaseClient>, tenantId: string, hasta: string, plan: PlanManual | null) => Promise<{ resultado: "aplicado" | "sin_cambios" }>,
): Promise<ResultadoAccion> {
  const session = await getSessionContext();
  if (!session || session.role !== "super_admin") {
    return { ok: false, codigo: "no_autorizado", mensaje: mensajeError("no_autorizado") };
  }
  const entrada = validarEntrada(tenantId, hasta, plan);
  if (!entrada.ok) return { ok: false, codigo: entrada.codigo, mensaje: mensajeError(entrada.codigo) };

  const supabase = createServerSupabaseClient();
  try {
    const r = await llamar(supabase, entrada.tenantId, entrada.hasta, entrada.plan);
    revalidatePath(`/superadmin/residenciales/${entrada.tenantId}`);
    return {
      ok: true,
      resultado: r.resultado,
      mensaje: r.resultado === "sin_cambios" ? "Ya tenía esa fecha: no hubo cambios." : "Guardado.",
    };
  } catch (e) {
    const codigo = codigoDeError(e);
    console.warn("[GateFlow] superadmin.suscripcion", JSON.stringify({ accion, codigo }));
    return { ok: false, codigo, mensaje: mensajeError(codigo, proveedorDeError(e)) };
  }
}

export async function extenderPruebaAction(tenantId: string, hasta: string): Promise<ResultadoAccion> {
  return ejecutar("extender_prueba", tenantId, hasta, null, (s, t, h) => superadminExtenderTrial(s, t, h));
}

export async function activarSuscripcionManualAction(tenantId: string, hasta: string, plan: string | null): Promise<ResultadoAccion> {
  return ejecutar("activar", tenantId, hasta, plan, (s, t, h, p) => superadminActivarSuscripcionManual(s, t, h, p));
}

export async function extenderVigenciaAction(tenantId: string, hasta: string): Promise<ResultadoAccion> {
  return ejecutar("extender_vigencia", tenantId, hasta, null, (s, t, h) => superadminExtenderSuscripcionManual(s, t, h));
}
