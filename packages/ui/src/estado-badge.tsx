import type { EstadoPaquete } from "@gateflow/types";
import { Badge } from "./badge";

const ESTADO_CONFIG: Record<EstadoPaquete, { label: string; variant: "default" | "warn" | "success" | "destructive" | "secondary" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  recibido: { label: "Recibido", variant: "default" },
  notificado: { label: "Notificado", variant: "warn" },
  entregado: { label: "Entregado", variant: "success" },
  rechazado: { label: "Rechazado", variant: "destructive" },
  devuelto: { label: "Devuelto", variant: "secondary" },
};

export function EstadoBadge({ estado }: { estado: EstadoPaquete }) {
  const config = ESTADO_CONFIG[estado];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
