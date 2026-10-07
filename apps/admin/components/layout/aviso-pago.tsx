import { AlertTriangle, CalendarClock } from "lucide-react";
import type { AvisoPago as Aviso } from "@gateflow/auth/client";

/**
 * Billing (solo admin_residencial; Guard no lo muestra):
 *   gracia       banner fuerte: no se pudo cobrar, el servicio sigue
 *                hasta el fin de la gracia
 *   cancelacion  línea discreta: cancelada, activa hasta el fin del periodo
 */
export function AvisoPago({ aviso }: { aviso: Aviso | null }) {
  if (!aviso) return null;
  if (aviso.nivel === "cancelacion") {
    return (
      <p data-aviso-pago="cancelacion" className="flex items-center justify-end gap-1.5 px-4 pt-3 text-xs text-muted-foreground md:px-6">
        <CalendarClock className="h-3.5 w-3.5" />
        <span>{aviso.texto}</span>
        <a href="/suscripcion" className="underline">
          Ver suscripción
        </a>
      </p>
    );
  }
  return (
    <div
      role="alert"
      data-aviso-pago="gracia"
      className="flex flex-wrap items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive md:px-6"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{aviso.texto}</span>
      <a href="/suscripcion" className="underline">
        Actualizar método de pago
      </a>
    </div>
  );
}
