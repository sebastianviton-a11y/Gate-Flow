import { redirect } from "next/navigation";
import { GateFlowLogo } from "@gateflow/ui";
import { destinoDeDecision } from "@/lib/acceso-panel";
import { leerAccesoAdmin } from "@/lib/acceso-servidor";
import { EsperaConfirmacion } from "./espera-confirmacion";

export const dynamic = "force-dynamic";

/**
 * Destino de success_url del checkout. NO activa nada ni escribe nada:
 * volver de Stripe no prueba un pago. Solo consulta el estado del
 * residencial seleccionado; la activación la hace el webhook verificado
 * (billing_aplicar_evento). Cuando la suscripción está activa, al panel.
 * El parámetro ?c=<checkout> es informativo: no se usa como autoridad.
 */
export default async function ProcesandoPage() {
  const { userId, resultado } = await leerAccesoAdmin();
  if (!userId) redirect("/login?next=/suscripcion");
  const decision = resultado.decision;
  if (decision.tipo === "permitir" && decision.estado === "activa") redirect("/dashboard");
  if (decision.tipo !== "permitir" && decision.tipo !== "suscripcion") redirect(destinoDeDecision(decision) ?? "/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center text-center text-white">
        <GateFlowLogo size={48} onDark />
        <h1 className="font-display mt-6 text-2xl font-semibold">Confirmando tu pago…</h1>
        <p className="mt-2 text-sm text-white/60">
          Estamos esperando la confirmación del pago. Suele tardar unos segundos; puedes dejar esta pantalla abierta.
        </p>
        <EsperaConfirmacion />
        <a href="/suscripcion" className="mt-8 text-sm text-white/60 underline hover:text-white">
          Volver a Suscripción
        </a>
      </div>
    </div>
  );
}
