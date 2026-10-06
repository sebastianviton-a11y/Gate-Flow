import { ShieldAlert } from "lucide-react";
import { GateFlowLogo } from "@gateflow/ui";
import { urlAppGuard } from "@/lib/acceso-panel";
import { leerAccesoAdmin } from "@/lib/acceso-servidor";
import { CerrarSesionButton } from "./cerrar-sesion-button";

/**
 * Destino de quien tiene sesión pero no puede usar el panel: sin
 * residencial activo, con un rol que no es de administración (guardia)
 * o cuando no se pudo validar la membresía. Pública y sin
 * getSessionContext a propósito: nunca redirige, así que no puede
 * entrar en bucle. Con motivo=rol solo lee la membresía del residencial
 * SELECCIONADO (gf_tenant) para ofrecer "Ir a la app de Guardia" a un
 * guardia real; ante cualquier error, no lo ofrece.
 */
async function esGuardiaConAccesoAGuard(motivo: string | undefined): Promise<boolean> {
  if (motivo !== "rol") return false;
  try {
    const { userId, resultado } = await leerAccesoAdmin();
    return userId !== null && resultado.decision.tipo === "ir_a_guard";
  } catch {
    return false;
  }
}
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

export default async function SinAccesoPage({ searchParams }: { searchParams: { motivo?: string } }) {
  const mensaje = MENSAJES[searchParams.motivo ?? ""] ?? SIN_RESIDENCIAL;
  const urlGuard = urlAppGuard();
  const ctaGuard = urlGuard !== null && (await esGuardiaConAccesoAGuard(searchParams.motivo));

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
        {ctaGuard && (
          <a
            href={`${urlGuard}/guard`}
            className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Ir a la app de Guardia
          </a>
        )}
        <CerrarSesionButton />
      </div>
    </div>
  );
}
