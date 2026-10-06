import { Clock } from "lucide-react";
import type { AvisoTrial as Aviso } from "@gateflow/auth/client";

/**
 * Días restantes del trial (solo admin_residencial, solo trial vigente).
 * Más de 7 días: una línea discreta. 7 o menos: banner. 3 o menos,
 * mañana y hoy: más visible. Nunca bloquea nada.
 */
export function AvisoTrial({ aviso }: { aviso: Aviso | null }) {
  if (!aviso) return null;

  if (aviso.nivel === "discreto") {
    return (
      <p data-aviso-trial="discreto" className="px-4 pt-3 text-right text-xs text-muted-foreground md:px-6">
        {aviso.texto}
      </p>
    );
  }

  const urgente = aviso.nivel !== "banner";
  return (
    <div
      role="status"
      data-aviso-trial={aviso.nivel}
      className={
        urgente
          ? "flex items-center gap-2 border-b border-warn/40 bg-warn/15 px-4 py-2.5 text-sm font-semibold text-warn-foreground md:px-6"
          : "flex items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2 text-sm text-foreground md:px-6"
      }
    >
      <Clock className="h-4 w-4 shrink-0" />
      <span>{aviso.texto}</span>
    </div>
  );
}
