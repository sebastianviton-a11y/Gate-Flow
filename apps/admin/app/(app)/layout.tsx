import { redirect } from "next/navigation";
import { getSessionContext } from "@gateflow/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { SoporteBanner } from "@/components/layout/soporte-banner";
import { AvisoTrial } from "@/components/layout/aviso-trial";
import { destinoDeDecision } from "@/lib/acceso-panel";
import { leerAccesoAdmin } from "@/lib/acceso-servidor";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();

  // Defensivo: el middleware ya protege estas rutas, pero un layout de
  // servidor nunca debe asumir que el contexto llegó completo (BR-01/BR-02).
  if (!session) {
    redirect("/login");
  }

  // Misma lectura y misma decisión que el middleware: membresía del
  // residencial seleccionado (gf_tenant), nunca una fila arbitraria.
  // Redundante a propósito: el layout no asume que el middleware corrió.
  // "onboarding" pasa: el middleware ya lleva a /onboarding a quien lo
  // tiene pendiente.
  const { resultado } = await leerAccesoAdmin();
  const decision = resultado.decision;
  if (decision.tipo !== "permitir" && decision.tipo !== "onboarding") {
    redirect(destinoDeDecision(decision) ?? "/sin-acceso?motivo=error");
  }
  // La sesión y la decisión deben hablar del MISMO residencial (salvo
  // super_admin, cuyo modo soporte cambia session.tenant a propósito).
  if (!session.impersonando && resultado.tenantId !== session.tenant.id) {
    redirect("/sin-acceso?motivo=error");
  }

  // El aviso de días restantes es para quien administra el residencial
  // (nunca en modo soporte: no es el trial de quien mira).
  const aviso = decision.tipo === "permitir" && decision.rol === "admin_residencial" && !session.impersonando ? decision.aviso : null;

  return (
    <div className="flex min-h-screen bg-muted/40">
      <Sidebar role={session.role} logoUrl={session.tenant.logoUrl} nombreTenant={session.tenant.nombre} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header session={session} />
        <SoporteBanner session={session} />
        <AvisoTrial aviso={aviso} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
