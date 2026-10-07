import { rolDeFila, type ResultadoAccesoUsuario } from "@gateflow/auth/client";

/**
 * Quién puede pagar o gestionar la suscripción: solo el
 * admin_residencial del residencial SELECCIONADO (gf_tenant validada
 * contra sus membresías activas, sin limit(1)). Nunca un tenant enviado
 * por el navegador, un guardia, ni super_admin por este flujo. La base
 * vuelve a verificarlo (billing_crear_checkout).
 */
export type AutorizacionBilling =
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; motivo: "sesion" | "seleccion" | "rol" };

export function autorizarBilling(userId: string | null, resultado: ResultadoAccesoUsuario): AutorizacionBilling {
  if (!userId) return { ok: false, motivo: "sesion" };
  if (resultado.seleccion.tipo !== "resuelta" || !resultado.tenantId) return { ok: false, motivo: "seleccion" };
  if (resultado.seleccion.membresia.tenant_id !== resultado.tenantId) return { ok: false, motivo: "seleccion" };
  if (rolDeFila(resultado.seleccion.membresia) !== "admin_residencial") return { ok: false, motivo: "rol" };
  return { ok: true, userId, tenantId: resultado.tenantId };
}

/**
 * Alta de pago (checkout): solo con la suscripción bloqueada por
 * vencimiento o inactividad. Durante el trial vigente no se cobra; con
 * suscripción activa o en gracia se usa "Administrar suscripción".
 */
export function permiteAlta(resultado: ResultadoAccesoUsuario): boolean {
  const d = resultado.decision;
  return d.tipo === "suscripcion" && (d.estado === "vencida" || d.estado === "inactiva");
}
