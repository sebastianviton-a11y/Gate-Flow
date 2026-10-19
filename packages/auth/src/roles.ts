import type { RoleKey } from "@gateflow/types";

/**
 * Helpers de rol para la capa de UI. La autorización real vive en RLS
 * (02-ARCHITECTURE.md §12) — esto solo controla qué ve la interfaz,
 * nunca sustituye la verificación de la base de datos (CLAUDE.md §11).
 */

export const ROLE_LABELS: Record<RoleKey, string> = {
  super_admin: "Super Admin",
  admin_empresa: "Administrador de Empresa",
  admin_residencial: "Administrador",
  supervisor: "Supervisor",
  guardia: "Guardia",
  recepcion: "Recepción",
  residente: "Residente",
};

/**
 * Únicos roles que entran al panel de administración (apps/admin).
 * Cualquier otro rol (guardia, supervisor, recepcion, residente,
 * admin_empresa), uno vacío o uno desconocido va a /sin-acceso. Lo
 * aplican el middleware de Admin y el layout de (app).
 */
export const ROLES_PANEL_ADMIN: readonly RoleKey[] = ["super_admin", "admin_residencial"];

export function puedeUsarPanelAdmin(role: string | null | undefined): boolean {
  return typeof role === "string" && (ROLES_PANEL_ADMIN as readonly string[]).includes(role);
}

export function canAccessConfiguracion(role: RoleKey): boolean {
  return role === "admin_residencial" || role === "super_admin";
}

export function canAccessUsuarios(role: RoleKey): boolean {
  return role === "admin_residencial" || role === "super_admin";
}
