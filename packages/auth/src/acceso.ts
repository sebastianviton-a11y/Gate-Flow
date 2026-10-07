import { puedeUsarPanelAdmin } from "./roles";

/**
 * Lógica ÚNICA de acceso de Admin y Guard (ciclo de vida del trial).
 * Pura: sin Next, sin Supabase, sin server-only. La usan el middleware
 * y el layout de Admin, el layout de Guard, /suscripcion, /sin-acceso,
 * el login y la aceptación de invitación. El bloqueo real de datos lo
 * hace la base (tenant_operativo(), migración 20261007000000); esto
 * decide a qué pantalla va cada quien.
 *
 * Fuente de verdad: public.suscripciones (nunca tenant.plan, metadata
 * ni valores del cliente).
 */

export type EstadoEfectivoSuscripcion = "trial_activo" | "activa" | "gracia" | "vencida" | "inactiva" | "sin_suscripcion";

/** Fila de suscripciones tal como llega embebida en la consulta. */
export interface DatosSuscripcion {
  estado: string | null;
  trial_ends_at: string | null;
  /** Billing (migración 20261008100000); ausentes en filas sin proveedor. */
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
}

/** Gracia tras un cobro fallido (past_due), contada desde current_period_end. */
export const DIAS_GRACIA_PAGO = 7;
const MS_GRACIA_PAGO = DIAS_GRACIA_PAGO * 86_400_000;

function instante(valor: string | null | undefined): number {
  return valor ? Date.parse(valor) : Number.NaN;
}

/**
 * Misma regla que tenant_operativo() (migración 20261008200000), con
 * instantes exactos (la zona horaria no influye):
 *   active                       → activa; con cancel_at_period_end, solo
 *                                  mientras ahora < current_period_end
 *                                  (después, inactiva aunque el webhook
 *                                  de cancelación no haya llegado)
 *   trialing con fin futuro      → trial_activo; vencido o sin fecha → vencida
 *   past_due                     → gracia mientras ahora < current_period_end
 *                                  + 7 días; después (o sin fecha) inactiva
 *   expired                      → vencida
 *   canceled                     → inactiva
 *   sin fila o estado desconocido → sin_suscripcion (falla cerrado)
 */
export function estadoEfectivoSuscripcion(s: DatosSuscripcion | null | undefined, ahora: Date = new Date()): EstadoEfectivoSuscripcion {
  if (!s) return "sin_suscripcion";
  switch (s.estado) {
    case "active": {
      if (!s.cancel_at_period_end) return "activa";
      const fin = instante(s.current_period_end);
      return Number.isFinite(fin) && ahora.getTime() < fin ? "activa" : "inactiva";
    }
    case "trialing": {
      const fin = instante(s.trial_ends_at);
      return Number.isFinite(fin) && ahora.getTime() < fin ? "trial_activo" : "vencida";
    }
    case "past_due": {
      const fin = instante(s.current_period_end);
      return Number.isFinite(fin) && ahora.getTime() < fin + MS_GRACIA_PAGO ? "gracia" : "inactiva";
    }
    case "expired":
      return "vencida";
    case "canceled":
      return "inactiva";
    default:
      return "sin_suscripcion";
  }
}

export function suscripcionOperativa(estado: EstadoEfectivoSuscripcion): boolean {
  return estado === "activa" || estado === "trial_activo" || estado === "gracia";
}

// ── Aviso de pago (gracia o cancelación pendiente) ────────────

export type NivelAvisoPago = "gracia" | "cancelacion";

export interface AvisoPago {
  nivel: NivelAvisoPago;
  /** Instante en que se bloquea (fin de la gracia o del periodo pagado). */
  hasta: string;
  texto: string;
}

function fechaLegible(ms: number, zona: string): string {
  const formato = (z: string) => new Intl.DateTimeFormat("es-MX", { timeZone: z, day: "numeric", month: "long" }).format(new Date(ms));
  try {
    return formato(zona);
  } catch {
    return formato("America/Mexico_City");
  }
}

/**
 * Solo para quien administra el residencial (Admin); Guard no lo muestra.
 *   gracia       "No pudimos cobrar tu suscripción…" (fuerte)
 *   cancelacion  "Tu suscripción termina el …" (cancelación pedida, aún vigente)
 */
export function avisoPago(s: DatosSuscripcion | null | undefined, ahora: Date, zonaHoraria: string | null | undefined): AvisoPago | null {
  if (!s) return null;
  const estado = estadoEfectivoSuscripcion(s, ahora);
  const zona = zonaHoraria || "America/Mexico_City";
  if (estado === "gracia") {
    const hasta = instante(s.current_period_end) + MS_GRACIA_PAGO;
    return {
      nivel: "gracia",
      hasta: new Date(hasta).toISOString(),
      texto: `No pudimos cobrar tu suscripción. Actualiza tu método de pago antes del ${fechaLegible(hasta, zona)} para no interrumpir el servicio.`,
    };
  }
  if (estado === "activa" && s.estado === "active" && s.cancel_at_period_end) {
    const hasta = instante(s.current_period_end);
    return {
      nivel: "cancelacion",
      hasta: new Date(hasta).toISOString(),
      texto: `Tu suscripción está cancelada y termina el ${fechaLegible(hasta, zona)}.`,
    };
  }
  return null;
}

// ── Aviso de días restantes ───────────────────────────────────

export type NivelAvisoTrial = "discreto" | "banner" | "urgente" | "manana" | "hoy";

export interface AvisoTrial {
  nivel: NivelAvisoTrial;
  /** Días de calendario (en la zona del residencial) hasta el día del fin. */
  dias: number;
  texto: string;
}

const ZONA_RESPALDO = "America/Mexico_City";

function fechaLocal(instante: Date, zona: string): string {
  const formato = (z: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(instante);
  try {
    return formato(zona);
  } catch {
    return formato(ZONA_RESPALDO);
  }
}

function diasCalendario(desde: Date, hasta: Date, zona: string): number {
  const a = Date.parse(`${fechaLocal(desde, zona)}T00:00:00Z`);
  const b = Date.parse(`${fechaLocal(hasta, zona)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Solo durante trial_activo. Los días son de calendario en la zona del
 * residencial (el último día dice "hoy" aunque falten pocas horas);
 * el bloqueo, en cambio, usa el instante exacto de trial_ends_at.
 *   > 7 días  discreto   "Prueba gratuita · X días restantes"
 *   4–7       banner     "Tu prueba gratuita termina en X días."
 *   2–3       urgente    mismo texto, más visible
 *   1         manana     "Tu prueba termina mañana."
 *   0         hoy        "Tu prueba termina hoy."
 */
export function avisoTrial(s: DatosSuscripcion | null | undefined, ahora: Date, zonaHoraria: string | null | undefined): AvisoTrial | null {
  if (!s || estadoEfectivoSuscripcion(s, ahora) !== "trial_activo" || !s.trial_ends_at) return null;
  const dias = Math.max(0, diasCalendario(ahora, new Date(s.trial_ends_at), zonaHoraria || ZONA_RESPALDO));
  if (dias === 0) return { nivel: "hoy", dias, texto: "Tu prueba termina hoy." };
  if (dias === 1) return { nivel: "manana", dias, texto: "Tu prueba termina mañana." };
  if (dias <= 3) return { nivel: "urgente", dias, texto: `Tu prueba gratuita termina en ${dias} días.` };
  if (dias <= 7) return { nivel: "banner", dias, texto: `Tu prueba gratuita termina en ${dias} días.` };
  return { nivel: "discreto", dias, texto: `Prueba gratuita · ${dias} días restantes` };
}

// ── Resolución de acceso ──────────────────────────────────────

/**
 * Misma consulta en todos los puntos de decisión:
 * user_tenants (activo = true, del usuario) → rol, tenant y su suscripción.
 */
export const SELECT_MEMBRESIA_ACCESO =
  "roles(clave), tenants(onboarding_completado, estado_servicio, timezone, suscripciones(estado, trial_ends_at, current_period_end, cancel_at_period_end))";

export type MembresiaAcceso = {
  roles: unknown;
  tenants: unknown;
} | null;

interface TenantAcceso {
  onboarding_completado?: boolean | null;
  estado_servicio?: string | null;
  timezone?: string | null;
  suscripciones?: DatosSuscripcion | DatosSuscripcion[] | null;
}

export type AppAcceso = "admin" | "guard";

export type DecisionAcceso =
  | { tipo: "permitir"; rol: string; estado: EstadoEfectivoSuscripcion; aviso: AvisoTrial | null; avisoPago: AvisoPago | null }
  | { tipo: "onboarding" }
  | { tipo: "sin_acceso"; motivo: "sin_membresia" | "error" | "rol" }
  | { tipo: "suspendido" }
  | { tipo: "suscripcion"; estado: Exclude<EstadoEfectivoSuscripcion, "activa" | "trial_activo" | "gracia"> }
  | { tipo: "ir_a_guard" };

/** Roles que operan la app Guard (igual que app/guard/layout.tsx). */
export const ROLES_APP_GUARD: readonly string[] = ["guardia", "admin_residencial", "super_admin"];

/** Un guardia va a Guard solo si su residencial está habilitado (piloto/activo); cancelado no. */
const ESTADOS_TENANT_GUARDIA_A_GUARD = ["piloto", "activo"];

function suscripcionDe(tenant: TenantAcceso): DatosSuscripcion | null {
  const s = tenant.suscripciones;
  if (Array.isArray(s)) return s[0] ?? null;
  return s ?? null;
}

/**
 * Orden (cada paso solo se evalúa si el anterior no decidió):
 *   1. sin usuario                → lo resuelve quien llama (/login)
 *   2. error leyendo el contexto  → sin_acceso:error
 *   3. sin membresía activa       → sin_acceso:sin_membresia
 *   4. tenant o rol ilegible      → sin_acceso:error
 *   5. super_admin                → excepción administrativa (pasa a 9)
 *   6. tenant suspendido          → suspendido
 *   7. suscripción no operativa   → admin_residencial: suscripcion;
 *                                   guardia en Admin: ir_a_guard (Guard
 *                                   muestra servicio inactivo); en Guard:
 *                                   suscripcion; otros roles: sin_acceso:rol
 *   8. rol / destino              → reglas existentes
 *   9. onboarding pendiente       → onboarding (solo Admin)
 */
export function resolverAcceso(entrada: {
  error: unknown;
  membresia: MembresiaAcceso | undefined;
  ahora?: Date;
  app: AppAcceso;
}): DecisionAcceso {
  const ahora = entrada.ahora ?? new Date();
  const { error, membresia, app } = entrada;

  if (error) return { tipo: "sin_acceso", motivo: "error" };
  if (!membresia) return { tipo: "sin_acceso", motivo: "sin_membresia" };

  const tenant = membresia.tenants as TenantAcceso | null;
  const rol = (membresia.roles as { clave: string | null } | null)?.clave;
  if (!tenant || !rol) return { tipo: "sin_acceso", motivo: "error" };

  const suscripcion = suscripcionDe(tenant);
  const estado = estadoEfectivoSuscripcion(suscripcion, ahora);
  const esSuperAdmin = rol === "super_admin";

  if (!esSuperAdmin) {
    if (tenant.estado_servicio === "suspendido") return { tipo: "suspendido" };

    if (!suscripcionOperativa(estado)) {
      const estadoBloqueado = estado as Exclude<EstadoEfectivoSuscripcion, "activa" | "trial_activo" | "gracia">;
      if (app === "guard") {
        return ROLES_APP_GUARD.includes(rol) ? { tipo: "suscripcion", estado: estadoBloqueado } : { tipo: "sin_acceso", motivo: "rol" };
      }
      if (rol === "admin_residencial") return { tipo: "suscripcion", estado: estadoBloqueado };
      if (rol === "guardia" && ESTADOS_TENANT_GUARDIA_A_GUARD.includes(tenant.estado_servicio ?? "")) return { tipo: "ir_a_guard" };
      return { tipo: "sin_acceso", motivo: "rol" };
    }
  }

  if (app === "guard") {
    if (!ROLES_APP_GUARD.includes(rol)) return { tipo: "sin_acceso", motivo: "rol" };
    return { tipo: "permitir", rol, estado, aviso: null, avisoPago: null };
  }

  if (!puedeUsarPanelAdmin(rol)) {
    if (rol === "guardia" && ESTADOS_TENANT_GUARDIA_A_GUARD.includes(tenant.estado_servicio ?? "")) return { tipo: "ir_a_guard" };
    return { tipo: "sin_acceso", motivo: "rol" };
  }

  if (tenant.onboarding_completado === false) return { tipo: "onboarding" };

  return {
    tipo: "permitir",
    rol,
    estado,
    aviso: avisoTrial(suscripcion, ahora, tenant.timezone),
    avisoPago: avisoPago(suscripcion, ahora, tenant.timezone),
  };
}

/** Puede operar (escribir) desde el panel: permitir u onboarding. */
export function puedeOperar(decision: DecisionAcceso): boolean {
  return decision.tipo === "permitir" || decision.tipo === "onboarding";
}
