import { redirect } from "next/navigation";
import { GateFlowLogo } from "@gateflow/ui";
import { destinoDeDecision } from "@/lib/acceso-panel";
import { leerAccesoAdmin } from "@/lib/acceso-servidor";
import { CORREO_SOPORTE, PLANES, type Plan } from "@/lib/planes";
import { CerrarSesionButton } from "../sin-acceso/cerrar-sesion-button";

export const dynamic = "force-dynamic";

/**
 * /suscripcion — destino del admin_residencial cuyo residencial no
 * tiene una suscripción operativa. Exige sesión, pero el middleware no
 * aplica aquí su redirección (lib/rutas-publicas.ts, RUTAS_CUENTA): la
 * página decide con la MISMA lógica (@gateflow/auth/acceso.ts), así que
 * no hay bucle. Si la suscripción está operativa, vuelve al panel.
 * Todavía no cobra: los planes salen de lib/planes.ts.
 */
const TEXTOS = {
  vencida: {
    titulo: "Tu prueba gratuita terminó",
    detalle: "Para seguir usando Gate Flow en tu residencial, elige un plan.",
  },
  inactiva: {
    titulo: "Tu suscripción no está activa",
    detalle: "Para seguir usando Gate Flow en tu residencial, elige un plan.",
  },
} as const;

export default async function SuscripcionPage() {
  const { userId, resultado } = await leerAccesoAdmin();
  if (!userId) redirect("/login?next=/suscripcion");
  // Decisión sobre el residencial SELECCIONADO (gf_tenant).
  const decision = resultado.decision;

  if (decision.tipo !== "suscripcion") {
    redirect(destinoDeDecision(decision) ?? "/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-3xl text-white">
        <div className="flex flex-col items-center text-center">
          <GateFlowLogo size={48} onDark />
          {decision.estado === "sin_suscripcion" ? (
            <>
              <h1 className="font-display mt-6 text-xl font-semibold">No pudimos determinar una suscripción activa para este residencial.</h1>
              <p className="mt-2 max-w-md text-sm text-white/60">
                Es un problema de configuración de la cuenta. Escríbenos a{" "}
                <a href={`mailto:${CORREO_SOPORTE}`} className="text-primary underline">
                  {CORREO_SOPORTE}
                </a>{" "}
                y lo resolvemos.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display mt-6 text-2xl font-semibold">{TEXTOS[decision.estado].titulo}</h1>
              <p className="mt-2 max-w-md text-sm text-white/60">{TEXTOS[decision.estado].detalle}</p>
              <p className="mt-1 max-w-md text-sm text-white/60">Al activarlo, continúas donde lo dejaste.</p>
            </>
          )}
        </div>

        {decision.estado !== "sin_suscripcion" && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {PLANES.map((plan) => (
              <TarjetaPlan key={plan.id} plan={plan} />
            ))}
          </ul>
        )}

        <nav className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/60">
          <CerrarSesionButton />
          <a href={`mailto:${CORREO_SOPORTE}`} className="underline hover:text-white">
            Soporte
          </a>
          <a href="/terminos" className="underline hover:text-white">
            Términos
          </a>
          <a href="/privacidad" className="underline hover:text-white">
            Privacidad
          </a>
        </nav>
      </div>
    </div>
  );
}

function TarjetaPlan({ plan }: { plan: Plan }) {
  return (
    <li data-plan={plan.id} className="flex flex-col rounded-lg border border-white/10 bg-ink-900 p-5">
      <p className="text-sm font-semibold text-white/80">{plan.nombre}</p>
      <p className="mt-3 h-10">
        {plan.precio ? (
          <>
            <span className="text-xs text-white/50">{plan.precio.moneda} </span>
            <span className="font-display text-3xl font-semibold">{plan.precio.monto}</span>
            <span className="text-sm text-white/60"> / {plan.precio.periodo}</span>
          </>
        ) : (
          <span className="font-display text-2xl font-semibold text-primary">Hablemos.</span>
        )}
      </p>
      <div className="mt-5">
        {plan.accion.tipo === "contacto" ? (
          <a
            href={plan.accion.href}
            className="flex h-10 items-center justify-center rounded-md border border-white/20 text-sm font-semibold hover:bg-white/5"
          >
            Contactar
          </a>
        ) : (
          // "proximamente" y, hasta que exista, "checkout": sin acción,
          // nunca simula un cobro.
          <>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="flex h-10 w-full cursor-not-allowed items-center justify-center rounded-md bg-primary/40 text-sm font-semibold text-primary-foreground/80"
            >
              Elegir plan
            </button>
            <p className="mt-2 text-center text-xs text-white/50">Pagos disponibles próximamente</p>
          </>
        )}
      </div>
    </li>
  );
}
