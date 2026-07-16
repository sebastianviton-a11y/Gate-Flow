import { TriangleAlert } from "lucide-react";
import type { SessionContext } from "@gateflow/types";

const REASON_LABEL: Record<NonNullable<SessionContext["demoReason"]>, string> = {
  schema_not_migrated:
    "Las tablas del núcleo (tenants, user_tenants, roles) todavía no existen en este proyecto Supabase.",
  no_membership_row:
    "Tu usuario de Supabase Auth no tiene todavía una fila en user_tenants.",
  unexpected_error:
    "Ocurrió un error inesperado al resolver tu tenant — revisa la consola del servidor, esto NO es el caso esperado de esquema sin migrar.",
};

/**
 * Nunca se oculta silenciosamente: si la sesión es demo, esto se muestra
 * siempre en la parte superior del contenido (CLAUDE.md: la evidencia
 * reemplaza a la memoria — aquí, el estado visible reemplaza a la duda).
 */
export function DemoSessionBanner({ session }: { session: SessionContext }) {
  if (!session.isDemo) return null;

  const isUnexpected = session.demoReason === "unexpected_error";

  return (
    <div
      className={
        isUnexpected
          ? "flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive md:px-6"
          : "flex items-start gap-2 border-b border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn-foreground md:px-6"
      }
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <strong>Sesión de demostración (Sprint 01).</strong>{" "}
        {session.demoReason ? REASON_LABEL[session.demoReason] : null}
      </p>
    </div>
  );
}
