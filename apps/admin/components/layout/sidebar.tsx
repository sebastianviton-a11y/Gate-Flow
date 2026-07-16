"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package } from "lucide-react";
import { GateFlowLogo } from "@gateflow/ui";
import type { NavItem, RoleKey } from "@gateflow/types";
import { navItemsForRole } from "./nav-items";
import { NAV_ICONS } from "./nav-icons";
import { cn } from "@gateflow/ui";

export function Sidebar({ role }: { role: RoleKey }) {
  const pathname = usePathname();
  const items = navItemsForRole(role);

  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-ink-950 text-white md:flex">
      <div className="flex h-16 items-center px-6">
        <GateFlowLogo size={30} withWordmark onDark />
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {items.map((item) => (
          <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
        ))}
      </nav>

      <div className="px-6 py-4 text-xs text-white/40">
        <p>GateFlow · Sprint 01</p>
      </div>
    </aside>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = NAV_ICONS[item.icon] ?? Package;

  return (
    <Link
      href={item.href}
      className={cn(
        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white",
        active && "bg-white/10 text-white",
      )}
    >
      {/* Marca de "gate bar" — el signature element del layout: el ítem activo
          se distingue por una barra sólida, no por un fondo genérico. */}
      <span
        className={cn(
          "absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-primary opacity-0 transition-opacity",
          active && "opacity-100",
        )}
      />
      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
      <span>{item.label}</span>
    </Link>
  );
}
