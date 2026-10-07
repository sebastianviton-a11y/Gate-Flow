import { redirect } from "next/navigation";
import { GateFlowLogo } from "@gateflow/ui";
import { obtenerSuscripcion } from "@gateflow/paquetes";
import { createServerSupabaseClient } from "@gateflow/supabase";
import type { Suscripcion } from "@gateflow/types";
import { destinoDeDecision } from "@/lib/acceso-panel";
import { leerAccesoAdmin } from "@/lib/acceso-servidor";
import { autorizarBilling, permiteAlta } from "@/lib/billing/autorizacion";
import { viviendasRequeridas } from "@/lib/billing/catalogo";
import { checkoutDisponible, gestionDisponible } from "@/lib/billing/servidor";
import { CORREO_SOPORTE, PLANES, type Plan } from "@/lib/planes";
import { CerrarSesionButton } from "../sin-acceso/cerrar-sesion-button";
import { administrarSuscripcionAction, elegirPlanAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * /suscripcion — exige sesión; el middleware no aplica aquí su
 * redirección (lib/rutas-publicas.ts, RUTAS_CUENTA): la página decide
 * con la MISMA lógica (@gateflow/auth/acceso.ts) sobre el residencial
 * SELECCIONADO (gf_tenant), así que no hay bucle.
 *
 *   bloqueada (vencida / inactiva)  planes y "Elegir plan" (checkout
 *                                   hospedado); tras un cobro fallido con
 *                                   la gracia agotada: actualizar tarjeta
 *   operativa (admin_residencial)   gestión: trial (sin cobro), activa,
 *                                   cancelación pendiente o gracia
 * La página no escribe nada: el alta la hace la server action y la
 * activación SOLO el webhook verificado.
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

const ERRORES: Record<string, string> = {
  viviendas: "Ese plan no cubre las viviendas de tu residencial. Elige un plan mayor.",
  contacto: "Para más de 150 viviendas, escríbenos y te ayudamos con tu plan.",
  plan: "El plan elegido no es válido.",
  rol: "Solo el administrador del residencial puede gestionar la suscripción.",
  estado: "Tu suscripción no necesita un pago nuevo en este momento.",
  suspendido: "El residencial está suspendido. Escríbenos a soporte.",
  limite: "Demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.",
  proveedor: "No pudimos abrir el pago en este momento. Inténtalo de nuevo en unos minutos.",
  configuracion: "Los pagos en línea no están disponibles por ahora. Escríbenos a soporte.",
  gestion: "No pudimos abrir la administración de tu suscripción. Inténtalo de nuevo o escríbenos a soporte.",
  error: "Algo salió mal. Inténtalo de nuevo o escríbenos a soporte.",
};

function fecha(iso: string | null, zona: string): string {
  if (!iso) return "—";
  const formato = (z: string) => new Intl.DateTimeFormat("es-MX", { timeZone: z, day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
  try {
    return formato(zona);
  } catch {
    return formato("America/Mexico_City");
  }
}

async function datosResidencial(tenantId: string): Promise<{ suscripcion: Suscripcion | null; viviendas: number }> {
  const supabase = createServerSupabaseClient();
  const [suscripcion, { count }] = await Promise.all([
    obtenerSuscripcion(supabase, tenantId),
    supabase.from("unidades").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("activo", true),
  ]);
  return { suscripcion, viviendas: viviendasRequeridas(suscripcion?.viviendasDeclaradas, count ?? 0) };
}

export default async function SuscripcionPage({ searchParams }: { searchParams: { error?: string } }) {
  const { userId, resultado } = await leerAccesoAdmin();
  if (!userId) redirect("/login?next=/suscripcion");
  // Decisión sobre el residencial SELECCIONADO (gf_tenant).
  const decision = resultado.decision;
  const autorizacion = autorizarBilling(userId, resultado);

  if (decision.tipo === "permitir") {
    // Operativo: solo quien administra el residencial ve la gestión.
    if (!autorizacion.ok) redirect("/dashboard");
  } else if (decision.tipo !== "suscripcion") {
    redirect(destinoDeDecision(decision) ?? "/dashboard");
  }

  const zona =
    resultado.seleccion.tipo === "resuelta"
      ? ((resultado.seleccion.membresia.tenants as { timezone?: string | null } | null)?.timezone ?? "America/Mexico_City")
      : "America/Mexico_City";
  const { suscripcion, viviendas } = autorizacion.ok ? await datosResidencial(autorizacion.tenantId) : { suscripcion: null, viviendas: 0 };
  const error = searchParams.error ? (ERRORES[searchParams.error] ?? ERRORES.error) : null;
  const gestion = gestionDisponible() && Boolean(suscripcion?.tieneClienteProveedor);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-3xl text-white">
        <div className="flex flex-col items-center text-center">
          <GateFlowLogo size={48} onDark />
          {error && (
            <p role="alert" className="mt-6 max-w-md rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
              {error}
            </p>
          )}

          {decision.tipo === "permitir" ? (
            <VistaGestion estado={decision.estado} suscripcion={suscripcion} zona={zona} gestion={gestion} />
          ) : decision.estado === "sin_suscripcion" ? (
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
          ) : suscripcion?.estado === "past_due" ? (
            <>
              <h1 className="font-display mt-6 text-2xl font-semibold">No pudimos cobrar tu suscripción</h1>
              <p className="mt-2 max-w-md text-sm text-white/60">
                Terminó el periodo de gracia. Actualiza tu método de pago para reactivar el servicio; al hacerlo, continúas donde lo dejaste.
              </p>
              <BotonGestion disponible={gestion} texto="Actualizar método de pago" />
            </>
          ) : (
            <>
              <h1 className="font-display mt-6 text-2xl font-semibold">{TEXTOS[decision.estado].titulo}</h1>
              <p className="mt-2 max-w-md text-sm text-white/60">{TEXTOS[decision.estado].detalle}</p>
              <p className="mt-1 max-w-md text-sm text-white/60">Al activarlo, continúas donde lo dejaste.</p>
            </>
          )}
        </div>

        {decision.tipo === "suscripcion" && decision.estado !== "sin_suscripcion" && suscripcion?.estado !== "past_due" && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {PLANES.map((plan) => (
              <TarjetaPlan
                key={plan.id}
                plan={plan}
                viviendas={viviendas}
                comprable={autorizacion.ok && permiteAlta(resultado) && checkoutDisponible()}
              />
            ))}
          </ul>
        )}

        {decision.tipo === "permitir" && suscripcion?.estado === "trialing" && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {PLANES.map((plan) => (
              <TarjetaPlan key={plan.id} plan={plan} viviendas={viviendas} comprable={false} enTrial />
            ))}
          </ul>
        )}

        <nav className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/60">
          {decision.tipo === "permitir" && (
            <a href="/dashboard" className="underline hover:text-white">
              Volver al panel
            </a>
          )}
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

function VistaGestion({
  estado,
  suscripcion,
  zona,
  gestion,
}: {
  estado: string;
  suscripcion: Suscripcion | null;
  zona: string;
  gestion: boolean;
}) {
  if (estado === "trial_activo") {
    return (
      <>
        <h1 className="font-display mt-6 text-2xl font-semibold">Estás en tu prueba gratuita</h1>
        <p className="mt-2 max-w-md text-sm text-white/60">Tu prueba termina el {fecha(suscripcion?.trialEndsAt ?? null, zona)}.</p>
        <p className="mt-1 max-w-md text-sm text-white/60">
          Durante la prueba no se cobra nada. Al terminar podrás elegir un plan y continuar donde lo dejaste.
        </p>
      </>
    );
  }

  if (estado === "gracia") {
    return (
      <>
        <h1 className="font-display mt-6 text-2xl font-semibold">No pudimos cobrar tu suscripción</h1>
        <p className="mt-2 max-w-md text-sm text-white/60">
          El servicio sigue funcionando por ahora. Actualiza tu método de pago para no interrumpirlo.
        </p>
        <BotonGestion disponible={gestion} texto="Actualizar método de pago" />
      </>
    );
  }

  // activa: con proveedor (pagada) o alta manual de Gate Flow.
  const plan = PLANES.find((p) => p.id === suscripcion?.plan);
  return (
    <>
      <h1 className="font-display mt-6 text-2xl font-semibold">Tu suscripción está activa</h1>
      {suscripcion?.provider ? (
        <dl data-gestion="proveedor" className="mt-4 grid gap-1 text-sm text-white/70">
          <div>
            <dt className="inline text-white/50">Plan: </dt>
            <dd className="inline">{plan?.nombre ?? "—"}</dd>
          </div>
          {suscripcion.cancelAtPeriodEnd ? (
            <div>
              <dt className="inline text-white/50">Cancelada: </dt>
              <dd className="inline">el servicio sigue activo hasta el {fecha(suscripcion.currentPeriodEnd, zona)}</dd>
            </div>
          ) : (
            <div>
              <dt className="inline text-white/50">Próximo cobro: </dt>
              <dd className="inline">{fecha(suscripcion.currentPeriodEnd, zona)}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-2 max-w-md text-sm text-white/60">La gestiona el equipo de Gate Flow. Para cualquier cambio, escríbenos a soporte.</p>
      )}
      {suscripcion?.provider && <BotonGestion disponible={gestion} texto="Administrar suscripción" />}
    </>
  );
}

function BotonGestion({ disponible, texto }: { disponible: boolean; texto: string }) {
  if (!disponible) {
    return (
      <p className="mt-5 max-w-md text-sm text-white/60">
        Para gestionar tu suscripción escríbenos a{" "}
        <a href={`mailto:${CORREO_SOPORTE}`} className="text-primary underline">
          {CORREO_SOPORTE}
        </a>
        .
      </p>
    );
  }
  return (
    <form action={administrarSuscripcionAction} className="mt-5">
      <button type="submit" className="flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        {texto}
      </button>
    </form>
  );
}

function TarjetaPlan({ plan, viviendas, comprable, enTrial = false }: { plan: Plan; viviendas: number; comprable: boolean; enTrial?: boolean }) {
  const noCubre = plan.limiteViviendas !== null && viviendas > plan.limiteViviendas;
  return (
    <li data-plan={plan.id} className="flex flex-col rounded-lg border border-white/10 bg-ink-900 p-5">
      <p className="text-sm font-semibold text-white/80">{plan.nombre}</p>
      <p className="mt-3 h-10">
        {plan.precio ? (
          <>
            <span className="font-display text-3xl font-semibold">{plan.precio.texto}</span>
            <span className="text-sm text-white/60"> MXN / {plan.precio.periodo}</span>
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
        ) : enTrial ? (
          <p className="text-center text-xs text-white/50">Disponible al terminar la prueba</p>
        ) : noCubre ? (
          <>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="flex h-10 w-full cursor-not-allowed items-center justify-center rounded-md bg-primary/40 text-sm font-semibold text-primary-foreground/80"
            >
              Elegir plan
            </button>
            <p className="mt-2 text-center text-xs text-white/50">Tu residencial tiene {viviendas} viviendas</p>
          </>
        ) : comprable ? (
          // Solo planId: monto, moneda y residencial los resuelve el servidor.
          <form action={elegirPlanAction}>
            <input type="hidden" name="plan" value={plan.accion.planId} />
            <button
              type="submit"
              className="flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Elegir plan
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="flex h-10 w-full cursor-not-allowed items-center justify-center rounded-md bg-primary/40 text-sm font-semibold text-primary-foreground/80"
            >
              Elegir plan
            </button>
            <p className="mt-2 text-center text-xs text-white/50">Pagos en línea no disponibles por ahora</p>
          </>
        )}
      </div>
    </li>
  );
}
