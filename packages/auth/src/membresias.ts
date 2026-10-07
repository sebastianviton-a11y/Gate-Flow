import { resolverAcceso, ROLES_APP_GUARD, type AppAcceso, type DecisionAcceso, type MembresiaAcceso } from "./acceso";

/**
 * Selección EXPLÍCITA del residencial (multi-tenant). Pura: sin Next ni
 * Supabase. Un usuario puede pertenecer a varios residenciales (p. ej.
 * un guardia que trabaja en dos); la decisión de acceso se evalúa
 * siempre sobre UNA membresía elegida de forma explícita:
 *
 *   usuario → tenant seleccionado → membresía de ESE tenant → tenant →
 *   suscripción de ESE tenant → rol de ESE tenant → resolverAcceso
 *
 * Nunca limit(1), ORDER BY ni "primera fila": con varias membresías y
 * sin selección válida, se pide elegir.
 */

/** Cookie por app/dominio (Admin y Guard no la comparten). Solo guarda un tenant_id. */
export const COOKIE_TENANT = "gf_tenant";

/** Ruta de selección (existe en Admin y en Guard). */
export const RUTA_SELECCIONAR_RESIDENCIAL = "/seleccionar-residencial";

/** Atributos de gf_tenant: nunca se confía en su valor sin validar la membresía activa. */
export function opcionesCookieTenant() {
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 180 };
}

/** Todas las membresías ACTIVAS del usuario (sin limit): una fila por tenant (unique user_id, tenant_id). */
export const SELECT_MEMBRESIAS_ACCESO =
  "tenant_id, roles(clave), tenants(nombre, onboarding_completado, estado_servicio, timezone, suscripciones(estado, trial_ends_at, current_period_end, cancel_at_period_end))";

export interface FilaMembresia {
  tenant_id: string;
  roles: unknown;
  tenants: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function rolDeFila(fila: FilaMembresia): string | null {
  return (fila.roles as { clave: string | null } | null)?.clave ?? null;
}

export function nombreTenantDeFila(fila: FilaMembresia): string {
  return (fila.tenants as { nombre?: string | null } | null)?.nombre ?? "Residencial";
}

/** Roles que tiene sentido elegir en cada app. */
const ROLES_SELECCIONABLES: Record<AppAcceso, readonly string[]> = {
  admin: ["super_admin", "admin_residencial", "guardia"],
  guard: ROLES_APP_GUARD.filter((r) => r !== "super_admin"),
};

/** Opciones que muestra /seleccionar-residencial de cada app. */
export function opcionesSeleccion(filas: readonly FilaMembresia[], app: AppAcceso): FilaMembresia[] {
  return filas.filter((f) => ROLES_SELECCIONABLES[app].includes(rolDeFila(f) ?? ""));
}

export type SeleccionMembresia =
  | { tipo: "error" }
  | { tipo: "sin_membresia" }
  /** gf_tenant apunta a un tenant sin membresía activa: falla cerrado y se pide elegir. */
  | { tipo: "cookie_invalida" }
  | { tipo: "seleccionar"; opciones: FilaMembresia[] }
  | { tipo: "resuelta"; membresia: FilaMembresia; origen: "cookie" | "unica" | "super_admin" };

/**
 *   error                                → error
 *   0 membresías activas                 → sin_membresia
 *   exactamente 1 membresía super_admin  → esa (flujo separado; gf_soporte_tenant aparte);
 *                                          con varias, se elige igual que el resto
 *   gf_tenant con membresía activa       → esa
 *   gf_tenant sin membresía activa       → cookie_invalida (falla cerrado)
 *   sin cookie, 1 membresía              → esa
 *   sin cookie, >1 membresías            → seleccionar (opciones de esta app)
 */
export function seleccionarMembresia(entrada: {
  error: unknown;
  filas: readonly FilaMembresia[] | null | undefined;
  cookieTenantId: string | null | undefined;
  app: AppAcceso;
}): SeleccionMembresia {
  if (entrada.error) return { tipo: "error" };
  const filas = (entrada.filas ?? []).filter((f) => f && typeof f.tenant_id === "string");
  if (filas.length === 0) return { tipo: "sin_membresia" };

  const superAdmin = filas.filter((f) => rolDeFila(f) === "super_admin");
  const superUnica = superAdmin.length === 1 ? superAdmin[0] : undefined;
  if (superUnica) return { tipo: "resuelta", membresia: superUnica, origen: "super_admin" };

  const cookie = (entrada.cookieTenantId ?? "").trim();
  if (cookie) {
    if (!UUID.test(cookie)) return { tipo: "cookie_invalida" };
    const coincidencias = filas.filter((f) => f.tenant_id === cookie);
    const elegida = coincidencias.length === 1 ? coincidencias[0] : undefined;
    return elegida ? { tipo: "resuelta", membresia: elegida, origen: "cookie" } : { tipo: "cookie_invalida" };
  }

  const unica = filas.length === 1 ? filas[0] : undefined;
  if (unica) return { tipo: "resuelta", membresia: unica, origen: "unica" };

  return { tipo: "seleccionar", opciones: opcionesSeleccion(filas, entrada.app) };
}

export type DecisionAccesoUsuario = DecisionAcceso | { tipo: "seleccionar_residencial"; limpiarCookie: boolean };

export interface ResultadoAccesoUsuario {
  seleccion: SeleccionMembresia;
  decision: DecisionAccesoUsuario;
  /** tenant_id sobre el que se evaluó la decisión (null si no hay uno). */
  tenantId: string | null;
}

/**
 * Selección explícita + decisión sobre ESA membresía (mismo orden de
 * siempre: error → membresía → super_admin → suspensión → suscripción →
 * rol → onboarding).
 */
export function resolverAccesoUsuario(entrada: {
  error: unknown;
  filas: readonly FilaMembresia[] | null | undefined;
  cookieTenantId: string | null | undefined;
  app: AppAcceso;
  ahora?: Date;
}): ResultadoAccesoUsuario {
  const seleccion = seleccionarMembresia(entrada);
  switch (seleccion.tipo) {
    case "error":
      return { seleccion, decision: { tipo: "sin_acceso", motivo: "error" }, tenantId: null };
    case "sin_membresia":
      return { seleccion, decision: { tipo: "sin_acceso", motivo: "sin_membresia" }, tenantId: null };
    case "cookie_invalida":
      return { seleccion, decision: { tipo: "seleccionar_residencial", limpiarCookie: true }, tenantId: null };
    case "seleccionar":
      return {
        seleccion,
        decision: seleccion.opciones.length > 0 ? { tipo: "seleccionar_residencial", limpiarCookie: false } : { tipo: "sin_acceso", motivo: "rol" },
        tenantId: null,
      };
    case "resuelta":
      return {
        seleccion,
        decision: resolverAcceso({ error: null, membresia: seleccion.membresia as MembresiaAcceso, ahora: entrada.ahora, app: entrada.app }),
        tenantId: seleccion.membresia.tenant_id,
      };
  }
}

/**
 * Admin, al elegir un residencial: admin_residencial guarda gf_tenant y
 * entra; guardia NO guarda nada en Admin y va a Guard (que hace su
 * propia selección y guarda su propia cookie).
 */
export function resultadoEleccionAdmin(rol: string | null): { guardarCookie: boolean; destino: "panel" | "guard" | "sin_acceso" } {
  if (rol === "admin_residencial" || rol === "super_admin") return { guardarCookie: true, destino: "panel" };
  if (rol === "guardia") return { guardarCookie: false, destino: "guard" };
  return { guardarCookie: false, destino: "sin_acceso" };
}

/** Guard, al elegir: guarda gf_tenant (de Guard) si el rol opera en Guard. */
export function resultadoEleccionGuard(rol: string | null): { guardarCookie: boolean } {
  return { guardarCookie: rol !== null && ROLES_SELECCIONABLES.guard.includes(rol) };
}
