/**
 * Rutas del panel Admin (apps/admin/app) que la landing redirige al panel
 * cuando se publica en el dominio que antes era del panel (next.config.mjs).
 * Incluye las de producción actual y las que ya existen en staging, para
 * que ningún enlace viejo o futuro a gateflow.mx/<ruta del panel> termine
 * en la landing. La landing solo usa "/", "/v2/…" y sus archivos.
 */
export const RUTAS_PANEL = [
  "login",
  "aceptar-invitacion",
  "recuperar-password",
  "restablecer-password",
  "confirmar-cuenta",
  "registro",
  "terminos",
  "privacidad",
  "acuerdo-datos",
  "residencial-suspendido",
  "sin-acceso",
  "seleccionar-residencial",
  "suscripcion",
  "alta-residente",
  "onboarding",
  "dashboard",
  "paquetes",
  "unidades",
  "residentes",
  "incidencias",
  "usuarios",
  "configuracion",
  "superadmin",
];

/** Igual que normalizarUrlAdmin (links.ts): http(s) sin "/" final, o null. */
export function urlPanel(valor) {
  const url = (valor ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+/.test(url) ? url : null;
}
