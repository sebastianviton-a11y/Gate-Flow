import { puedeUsarPanelAdmin } from "@gateflow/auth/client";

/**
 * Lo que devuelve la consulta del middleware:
 * user_tenants.select("roles(clave), tenants(onboarding_completado, estado_servicio)").
 */
export type MembresiaPanel = {
  roles: unknown;
  tenants: unknown;
} | null;

/**
 * Misma consulta en el middleware, /sin-acceso, el login y la aceptación
 * de invitación: el destino se decide siempre con la membresía activa.
 */
export const SELECT_MEMBRESIA_PANEL = "roles(clave), tenants(onboarding_completado, estado_servicio)";

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

/**
 * true solo para una membresía activa, leída sin error, con tenant
 * legible y habilitado (estado_servicio piloto o activo), rol
 * exactamente "guardia", y con la URL de Guard configurada. Sin
 * membresía, inactivo (la consulta filtra activo=true), tenant
 * suspendido/cancelado/desconocido, rol desconocido o error → false.
 * Solo cambia el destino: guardia nunca pasa al panel Admin.
 */
const ESTADOS_TENANT_HABILITADO = ["piloto", "activo"];

export function redirigeAGuard(error: unknown, membership: MembresiaPanel | undefined, urlGuard: string | null = urlAppGuard()): boolean {
  if (error || !membership || !urlGuard) return false;
  const tenantData = membership.tenants as { estado_servicio?: string } | null;
  if (!tenantData || !ESTADOS_TENANT_HABILITADO.includes(tenantData.estado_servicio ?? "")) return false;
  return (membership.roles as { clave: string | null } | null)?.clave === "guardia";
}

/**
 * Decide a dónde va una petición autenticada a una ruta protegida del
 * panel Admin. Devuelve null si puede pasar. Falla cerrado: un error de
 * lectura, una membresía incompleta o un rol fuera de ROLES_PANEL_ADMIN
 * nunca dejan pasar. Orden: error → sin membresía → membresía ilegible
 * → suspensión → rol. Solo un guardia de un residencial habilitado va a
 * la app Guard (URL absoluta).
 */
export function destinoPanelAdmin(
  error: unknown,
  membership: MembresiaPanel | undefined,
  urlGuard: string | null = urlAppGuard(),
): string | null {
  if (error) return "/sin-acceso?motivo=error";
  if (!membership) return "/sin-acceso";

  const tenantData = membership.tenants as { onboarding_completado: boolean; estado_servicio: string } | null;
  const claveRol = (membership.roles as { clave: string | null } | null)?.clave;

  if (!tenantData || !claveRol) return "/sin-acceso?motivo=error";

  // RIESGO 3 (PERMISSIONS.md): un residencial suspendido se bloquea de
  // verdad, salvo para super_admin (que necesita poder entrar como
  // soporte a un tenant suspendido para resolver el motivo). Tiene
  // prioridad sobre el rol: un guardia de un residencial suspendido no
  // se manda a Guard.
  if (tenantData.estado_servicio === "suspendido" && claveRol !== "super_admin") {
    return "/residencial-suspendido";
  }

  if (!puedeUsarPanelAdmin(claveRol)) {
    return redirigeAGuard(error, membership, urlGuard) ? `${urlGuard}/guard` : "/sin-acceso?motivo=rol";
  }

  if (tenantData.onboarding_completado === false) return "/onboarding";

  return null;
}

/**
 * Después de autenticarse en Admin (login o contraseña de invitación):
 * un guardia termina en Guard; cualquier otro caso sigue el flujo de
 * Admin, donde el middleware decide (panel o /sin-acceso).
 * La sesión de Admin no viaja a Guard (dominios distintos): en Guard se
 * inicia sesión allí.
 */
export function destinoTrasAutenticar(
  error: unknown,
  membership: MembresiaPanel | undefined,
  rutas: { admin: string; guard: string },
  urlGuard: string | null = urlAppGuard(),
): { enGuard: boolean; url: string } {
  if (redirigeAGuard(error, membership, urlGuard)) return { enGuard: true, url: `${urlGuard}${rutas.guard}` };
  return { enGuard: false, url: rutas.admin };
}

/** /sin-acceso?motivo=rol muestra "Ir a la app de Guardia" solo a un guardia real. */
export function mostrarCtaGuard(
  motivo: string | undefined,
  error: unknown,
  membership: MembresiaPanel | undefined,
  urlGuard: string | null = urlAppGuard(),
): boolean {
  return motivo === "rol" && redirigeAGuard(error, membership, urlGuard);
}
