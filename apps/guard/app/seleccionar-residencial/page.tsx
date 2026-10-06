import { redirect } from "next/navigation";
import { Building } from "lucide-react";
import { ROLE_LABELS, nombreTenantDeFila, opcionesSeleccion, rolDeFila } from "@gateflow/auth";
import type { RoleKey } from "@gateflow/types";
import { GateFlowLogo } from "@gateflow/ui";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { leerAccesoGuard } from "@/lib/acceso-guard";
import { CerrarSesionButton } from "../sin-acceso/cerrar-sesion-button";
import { elegirResidencialGuard } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Elegir residencial en Guard: solo membresías activas con un rol que
 * opera en Guard. Fuera de app/guard/ para no heredar su layout.
 */
export default async function SeleccionarResidencialPage() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { filas, resultado } = await leerAccesoGuard(user.id);
  if (resultado.decision.tipo === "sin_acceso" && resultado.decision.motivo === "error") {
    redirect("/sin-acceso");
  }

  const opciones = opcionesSeleccion(filas, "guard");
  if (opciones.length === 0) redirect("/sin-acceso");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-sm text-white">
        <div className="flex flex-col items-center text-center">
          <GateFlowLogo size={48} onDark />
          <h1 className="font-display mt-6 text-lg font-semibold">¿En qué residencial estás hoy?</h1>
        </div>

        <ul className="mt-6 space-y-3">
          {opciones.map((fila) => {
            const rol = rolDeFila(fila);
            return (
              <li key={fila.tenant_id}>
                <form action={elegirResidencialGuard}>
                  <input type="hidden" name="tenant_id" value={fila.tenant_id} />
                  <button
                    type="submit"
                    className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left hover:border-primary/60"
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
