import {
  RUTA_SELECCIONAR_RESIDENCIAL,
  SELECT_MEMBRESIAS_ACCESO,
  resolverAcceso,
  resolverAccesoUsuario,
  rolDeFila,
  seleccionarMembresia,
  type DecisionAcceso,
  type DecisionAccesoUsuario,
  type FilaMembresia,
  type MembresiaAcceso,
  type ResultadoAccesoUsuario,
} from "@gateflow/auth/client";

/**
 * Destinos del panel Admin. La decisión (orden error → membresía →
 * super_admin → suspensión → suscripción → rol → onboarding) vive en
 * @gateflow/auth (acceso.ts), compartida con Guard; aquí solo se
 * traduce a rutas de esta app.
 */
export type MembresiaPanel = MembresiaAcceso;

/**
 * Misma consulta en el middleware, el layout, /suscripcion, /sin-acceso,
 * /seleccionar-residencial, el login y la aceptación de invitación:
 * TODAS las membresías activas (sin limit), cada una con su rol, su
 * tenant y la suscripción de ese tenant. La que manda la elige
 * resolverAccesoUsuario con la cookie gf_tenant.
 */
export const SELECT_MEMBRESIA_PANEL = SELECT_MEMBRESIAS_ACCESO;

/**
 * URL pública de la app Guard (NEXT_PUBLIC_GUARD_APP_URL, la misma que ya
 * usa el QR de retiro), sin "/" final. null si falta o no es http(s): en
 * ese caso nadie se redirige a Guard y se mantiene /sin-acceso.
 * La referencia literal a process.env permite que Next la inline también
 * en Client Components.
 */
export function urlAppGuard(valor: string | undefined = process.env.NEXT_PUBLIC_GUARD_APP_URL): string | null {
  const url = (valor ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+$/.test(url) ? url : null;
}

export function decisionPanel(error: unknown, membership: MembresiaPanel | undefined, ahora: Date = new Date()): DecisionAcceso {
  return resolverAcceso({ error, membresia: membership, ahora, app: "admin" });
}

/** Selección explícita (gf_tenant) + decisión sobre esa membresía, en Admin. */
export function resultadoPanel(
  error: unknown,
  filas: readonly FilaMembresia[] | null | undefined,
  cookieTenantId: string | null | undefined,
  ahora: Date = new Date(),
): ResultadoAccesoUsuario {
  return resolverAccesoUsuario({ error, filas, cookieTenantId, app: "admin", ahora });
}

/** Ruta (o URL absoluta de Guard) para una decisión; null = puede pasar. */
export function destinoDeDecision(decision: DecisionAccesoUsuario, urlGuard: string | null = urlAppGuard()): string | null {
  switch (decision.tipo) {
    case "seleccionar_residencial":
      return RUTA_SELECCIONAR_RESIDENCIAL;
    case "permitir":
      return null;
    case "onboarding":
      return "/onboarding";
    case "suspendido":
      return "/residencial-suspendido";
    case "suscripcion":
      return "/suscripcion";
    case "ir_a_guard":
      return urlGuard ? `${urlGuard}/guard` : "/sin-acceso?motivo=rol";
    case "sin_acceso":
      return decision.motivo === "error" ? "/sin-acceso?motivo=error" : decision.motivo === "rol" ? "/sin-acceso?motivo=rol" : "/sin-acceso";
  }
}

/**
 * true solo cuando la decisión es ir a Guard (guardia con membresía
 * activa en un residencial no suspendido, piloto/activo; con o sin
 * suscripción operativa: si no la tiene, Guard muestra servicio
 * inactivo) y la URL de Guard está configurada. Guardia nunca pasa al
 * panel Admin.
 */
export function redirigeAGuard(
  error: unknown,
  membership: MembresiaPanel | undefined,
  urlGuard: string | null = urlAppGuard(),
  ahora: Date = new Date(),
): boolean {
  return urlGuard !== null && decisionPanel(error, membership, ahora).tipo === "ir_a_guard";
}

/**
 * Decide a dónde va una petición autenticada a una ruta protegida del
 * panel Admin. Devuelve null si puede pasar. Falla cerrado.
 */
export function destinoPanelAdmin(
  error: unknown,
  membership: MembresiaPanel | undefined,
  urlGuard: string | null = urlAppGuard(),
  ahora: Date = new Date(),
): string | null {
  return destinoDeDecision(decisionPanel(error, membership, ahora), urlGuard);
}

/**
 * Después de autenticarse en Admin (login o contraseña de invitación),
 * con TODAS las membresías activas y sin cookie (sesión nueva):
 *   una membresía de guardia (habilitada)          → Guard
 *   varias membresías y todas de guardia            → Guard (elige allí)
 *   varias con algún rol de Admin                   → Admin (el middleware
 *                                                     lleva a /seleccionar-residencial)
 *   cualquier otro caso                             → Admin (el middleware decide)
 * Un objeto (no arreglo) se trata como la membresía ya resuelta.
 * La sesión de Admin no viaja a Guard (dominios distintos).
 */
export function destinoTrasAutenticar(
  error: unknown,
  membresias: readonly FilaMembresia[] | MembresiaPanel | undefined,
  rutas: { admin: string; guard: string },
  urlGuard: string | null = urlAppGuard(),
  ahora: Date = new Date(),
): { enGuard: boolean; url: string } {
  const aGuard = { enGuard: true, url: `${urlGuard}${rutas.guard}` };
  const aAdmin = { enGuard: false, url: rutas.admin };
  if (!Array.isArray(membresias)) {
    return redirigeAGuard(error, membresias as MembresiaPanel | undefined, urlGuard, ahora) ? aGuard : aAdmin;
  }
  if (!urlGuard) return aAdmin;
  const seleccion = seleccionarMembresia({ error, filas: membresias, cookieTenantId: null, app: "admin" });
  if (seleccion.tipo === "resuelta") {
    return redirigeAGuard(null, seleccion.membresia as MembresiaPanel, urlGuard, ahora) ? aGuard : aAdmin;
  }
  if (seleccion.tipo === "seleccionar" && seleccion.opciones.length > 0 && seleccion.opciones.every((f) => rolDeFila(f) === "guardia")) {
    return aGuard;
  }
  return aAdmin;
}

/**
 * /sin-acceso?motivo=rol muestra "Ir a la app de Guardia" solo si la
 * membresía SELECCIONADA es de un guardia habilitado. Un objeto (no
 * arreglo) se trata como la membresía ya resuelta.
 */
export function mostrarCtaGuard(
  motivo: string | undefined,
  error: unknown,
  membresias: readonly FilaMembresia[] | MembresiaPanel | undefined,
  urlGuard: string | null = urlAppGuard(),
  ahora: Date = new Date(),
  cookieTenantId: string | null = null,
): boolean {
  if (motivo !== "rol" || !urlGuard) return false;
  if (!Array.isArray(membresias)) return redirigeAGuard(error, membresias as MembresiaPanel | undefined, urlGuard, ahora);
  return resultadoPanel(error, membresias, cookieTenantId, ahora).decision.tipo === "ir_a_guard";
}
