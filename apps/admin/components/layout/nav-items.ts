import type { NavItem, RoleKey } from "@gateflow/types";

/**
 * Fuente única de navegación. Nunca se hardcodean links de sidebar en otro
 * lugar del código — cualquier pantalla nueva se agrega aquí (CLAUDE.md §6:
 * no crear un segundo mecanismo paralelo de algo que ya existe).
 *
 * v0.2 (UX_REVIEW.md §1): se quitaron Incidencias, Residentes y Usuarios
 * del menú — no por eliminarlas del producto, sino porque mostrar una
 * pantalla vacía "conectada después" transmite lo opuesto de "listo para
 * usarse". Residentes además es redundante: su información ya vive dentro
 * de Unidades. Las rutas siguen existiendo, solo no están en el menú.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/paquetes", label: "Paquetes", icon: "Package" },
  { href: "/unidades", label: "Unidades", icon: "Building2" },
  { href: "/configuracion", label: "Configuración", icon: "Settings", roles: ["admin_residencial", "super_admin"] },
];

export function navItemsForRole(role: RoleKey): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}
