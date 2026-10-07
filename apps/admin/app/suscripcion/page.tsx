import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { GateFlowLogo, cn } from "@gateflow/ui";
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
 *   bloqueada (vencida / inactiva)  planes y "Activar plan" (checkout
 *                                   hospedado); tras un cobro fallido con
 *                                   la gracia agotada: actualizar tarjeta
 *   operativa (admin_residencial)   gestión: trial (sin cobro), activa,
 *                                   cancelación pendiente o gracia
 * La página no escribe nada: el alta la hace la server action y la
 * activación SOLO el webhook verificado.
 *
 * Diseño: variante B aprobada (beneficios compartidos). Verde Flujo
 * (primary) es el único verde funcional; el logo conserva el suyo.
 */
const TEXTOS = {
  vencida: { etiqueta: "Tu prueba gratuita de 30 días terminó" },
  inactiva: { etiqueta: "Tu suscripción no está activa" },
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

/** Iguales en todos los planes: se muestran una sola vez, debajo. */
const BENEFICIOS = [
  "Todas las funciones de Gate Flow",
  "Administradores y guardias ilimitados",
  "Registro y entrega de paquetes",
  "Soporte incluido",
] as const;

const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950";

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
    <div className="flex min-h-screen flex-col bg-ink-950 bg-[radial-gradient(420px_320px_at_0%_-6%,rgba(0,196,154,0.07),transparent_66%)] font-sans text-white antialiased md:bg-[radial-gradient(760px_440px_at_0%_-10%,rgba(0,196,154,0.07),transparent_64%)] lg:bg-[radial-gradient(1000px_520px_at_8%_-12%,rgba(0,196,154,0.07),transparent_64%)]">
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-5 py-4 md:px-10 md:py-6 lg:py-7">
        {/* Isotipo oficial (verde de marca): el wordmark de logo-dark.svg es negro y no se lee sobre este fondo. */}
        <GateFlowLogo onDark size={34} />
        <CerrarSesionButton
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-[10px] border border-white/[0.12] px-3.5 text-sm font-medium text-white/70 transition-colors hover:border-white/25 hover:text-white",
            FOCO,
          )}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13H6M10.5 11l3-3-3-3M13.5 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </CerrarSesionButton>
      </header>

      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-8 px-5 pt-6 md:gap-11 md:px-10 md:pt-10 lg:gap-14 lg:pt-12">
        {error && (
          <p role="alert" className="mx-auto w-full max-w-2xl rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-center text-sm text-warn">
            {error}
          </p>
        )}

        {decision.tipo === "permitir" ? (
          <VistaGestion estado={decision.estado} suscripcion={suscripcion} zona={zona} gestion={gestion} />
        ) : decision.estado === "sin_suscripcion" ? (
          <Aviso titulo="No pudimos determinar una suscripción activa para este residencial.">
            Es un problema de configuración de la cuenta. Escríbenos a{" "}
            <a href={`mailto:${CORREO_SOPORTE}`} className={cn("rounded-sm text-primary underline", FOCO)}>
              {CORREO_SOPORTE}
            </a>{" "}
            y lo resolvemos.
          </Aviso>
        ) : suscripcion?.estado === "past_due" ? (
          <Aviso titulo="No pudimos cobrar tu suscripción">
            Terminó el periodo de gracia. Actualiza tu método de pago para reactivar el servicio; al hacerlo, continúas donde lo dejaste.
            <BotonGestion disponible={gestion} texto="Actualizar método de pago" />
          </Aviso>
        ) : (
          <EncabezadoPlanes etiqueta={TEXTOS[decision.estado].etiqueta} />
        )}

        {decision.tipo === "suscripcion" && decision.estado !== "sin_suscripcion" && suscripcion?.estado !== "past_due" && (
          <SeccionPlanes viviendas={viviendas} comprable={autorizacion.ok && permiteAlta(resultado) && checkoutDisponible()} />
        )}

        {decision.tipo === "permitir" && suscripcion?.estado === "trialing" && <SeccionPlanes viviendas={viviendas} comprable={false} enTrial />}
      </main>

      <footer className="mx-auto mt-9 w-full max-w-[1200px] px-5 md:mt-12 md:px-10 lg:mt-14">
        <nav aria-label="Enlaces" className="flex flex-wrap justify-center gap-x-6 gap-y-2 border-t border-white/[0.08] pb-7 pt-[18px] text-sm text-white/[0.68] md:gap-x-7 md:pb-8 md:pt-6">
          {decision.tipo === "permitir" && (
            <a href="/dashboard" className={cn("rounded-sm py-2.5 transition-colors hover:text-white md:py-0", FOCO)}>
              Volver al panel
            </a>
          )}
          <a href={`mailto:${CORREO_SOPORTE}`} className={cn("rounded-sm py-2.5 transition-colors hover:text-white md:py-0", FOCO)}>
            Soporte
          </a>
          <a href="/terminos" className={cn("rounded-sm py-2.5 transition-colors hover:text-white md:py-0", FOCO)}>
            Términos
          </a>
          <a href="/privacidad" className={cn("rounded-sm py-2.5 transition-colors hover:text-white md:py-0", FOCO)}>
            Privacidad
          </a>
        </nav>
      </footer>
    </div>
  );
}

/** Cabecera de la elección de plan: continuidad, no bloqueo. */
function EncabezadoPlanes({ etiqueta }: { etiqueta: string }) {
  return (
    <section className="flex flex-col gap-4 md:max-w-[640px] md:gap-5 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
      <div className="flex flex-col items-start gap-4 md:gap-5 lg:gap-[22px]">
        <p className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.04] px-3 py-1.5 text-[12.5px] font-medium text-white/[0.78] md:gap-2.5 md:px-3.5 md:text-[13px]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white/[0.45]" />
          {etiqueta}
        </p>
        <h1 className="font-display text-[32px] font-bold leading-[1.12] tracking-[-0.02em] [text-wrap:balance] md:text-[44px] md:leading-[1.08] md:tracking-[-0.025em] lg:max-w-[640px] lg:text-[54px] lg:leading-[1.06]">
          Elige el plan para seguir usando Gate Flow
        </h1>
      </div>
      <div className="flex flex-col gap-3 lg:gap-4 lg:pb-1.5">
        <p className="text-base leading-[1.55] text-white/[0.82] md:text-lg lg:text-[19px]">
          Tu información sigue aquí. Activa tu suscripción y continúa donde lo dejaste.
        </p>
        <p className="text-sm leading-[1.6] text-white/[0.58] md:text-[15px]">Todos los planes incluyen todas las funciones. Elige según el tamaño de tu residencial.</p>
      </div>
    </section>
  );
}

function SeccionPlanes({ viviendas, comprable, enTrial = false }: { viviendas: number; comprable: boolean; enTrial?: boolean }) {
  const contratables = PLANES.filter((p) => p.accion.tipo === "checkout");
  const contacto = PLANES.find((p) => p.accion.tipo === "contacto");
  return (
    <>
      <section aria-label="Planes" className="flex flex-col gap-3.5 md:gap-[18px] lg:gap-5">
        <ul className="grid gap-3.5 md:grid-cols-2 md:gap-4 lg:gap-5">
          {contratables.map((plan) => (
            <TarjetaPlan key={plan.id} plan={plan} viviendas={viviendas} comprable={comprable} enTrial={enTrial} />
          ))}
        </ul>

        <section
          aria-labelledby="planes-incluyen"
          className="my-1.5 flex flex-col gap-3.5 border-y border-white/[0.08] px-1 py-5 md:my-0 md:gap-4 md:py-[22px] lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-x-14 lg:px-2 lg:py-[26px]"
        >
          <h2 id="planes-incluyen" className="text-sm font-semibold leading-[1.45] text-white/[0.92] md:text-[15px] lg:whitespace-nowrap">
            Todos los planes de Gate Flow incluyen:
          </h2>
          <ul className="flex flex-col gap-2.5 text-sm leading-[1.45] text-white/80 md:grid md:grid-cols-2 md:gap-x-6 md:gap-y-3 md:text-[15px] lg:grid-cols-4 lg:gap-x-7">
            {BENEFICIOS.map((beneficio) => (
              <li key={beneficio} className="flex items-start gap-2.5">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-0.5 shrink-0 text-primary md:mt-[3px]">
                  <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {beneficio}
              </li>
            ))}
          </ul>
        </section>

        {contacto && contacto.accion.tipo === "contacto" && (
          <aside
            data-plan={contacto.id}
            className="flex flex-col gap-3.5 rounded-2xl border border-white/[0.09] bg-white/[0.015] px-[22px] pb-[22px] pt-5 md:flex-row md:items-center md:justify-between md:gap-6 md:py-[22px] md:pl-7 md:pr-6 lg:gap-8 lg:px-8 lg:py-6"
          >
            <div className="flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-7 lg:gap-y-1.5">
              <h2 className="text-sm font-semibold text-white/[0.62] lg:text-[15px]">{contacto.nombre}</h2>
              <p className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-baseline md:gap-x-3 lg:gap-x-7">
                <span className="font-display text-xl font-bold tracking-[-0.01em] md:text-[21px] lg:text-[22px]">Hablemos</span>
                <span className="text-sm leading-[1.5] text-white/[0.66] md:text-[15px]">Armamos un plan para tu residencial.</span>
              </p>
            </div>
            <a
              href={contacto.accion.href}
              className={cn(
                "inline-flex h-12 shrink-0 items-center justify-center gap-2.5 rounded-xl border border-white/[0.18] px-[18px] text-[15px] font-semibold text-white transition-colors hover:border-white/30 hover:bg-white/5 md:h-[46px] lg:px-5",
                FOCO,
              )}
            >
              Contactar
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </aside>
        )}
      </section>

      {!enTrial && (
        <section className="flex flex-col items-center gap-2 text-center md:gap-2.5">
          <p className="text-sm font-medium leading-[1.5] text-white/[0.76] md:text-[15px]">
            Activación inmediata · Pago mensual <span className="hidden md:inline">· </span>
            <br className="md:hidden" />
            Cancela cuando quieras
          </p>
          <p className="inline-flex items-center gap-2 text-[12.5px] text-white/[0.56] md:text-[13px]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            Pago seguro procesado por Stripe
          </p>
        </section>
      )}
    </>
  );
}

function TarjetaPlan({ plan, viviendas, comprable, enTrial = false }: { plan: Plan; viviendas: number; comprable: boolean; enTrial?: boolean }) {
  if (plan.accion.tipo !== "checkout" || !plan.precio) return null;
  const noCubre = plan.limiteViviendas !== null && viviendas > plan.limiteViviendas;
  const destacado = plan.id === "hasta-150";
  // No elegible: tarjeta y precio visibles, menor contraste; sin rojo ni ámbar.
  const apagada = noCubre && !enTrial;
  const motivo = `motivo-${plan.id}`;
  const botonInactivo = "h-[52px] w-full cursor-not-allowed rounded-xl border border-white/[0.08] bg-transparent text-base font-semibold text-white/40 lg:h-[54px]";
  return (
    <li
      data-plan={plan.id}
      className={cn(
        "flex flex-col rounded-2xl border px-[22px] pb-6 pt-[22px] md:p-7 lg:rounded-[18px] lg:px-10 lg:pb-10 lg:pt-9",
        apagada
          ? "border-white/[0.06] bg-[#0F2236]"
          : destacado
            ? "border-primary/[0.55] bg-[#16314B] shadow-[0_0_0_4px_rgba(0,196,154,0.06),0_28px_56px_-30px_rgba(0,0,0,0.65)] lg:shadow-[0_0_0_5px_rgba(0,196,154,0.06),0_32px_64px_-32px_rgba(0,0,0,0.65)]"
            : "border-white/[0.08] bg-ink-900",
      )}
    >
      <div className="flex min-h-[26px] items-center justify-between gap-2.5 md:min-h-7 lg:min-h-[30px] lg:gap-3">
        <h2 className={cn("text-base font-semibold md:text-[17px] lg:text-lg", apagada ? "text-white/60" : destacado ? "text-white" : "text-white/[0.92]")}>
          {plan.nombre}
        </h2>
        {destacado && !apagada && (
          <span className="inline-flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-full border border-primary/[0.32] bg-primary/[0.12] px-2.5 text-xs font-bold tracking-[0.01em] text-primary md:px-[11px] lg:h-7 lg:px-3 lg:text-[12.5px]">
            Más elegido
          </span>
        )}
      </div>

      <p className="mt-4 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 md:mt-[22px] md:gap-y-1 lg:mt-[26px] lg:gap-x-3">
        <span
          className={cn(
            "font-display text-[44px] font-bold leading-none tracking-[-0.035em] tabular-nums md:text-[52px] lg:text-[64px]",
            apagada && "text-white/[0.42]",
          )}
        >
          {plan.precio.texto}
        </span>
        <span className={cn("text-sm font-medium md:text-[15px] lg:text-base", apagada ? "text-white/40" : destacado ? "text-white/[0.66]" : "text-white/[0.62]")}>
          MXN / {plan.precio.periodo}
        </span>
      </p>

      <div className="mt-5 flex flex-1 flex-col justify-end md:mt-7">
        {enTrial ? (
          <p className="rounded-xl border border-white/[0.08] px-4 py-3.5 text-center text-sm text-white/60">Disponible al terminar la prueba</p>
        ) : noCubre ? (
          <>
            <p id={motivo} className="flex items-start gap-2.5 rounded-[10px] bg-white/[0.04] px-3 py-[11px] text-[13.5px] leading-[1.5] text-white/70 md:px-3.5 md:py-3 md:text-sm">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-0.5 shrink-0 text-white/[0.62]">
                <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 7.25v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <circle cx="8" cy="5" r="0.9" fill="currentColor" />
              </svg>
              <span>
                <strong className="font-semibold text-white/[0.92]">Tu residencial supera este plan.</strong> Este plan cubre hasta {plan.limiteViviendas} viviendas.
              </span>
            </p>
            <button type="button" disabled aria-describedby={motivo} className={cn("mt-3 lg:mt-3.5", botonInactivo)}>
              Activar plan
            </button>
          </>
        ) : comprable ? (
          // Solo planId: monto, moneda y residencial los resuelve el servidor.
          <form action={elegirPlanAction}>
            <input type="hidden" name="plan" value={plan.accion.planId} />
            <button
              type="submit"
              className={cn(
                "h-[52px] w-full rounded-xl text-base transition-colors lg:h-[54px]",
                destacado
                  ? "bg-primary font-bold text-ink-950 shadow-[inset_0_-1px_0_rgba(0,0,0,0.18)] hover:bg-primary/90"
                  : "border border-white/[0.16] bg-white/[0.06] font-semibold text-white hover:border-white/25 hover:bg-white/10",
                FOCO,
              )}
            >
              Activar plan
            </button>
          </form>
        ) : (
          <>
            <button type="button" disabled aria-describedby={motivo} className={botonInactivo}>
              Activar plan
            </button>
            <p id={motivo} className="mt-2.5 text-center text-xs text-white/[0.56]">
              Pagos en línea no disponibles por ahora
            </p>
          </>
        )}
      </div>
    </li>
  );
}

/** Estados excepcionales (sin suscripción, cobro fallido): mismo marco, mensaje centrado. */
function Aviso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 py-6 text-center md:py-10">
      <h1 className="font-display text-2xl font-bold tracking-[-0.02em] md:text-[32px] md:leading-tight">{titulo}</h1>
      <div className="flex flex-col items-center text-[15px] leading-[1.6] text-white/70 md:text-base">{children}</div>
    </section>
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
      <Aviso titulo="Estás en tu prueba gratuita">
        <p>Tu prueba termina el {fecha(suscripcion?.trialEndsAt ?? null, zona)}.</p>
        <p className="mt-1">Durante la prueba no se cobra nada. Al terminar podrás elegir un plan y continuar donde lo dejaste.</p>
      </Aviso>
    );
  }

  if (estado === "gracia") {
    return (
      <Aviso titulo="No pudimos cobrar tu suscripción">
        El servicio sigue funcionando por ahora. Actualiza tu método de pago para no interrumpirlo.
        <BotonGestion disponible={gestion} texto="Actualizar método de pago" />
      </Aviso>
    );
  }

  // activa: con proveedor (pagada) o alta manual de Gate Flow.
  const plan = PLANES.find((p) => p.id === suscripcion?.plan);
  return (
    <Aviso titulo="Tu suscripción está activa">
      {suscripcion?.provider ? (
        <dl data-gestion="proveedor" className="grid gap-1 text-white/[0.78]">
          <div>
            <dt className="inline text-white/[0.56]">Plan: </dt>
            <dd className="inline">{plan?.nombre ?? "—"}</dd>
          </div>
          {suscripcion.cancelAtPeriodEnd ? (
            <div>
              <dt className="inline text-white/[0.56]">Cancelada: </dt>
              <dd className="inline">el servicio sigue activo hasta el {fecha(suscripcion.currentPeriodEnd, zona)}</dd>
            </div>
          ) : (
            <div>
              <dt className="inline text-white/[0.56]">Próximo cobro: </dt>
              <dd className="inline">{fecha(suscripcion.currentPeriodEnd, zona)}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p>La gestiona el equipo de Gate Flow. Para cualquier cambio, escríbenos a soporte.</p>
      )}
      {suscripcion?.provider && <BotonGestion disponible={gestion} texto="Administrar suscripción" />}
    </Aviso>
  );
}

function BotonGestion({ disponible, texto }: { disponible: boolean; texto: string }) {
  if (!disponible) {
    return (
      <p className="mt-5 max-w-md">
        Para gestionar tu suscripción escríbenos a{" "}
        <a href={`mailto:${CORREO_SOPORTE}`} className={cn("rounded-sm text-primary underline", FOCO)}>
          {CORREO_SOPORTE}
        </a>
        .
      </p>
    );
  }
  return (
    <form action={administrarSuscripcionAction} className="mt-6">
      <button
        type="submit"
        className={cn("inline-flex h-[52px] items-center justify-center rounded-xl bg-primary px-6 text-base font-bold text-ink-950 transition-colors hover:bg-primary/90", FOCO)}
      >
        {texto}
      </button>
    </form>
  );
}
