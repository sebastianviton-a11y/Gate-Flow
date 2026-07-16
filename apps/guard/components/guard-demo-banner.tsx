import { TriangleAlert } from "lucide-react";
import type { SessionContext } from "@gateflow/types";

const REASON_LABEL: Record<NonNullable<SessionContext["demoReason"]>, string> = {
  schema_not_migrated: "Tablas del núcleo sin migrar en este proyecto Supabase.",
  no_membership_row: "Tu usuario no tiene fila en user_tenants todavía.",
  unexpected_error: "Error inesperado al resolver tu tenant — revisa la consola del servidor.",
};

/**
 * Mismo principio que apps/admin/components/layout/demo-session-banner.tsx
 * (nunca se oculta), en formato compacto acorde a la densidad operativa
 * de esta app — no se duplicó el componente completo de admin porque su
 * layout (franja ancha con texto largo) no encaja en una barra de estado
 * de 14px de alto pensada para pantallas de guardia.
 */
export function GuardDemoBanner({ session }: { session: SessionContext }) {
  if (!session.isDemo) return null;

  const isUnexpected = session.demoReason === "unexpected_error";

  return (
    <div
      className={
        isUnexpected
          ? "flex items-center gap-2 bg-destructive/10 px-4 py-1.5 text-xs text-destructive"
          : "flex items-center gap-2 bg-warn/10 px-4 py-1.5 text-xs text-warn-foreground"
      }
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        Modo demo — {session.demoReason ? REASON_LABEL[session.demoReason] : null}
      </span>
    </div>
  );
}
