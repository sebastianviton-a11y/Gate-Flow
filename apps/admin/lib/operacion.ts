import { puedeOperar } from "@gateflow/auth";
import { leerAccesoAdmin } from "@/lib/acceso-servidor";

export const MENSAJE_SERVICIO_INACTIVO = "El servicio de este residencial no está activo.";

/**
 * Para las server actions que escriben con la clave de servicio (no
 * pasan por RLS ni por tenant_operativo): misma decisión que el panel,
 * sobre la membresía del residencial SELECCIONADO (gf_tenant).
 * super_admin (también en modo soporte) puede; trial vencido,
 * suscripción inactiva, sin suscripción, residencial suspendido o sin
 * selección válida, no. Falla cerrado ante cualquier error.
 */
export async function residencialPuedeOperar(): Promise<boolean> {
  try {
    const { userId, resultado } = await leerAccesoAdmin();
    if (!userId) return false;
    const { decision } = resultado;
    return decision.tipo !== "seleccionar_residencial" && puedeOperar(decision);
  } catch {
    return false;
  }
}
