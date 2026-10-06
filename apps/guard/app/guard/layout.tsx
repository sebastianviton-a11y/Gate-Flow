import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getSessionContext, RUTA_SELECCIONAR_RESIDENCIAL, SesionNoResueltaError } from "@gateflow/auth";
import type { RoleKey } from "@gateflow/types";
import { GuardShell } from "@/components/guard-shell";
import { GuardSessionProvider } from "@/components/session-provider";
import { RUTA_SERVICIO_INACTIVO, esServicioInactivo, leerAccesoGuard } from "@/lib/acceso-guard";

// Roles que pueden operar esta app. `residente` queda explícitamente
// fuera — no tiene experiencia operativa en GateFlow (00-PRD.md: el
// portal de residente está fuera del alcance del MVP). admin_residencial
// y super_admin entran también, para poder cubrir o probar el flujo de
// portería sin necesitar una segunda cuenta.
const OPERATIONAL_ROLES: RoleKey[] = ["guardia", "admin_residencial", "super_admin"];

export default async function GuardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();

  if (!session) {
    redirect("/login");
  }

  // Residencial no operativo (suspendido, trial vencido, suscripción
  // inactiva o sin suscripción): ninguna función de guardia. Misma
  // lógica que Admin (@gateflow/auth/acceso.ts). Los datos además están
  // protegidos en la base (tenant_operativo). super_admin no se bloquea.
  const { resultado } = await leerAccesoGuard(session.user.id);
  const decision = resultado.decision;
  if (decision.tipo === "sin_acceso" && decision.motivo === "error") {
    throw new SesionNoResueltaError();
  }
  if (decision.tipo === "seleccionar_residencial") {
    redirect(RUTA_SELECCIONAR_RESIDENCIAL);
  }
  if (esServicioInactivo(decision)) {
    redirect(RUTA_SERVICIO_INACTIVO);
  }
  // La sesión y la decisión deben hablar del MISMO residencial (misma
  // gf_tenant); si no, falla cerrado.
  if (resultado.tenantId !== session.tenant.id && !session.impersonando) {
    throw new SesionNoResueltaError();
  }

  if (!OPERATIONAL_ROLES.includes(session.role)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="h-6 w-6 text-destructive" />
        </span>
        <div>
          <h1 className="font-display text-lg font-semibold">Esta aplicación es para portería</h1>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Tu cuenta no tiene un rol operativo (guardia/administrador). Si crees que esto es un
            error, contacta al administrador de tu residencial.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <GuardShell session={session} />
      <GuardSessionProvider session={session}>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </GuardSessionProvider>
    </div>
  );
}
