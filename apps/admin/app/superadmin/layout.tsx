import { redirect } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Building2, LogOut } from "lucide-react";
import { getSessionContext, requireRole } from "@gateflow/auth";
import { GateFlowLogo } from "@gateflow/ui";

/**
 * A propósito NO reutiliza apps/admin/components/layout/Sidebar — ese
 * componente está diseñado para un residencial (nav de Paquetes,
 * Unidades, Configuración...), y mezclarlo aquí sería exactamente lo
 * que la especificación pide evitar ("debe vivir separado del panel
 * del residencial"). Vive fuera de app/(app)/, así que no hereda el
 * layout ni el guard de sesión de esa carpeta — este archivo tiene los
 * suyos propios.
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  // Ojo: si session.impersonando fuera true aquí, el rol efectivo ya
  // sería admin_residencial (por diseño, ver get-session.ts) — un
  // super_admin en modo soporte no puede estar simultáneamente dentro
  // de /superadmin, tiene que salir del modo soporte primero. Correcto:
  // evita el caso confuso de "soportar a X mientras administro la
  // plataforma completa" al mismo tiempo.
  requireRole(session, ["super_admin"]);

  return (
    <div className="flex min-h-screen bg-muted/40">
      <aside className="hidden w-60 shrink-0 flex-col bg-ink-950 text-white md:flex">
        <div className="flex h-16 items-center gap-2 px-6">
          <GateFlowLogo size={26} onDark />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Super Admin</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          <Link href="/superadmin" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white">
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Link>
          <Link
            href="/superadmin/residenciales"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
          >
            <Building2 className="h-4 w-4" />
            Residenciales
          </Link>
        </nav>
        <div className="border-t border-white/10 px-3 py-4">
          <Link href="/dashboard" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-white/50 hover:bg-white/5 hover:text-white">
            <LogOut className="h-4 w-4" />
            Salir a mi panel
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </div>
  );
}
