import type { NavItem, RoleKey } from "@gateflow/types";

/**
 * Fuente única de navegación. Nunca se hardcodean links de sidebar en otro
 * lugar del código — cualquier pantalla nueva se agrega aquí (CLAUDE.md §6:
 * no crear un segundo mecanismo paralelo de algo que ya existe).
 *
 * Residentes, Incidencias y Usuarios volvieron al menú (recorrido de
 * prelanzamiento, hallazgos #1-#3) — la nota de v0.2 que las quitaba por
 * estar vacías quedó obsoleta: las tres son pantallas funcionales desde
 * los sprints de estabilización y de paquetes/incidencias. Ocultar algo
 * que ya funciona es peor que mostrarlo — un administrador no puede
 * encontrar lo que ya usó desde el asistente de onboarding.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/paquetes", label: "Paquetes", icon: "Package" },
  { href: "/unidades", label: "Unidades", icon: "Building2" },
  { href: "/residentes", label: "Residentes", icon: "Users", roles: ["admin_residencial", "super_admin"] },
  { href: "/incidencias", label: "Incidencias", icon: "TriangleAlert" },
  { href: "/usuarios", label: "Usuarios", icon: "UserCog", roles: ["admin_residencial", "super_admin"] },
  { href: "/configuracion", label: "Configuración", icon: "Settings", roles: ["admin_residencial", "super_admin"] },
  { href: "/superadmin", label: "Super Admin", icon: "ShieldCheck", roles: ["super_admin"] },
];

export function navItemsForRole(role: RoleKey): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}
