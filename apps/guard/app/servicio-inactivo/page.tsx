import { PauseCircle } from "lucide-react";
import { GateFlowLogo } from "@gateflow/ui";
import { CerrarSesionButton } from "../sin-acceso/cerrar-sesion-button";

/**
 * Residencial no operativo (suspendido, prueba vencida, suscripción
 * inactiva o sin suscripción). Pública y sin consultas, igual que
 * /sin-acceso: nunca entra en bucle. Sin precios ni cobros: el guardia
 * no gestiona la suscripción.
 */
export default function ServicioInactivoPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
        <GateFlowLogo size={48} onDark />
        <PauseCircle className="mt-4 h-10 w-10 text-warn" />
        <p className="font-display text-lg font-semibold">El servicio de este residencial no está activo.</p>
        <p className="text-sm text-white/60">Contacta al administrador del residencial.</p>
        <CerrarSesionButton />
      </div>
    </div>
  );
}
