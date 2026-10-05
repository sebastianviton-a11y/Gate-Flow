import { ShieldAlert } from "lucide-react";
import { GateFlowLogo } from "@gateflow/ui";
import { CerrarSesionButton } from "./cerrar-sesion-button";

/**
 * Destino de quien tiene sesión pero no puede usar el panel: sin
 * residencial activo, con un rol que no es de administración (guardia)
 * o cuando no se pudo validar la membresía. Pública y sin
 * getSessionContext a propósito: nunca puede entrar en bucle.
 */
const SIN_RESIDENCIAL = {
  titulo: "Tu cuenta no tiene un residencial activo",
  detalle: "Pide al administrador de tu residencial que te invite o reactive tu acceso.",
};

const MENSAJES: Record<string, { titulo: string; detalle: string }> = {
  rol: {
    titulo: "Esta cuenta no tiene acceso al panel de administración",
    detalle: "El personal de portería usa la app de guardia. Si crees que es un error, contacta al administrador de tu residencial.",
  },
  error: {
    titulo: "No pudimos validar tu acceso",
    detalle: "Intenta de nuevo en unos segundos. Si el problema continúa, escribe a soporte@gateflow.mx.",
  },
};

export default function SinAccesoPage({ searchParams }: { searchParams: { motivo?: string } }) {
  const mensaje = MENSAJES[searchParams.motivo ?? ""] ?? SIN_RESIDENCIAL;

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
        <GateFlowLogo size={48} onDark />
        <ShieldAlert className="mt-4 h-10 w-10 text-warn" />
        <p className="font-display text-lg font-semibold">{mensaje.titulo}</p>
        <p className="text-sm text-white/60">{mensaje.detalle}</p>
        {searchParams.motivo === "error" && (
          <a href="/dashboard" className="text-sm text-primary/80 underline hover:text-primary">
            Reintentar
          </a>
        )}
        <CerrarSesionButton />
      </div>
    </div>
  );
}
