import {
  LayoutDashboard,
  Package,
  TriangleAlert,
  Users,
  Building2,
  UserCog,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

/**
 * Única fuente de verdad para el mapeo string → ícono usado por NavItem.
 * Antes vivía duplicado, idéntico, en sidebar.tsx y mobile-nav.tsx —
 * cualquier ícono nuevo se agregaba en dos lugares o se desincronizaba.
 */
export const NAV_ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Package,
  TriangleAlert,
  Users,
  Building2,
  UserCog,
  Settings,
  ShieldCheck,
};
