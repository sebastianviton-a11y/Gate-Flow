import { Circle, Package, Bell, Check, X, Undo2 } from "lucide-react";
import type { EstadoPaquete } from "@gateflow/types";
import { cn } from "./utils";

/**
 * Principio de diseño: el COLOR codifica la macro-fase (gris = todavía
 * no entra al sistema, azul = en proceso, verde = completado, rojo = no
 * se completó bien), y el ÍCONO codifica el estado específico dentro de
 * esa fase. Por eso "recibido" y "notificado" comparten el mismo azul
 * (los dos son "en proceso, sin resolver todavía") pero se distinguen
 * por ícono — igual que "rechazado" y "devuelto" comparten rojo. Esto
 * es intencional, no un descuido: revertir el bug real (recibido y
 * entregado compartían el mismo verde) sin caer en darle un color único
 * a cada uno de los 6 estados, que sería ruido visual innecesario.
 *
 * Todos comparten exactamente el mismo alto, padding, radio, tipografía
 * y peso — solo cambian color de fondo/texto e ícono.
 */
const ESTADO_CONFIG: Record<EstadoPaquete, { label: string; className: string; Icon: typeof Circle }> = {
  pendiente: { label: "Pendiente", className: "bg-muted-foreground/10 text-muted-foreground", Icon: Circle },
  recibido: { label: "Recibido", className: "bg-info/10 text-info", Icon: Package },
  notificado: { label: "Notificado", className: "bg-info/10 text-info", Icon: Bell },
  entregado: { label: "Entregado", className: "bg-success/10 text-success", Icon: Check },
  rechazado: { label: "Rechazado", className: "bg-destructive/10 text-destructive", Icon: X },
  devuelto: { label: "Devuelto", className: "bg-destructive/10 text-destructive", Icon: Undo2 },
};

export function EstadoBadge({ estado }: { estado: EstadoPaquete }) {
  const { label, className, Icon } = ESTADO_CONFIG[estado];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium", className)}>
      <Icon className="h-3 w-3" strokeWidth={2.25} />
      {label}
    </span>
  );
}
