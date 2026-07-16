"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Package } from "lucide-react";
import { GateFlowLogo } from "@gateflow/ui";
import type { RoleKey } from "@gateflow/types";
import { navItemsForRole } from "./nav-items";
import { NAV_ICONS } from "./nav-icons";
import { cn } from "@gateflow/ui";

/**
 * Reemplaza al Sidebar (oculto por debajo de `md`) para que la navegación
 * siga siendo completa en móvil. Accesibilidad mínima de un overlay modal:
 * Escape cierra, el foco se mueve al botón de cierre al abrir y regresa
 * al trigger al cerrar.
 */
export function MobileNav({ role }: { role: RoleKey }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const items = navItemsForRole(role);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir navegación"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Navegación">
          <button type="button" aria-label="Cerrar navegación" onClick={close} className="flex-1 bg-black/40" />
          <div className="flex w-72 max-w-[80vw] flex-col bg-ink-950 text-white">
            <div className="flex h-16 items-center justify-between px-5">
              <GateFlowLogo size={26} withWordmark onDark />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="Cerrar"
                className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 space-y-0.5 px-3 py-2">
              {items.map((item) => {
                const Icon = NAV_ICONS[item.icon] ?? Package;
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white",
                      active && "bg-white/10 text-white",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
