import { puedeUsarPanelAdmin } from "@gateflow/auth/client";

/**
 * Lo que devuelve la consulta del middleware:
 * user_tenants.select("roles(clave), tenants(onboarding_completado, estado_servicio)").
 */
export type MembresiaPanel = {
  roles: unknown;
  tenants: unknown;
} | null;

/**
 * Decide a dónde va una petición autenticada a una ruta protegida del
 * panel Admin. Devuelve null si puede pasar. Falla cerrado: un error de
 * lectura, una membresía incompleta o un rol fuera de ROLES_PANEL_ADMIN
 * nunca dejan pasar.
 */
export function destinoPanelAdmin(error: unknown, membership: MembresiaPanel | undefined): string | null {
  if (error) return "/sin-acceso?motivo=error";
  if (!membership) return "/sin-acceso";

  const tenantData = membership.tenants as { onboarding_completado: boolean; estado_servicio: string } | null;
  const claveRol = (membership.roles as { clave: string | null } | null)?.clave;

  if (!tenantData || !claveRol) return "/sin-acceso?motivo=error";

  if (!puedeUsarPanelAdmin(claveRol)) return "/sin-acceso?motivo=rol";

  // RIESGO 3 (PERMISSIONS.md): un residencial suspendido se bloquea de
  // verdad, salvo para super_admin (que necesita poder entrar como
  // soporte a un tenant suspendido para resolver el motivo).
  if (tenantData.estado_servicio === "suspendido" && claveRol !== "super_admin") {
    return "/residencial-suspendido";
  }

  if (tenantData.onboarding_completado === false) return "/onboarding";

  return null;
}
