import { ShieldAlert } from "lucide-react";
import { GateFlowLogo } from "@gateflow/ui";
import { CerrarSesionButton } from "./cerrar-sesion-button";

/**
 * Destino de quien tiene sesión pero no tiene un residencial activo.
 * Pública y sin getSessionContext a propósito: nunca puede entrar en
 * bucle.
 */
export default function SinAccesoPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
        <GateFlowLogo size={48} onDark />
        <ShieldAlert className="mt-4 h-10 w-10 text-warn" />
        <p className="font-display text-lg font-semibold">Tu cuenta no tiene un residencial activo</p>
        <p className="text-sm text-white/60">Pide al administrador de tu residencial que te invite o reactive tu acceso.</p>
        <CerrarSesionButton />
      </div>
    </div>
  );
}
