import { ShieldAlert } from "lucide-react";
import type { SessionContext } from "@gateflow/types";
import { salirModoSoporte } from "@/app/superadmin/soporte-actions";

/**
 * Nunca se oculta silenciosamente — mismo principio que DemoSessionBanner:
 * si un super_admin está viendo los datos de un residencial ajeno, eso
 * debe ser obvio en todo momento, no solo quedar en el audit_log.
 */
export function SoporteBanner({ session }: { session: SessionContext }) {
  if (!session.impersonando) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn-foreground">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>
          Modo soporte — viendo <strong>{session.tenant.nombre}</strong> como {session.tenantReal?.nombre ?? "Super Admin"}.
        </span>
      </div>
      <form action={salirModoSoporte}>
        <button type="submit" className="shrink-0 font-medium underline">
          Salir de modo soporte
        </button>
      </form>
    </div>
  );
}
