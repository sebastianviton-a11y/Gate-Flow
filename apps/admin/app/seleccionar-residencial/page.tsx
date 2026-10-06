import { redirect } from "next/navigation";
import { Building } from "lucide-react";
import { ROLE_LABELS, nombreTenantDeFila, opcionesSeleccion, rolDeFila } from "@gateflow/auth";
import type { RoleKey } from "@gateflow/types";
import { GateFlowLogo } from "@gateflow/ui";
import { destinoDeDecision } from "@/lib/acceso-panel";
import { leerAccesoAdmin } from "@/lib/acceso-servidor";
import { CerrarSesionButton } from "../sin-acceso/cerrar-sesion-button";
import { elegirResidencialAdmin } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Elegir residencial (usuarios con más de una membresía activa, o con
 * una gf_tenant que ya no corresponde a una membresía activa). Exige
 * sesión; el middleware no la redirige (RUTAS_CUENTA). Lista solo
 * membresías activas con rol de Admin o de guardia.
 */
export default async function SeleccionarResidencialPage() {
  const { userId, filas, resultado } = await leerAccesoAdmin();
  if (!userId) redirect("/login?next=/seleccionar-residencial");

  if (resultado.decision.tipo === "sin_acceso" && resultado.decision.motivo === "error") {
    redirect("/sin-acceso?motivo=error");
  }

  const opciones = opcionesSeleccion(filas, "admin");
  if (opciones.length === 0) {
    redirect(destinoDeDecision(resultado.decision) ?? "/sin-acceso");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-md text-white">
        <div className="flex flex-col items-center text-center">
          <GateFlowLogo size={48} onDark />
          <h1 className="font-display mt-6 text-xl font-semibold">Elige un residencial</h1>
          <p className="mt-2 text-sm text-white/60">Tu cuenta tiene acceso a más de un residencial.</p>
        </div>

        <ul className="mt-8 space-y-3">
          {opciones.map((fila) => {
            const rol = rolDeFila(fila);
            return (
              <li key={fila.tenant_id}>
                <form action={elegirResidencialAdmin}>
                  <input type="hidden" name="tenant_id" value={fila.tenant_id} />
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-ink-900 px-4 py-3 text-left hover:border-primary/60 hover:bg-white/5"
                  >
                    <Building className="h-5 w-5 shrink-0 text-white/50" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{nombreTenantDeFila(fila)}</span>
                      <span className="block text-xs text-white/50">{rol ? ROLE_LABELS[rol as RoleKey] ?? rol : ""}</span>
                    </span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>

        <div className="mt-8 flex justify-center">
          <CerrarSesionButton />
        </div>
      </div>
    </div>
  );
}
