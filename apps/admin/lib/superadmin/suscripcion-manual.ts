import { claveDiaLocal, resolverZonaHoraria, sumarDias } from "@gateflow/types";
import type { SuscripcionSuperAdmin } from "@gateflow/paquetes";

/**
 * Suscripción manual en Super Admin (sin Next ni Supabase: se prueba con
 * datos). Qué acciones se ofrecen según el estado, textos, límites de
 * fecha y mensajes de error. La autoridad es la base: las RPC
 * superadmin_* (migración 20261013000000) validan lo mismo y más; esto
 * solo evita ofrecer lo que la base va a rechazar.
 */

export type AccionSuscripcion = "extender_prueba" | "activar" | "extender_vigencia";

export type GestionSuscripcion =
  /** Stripe (o Mercado Pago): sin acciones manuales. */
  | { tipo: "proveedor"; proveedor: string }
  /** Alta manual anterior al trial, activa sin vencimiento: no se toca. */
  | { tipo: "sin_vencimiento" }
  /** Sin proveedor: la administra Gate Flow. */
  | { tipo: "manual" }
  | { tipo: "sin_suscripcion" };

export interface AccionesDisponibles {
  gestion: GestionSuscripcion;
  extenderPrueba: boolean;
  activar: boolean;
  extenderVigencia: boolean;
}

export const ESTADO_SUSCRIPCION_LABEL: Record<SuscripcionSuperAdmin["estado"], string> = {
  trialing: "En prueba gratuita",
  active: "Activa",
  past_due: "Pago pendiente",
  canceled: "Cancelada",
  expired: "Vencida",
};

export const ORIGEN_SUSCRIPCION_LABEL: Record<SuscripcionSuperAdmin["origen"], string> = {
  registro_publico: "Registro público",
  alta_manual: "Alta manual",
};

export const PROVEEDOR_LABEL: Record<string, string> = {
  stripe: "Stripe",
  mercadopago: "Mercado Pago",
};

export const PLANES_MANUALES = [
  { id: "hasta-50", nombre: "Hasta 50 viviendas" },
  { id: "hasta-150", nombre: "Hasta 150 viviendas" },
] as const;

export type PlanManual = (typeof PLANES_MANUALES)[number]["id"];

export function nombreProveedor(provider: string | null | undefined): string {
  return (provider && PROVEEDOR_LABEL[provider]) || "un proveedor de cobro";
}

/** Misma condición que las RPC: cualquier rastro del proveedor la deja fuera de lo manual. */
export function gestionadaPorProveedor(s: SuscripcionSuperAdmin): boolean {
  return Boolean(s.provider) || s.tieneSuscripcionProveedor || s.tieneClienteProveedor;
}

/** Activación manual con vencimiento (active + cancel_at_period_end + fecha), sin proveedor. */
export function esActivacionManual(s: SuscripcionSuperAdmin): boolean {
  return s.estado === "active" && !gestionadaPorProveedor(s) && s.cancelAtPeriodEnd && Boolean(s.currentPeriodEnd);
}

export function accionesSuscripcion(s: SuscripcionSuperAdmin | null): AccionesDisponibles {
  const ninguna = { extenderPrueba: false, activar: false, extenderVigencia: false };
  if (!s) return { gestion: { tipo: "sin_suscripcion" }, ...ninguna };
  if (gestionadaPorProveedor(s)) return { gestion: { tipo: "proveedor", proveedor: nombreProveedor(s.provider) }, ...ninguna };
  if (s.estado === "active") {
    return esActivacionManual(s)
      ? { gestion: { tipo: "manual" }, ...ninguna, extenderVigencia: true }
      : { gestion: { tipo: "sin_vencimiento" }, ...ninguna };
  }
  if (s.estado === "trialing") return { gestion: { tipo: "manual" }, ...ninguna, extenderPrueba: true, activar: true };
  return { gestion: { tipo: "manual" }, ...ninguna, activar: true };
}

// ── Fechas ("YYYY-MM-DD" en la zona del residencial) ──────────

const MAX_DIAS_PRUEBA = 180;

function sumarAnios(clave: string, anios: number): string {
  const [a, m, d] = clave.split("-").map(Number) as [number, number, number];
  // Como Postgres (date + interval 'N years'): el 29/02 pasa al 28/02.
  const ultimoDia = new Date(Date.UTC(a + anios, m, 0)).getUTCDate();
  return `${a + anios}-${String(m).padStart(2, "0")}-${String(Math.min(d, ultimoDia)).padStart(2, "0")}`;
}

/** Último día con acceso de un fin exclusivo (medianoche siguiente): el día anterior al instante. */
export function ultimoDiaConAcceso(finIso: string | null | undefined, zona: string | null | undefined): string | null {
  if (!finIso) return null;
  const ms = Date.parse(finIso);
  return Number.isFinite(ms) ? claveDiaLocal(ms - 1, zona) : null;
}

/** ¿El instante es exactamente la medianoche local (fin de un día elegido en Super Admin)? */
export function esMedianocheLocal(iso: string | null | undefined, zona: string | null | undefined): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  const hora = new Intl.DateTimeFormat("en-US", { timeZone: resolverZonaHoraria(zona), hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(ms);
  return hora === "00:00:00" && new Date(ms).getUTCMilliseconds() === 0;
}

/**
 * Cómo mostrar un fin de acceso: si es la medianoche local (lo eligió Super
 * Admin como "hasta el día X"), el último día incluido; si no (p. ej. la
 * prueba de 30 días del registro, que vence a la hora del alta), null y se
 * muestra fecha y hora.
 */
export function finComoDiaIncluido(iso: string | null | undefined, zona: string | null | undefined): string | null {
  return esMedianocheLocal(iso, zona) ? ultimoDiaConAcceso(iso, zona) : null;
}

export interface LimitesFecha {
  min: string;
  max: string;
  sugerida: string;
}

/** Límites de la base (desde hoy; 180 días la prueba, 2 años la activación; nunca acorta). */
export function limitesFecha(accion: AccionSuscripcion, s: SuscripcionSuperAdmin, zona: string | null | undefined, ahora: Date = new Date()): LimitesFecha {
  const hoy = claveDiaLocal(ahora, zona);
  const max = accion === "extender_prueba" ? sumarDias(hoy, MAX_DIAS_PRUEBA) : sumarAnios(hoy, 2);
  const finVigente =
    accion === "extender_prueba"
      ? ultimoDiaConAcceso(s.trialEndsAt, zona)
      : accion === "extender_vigencia"
        ? ultimoDiaConAcceso(s.currentPeriodEnd, zona)
        : s.estado === "trialing" && s.trialEndsAt && Date.parse(s.trialEndsAt) > ahora.getTime()
          ? ultimoDiaConAcceso(s.trialEndsAt, zona)
          : null;
  const min = finVigente && finVigente > hoy ? finVigente : hoy;
  const base = finVigente && finVigente > hoy ? finVigente : hoy;
  const sugerida = sumarDias(base, accion === "extender_prueba" ? 15 : 30);
  return { min, max, sugerida: sugerida > max ? max : sugerida };
}

/** "2026-11-30" → "30/11/2026". */
export function fechaCorta(clave: string): string {
  const [a, m, d] = clave.split("-");
  return `${d}/${m}/${a}`;
}

export function textoConfirmacion(accion: AccionSuscripcion, clave: string): string {
  const fecha = fechaCorta(clave);
  if (accion === "extender_prueba") return `La prueba gratuita de este residencial se extiende hasta el ${fecha}. No se cobra nada.`;
  return `Este residencial podrá usar Gate Flow hasta el ${fecha}. Esta acción no genera ningún cobro automático.`;
}

export const ACLARACION_SIN_COBRO = "No usa Stripe ni Mercado Pago: es una activación administrativa.";

// ── Validación de entrada (server action) ─────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fechaValida(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [a, m, d] = valor.split("-").map(Number) as [number, number, number];
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

export type EntradaValidada = { ok: true; tenantId: string; hasta: string; plan: PlanManual | null } | { ok: false; codigo: "parametros" | "plan_invalido" };

export function validarEntrada(tenantId: unknown, hasta: unknown, plan: unknown = null): EntradaValidada {
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId) || !fechaValida(hasta)) return { ok: false, codigo: "parametros" };
  if (plan !== null && plan !== undefined && plan !== "" && !PLANES_MANUALES.some((p) => p.id === plan)) return { ok: false, codigo: "plan_invalido" };
  return { ok: true, tenantId: tenantId.toLowerCase(), hasta, plan: plan ? (plan as PlanManual) : null };
}

// ── Errores ───────────────────────────────────────────────────

export const MENSAJES_ERROR: Record<string, string> = {
  no_autorizado: "Solo Super Admin puede hacer esto.",
  parametros: "Faltan datos o no son válidos.",
  tenant_inexistente: "El residencial no existe.",
  sin_suscripcion: "Este residencial no tiene suscripción.",
  estado_no_permite: "El estado actual de la suscripción no permite esta acción. Recarga la página.",
  activa_sin_vencimiento: "La suscripción está activa sin fecha de vencimiento (alta manual anterior a la prueba): no se modifica desde aquí.",
  ya_activa_manual: "Ya tiene una activación manual. Usa «Extender vigencia».",
  fecha_pasada: "La fecha no puede ser anterior a hoy.",
  fecha_lejana: "La fecha está demasiado lejos: como máximo 180 días para la prueba y 2 años para la activación.",
  fecha_anterior: "La nueva fecha no puede dejar al residencial con menos acceso del que ya tiene.",
  plan_invalido: "El plan elegido no es válido.",
  plan_insuficiente: "El plan elegido no cubre las viviendas del residencial.",
  checkout_abierto: "Hay un pago en curso con el proveedor de cobro. Espera a que termine o venza.",
  conflicto: "La suscripción cambió mientras se guardaba. Recarga la página e inténtalo de nuevo.",
  desconocido: "No se pudo guardar. Inténtalo de nuevo.",
};

function campo(error: unknown, nombre: "message" | "details"): string {
  return error && typeof error === "object" && nombre in error ? String((error as Record<string, unknown>)[nombre] ?? "") : "";
}

/** Código de un error de las RPC ("suscripcion_manual:<codigo>"), sin exponer el mensaje técnico. */
export function codigoDeError(error: unknown): string {
  const codigo = /suscripcion_manual:([a-z_]+)/.exec(campo(error, "message") || String(error ?? ""))?.[1];
  if (codigo && (codigo === "gestionada_por_proveedor" || codigo in MENSAJES_ERROR)) return codigo;
  return "desconocido";
}

/** Proveedor que informa la base en el detalle de gestionada_por_proveedor (p. ej. "stripe"). */
export function proveedorDeError(error: unknown): string | null {
  const detalle = campo(error, "details").trim();
  return /^[a-z]{2,20}$/.test(detalle) && detalle !== "proveedor" ? detalle : null;
}

export function mensajeError(codigo: string, provider?: string | null): string {
  if (codigo === "gestionada_por_proveedor") return `Esta suscripción está gestionada por ${nombreProveedor(provider)}.`;
  return MENSAJES_ERROR[codigo] ?? MENSAJES_ERROR.desconocido!;
}

export type ResultadoAccion =
  | { ok: true; resultado: "aplicado" | "sin_cambios"; mensaje: string }
  | { ok: false; codigo: string; mensaje: string };

export function zonaDe(timezone: string | null | undefined): string {
  return resolverZonaHoraria(timezone);
}
