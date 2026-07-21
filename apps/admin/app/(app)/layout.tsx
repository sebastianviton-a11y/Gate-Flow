import { redirect } from "next/navigation";
import { getSessionContext } from "@gateflow/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { DemoSessionBanner } from "@/components/layout/demo-session-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();

  // Defensivo: el middleware ya protege estas rutas, pero un layout de
  // servidor nunca debe asumir que el contexto llegó completo (BR-01/BR-02).
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      <Sidebar role={session.role} logoUrl={session.tenant.logoUrl} nombreTenant={session.tenant.nombre} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header session={session} />
        <DemoSessionBanner session={session} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
