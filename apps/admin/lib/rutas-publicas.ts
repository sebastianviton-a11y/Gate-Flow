/**
 * Rutas del panel Admin que el middleware no protege con sesión. Viven
 * aquí, sin imports de Next, para poder probarlas (lib/__tests__).
 */

/** "Solo para invitados": con sesión activa se redirige al dashboard.
 * /registro es el alta pública con trial (app/registro). */
export const RUTAS_SOLO_INVITADOS = ["/login", "/registro"] as const;

/**
 * "Siempre accesibles", con o sin sesión:
 *   /aceptar-invitacion  establece una sesión ANTES de que exista la
 *                        contraseña; aplicar "solo invitados" sacaría a
 *                        la persona a mitad del proceso.
 *   /confirmar-cuenta    recibe el enlace del correo de /registro y
 *                        establece la sesión (mismo patrón).
 *   /terminos, /privacidad  contenido legal que cualquiera debe poder
 *                        leer sin ser redirigido (se enlazan desde el
 *                        checkbox de /registro y de /aceptar-invitacion).
 *   /sin-acceso          destino de quien tiene sesión pero no un
 *                        residencial activo; no consulta la sesión, así
 *                        que no puede entrar en bucle.
 *   /alta-residente      formulario que el administrador comparte con
 *                        los residentes: no usa la sesión (un admin con
 *                        sesión puede abrirlo para probarlo).
 */
export const RUTAS_SIEMPRE_PUBLICAS = [
  "/aceptar-invitacion",
  "/confirmar-cuenta",
  "/terminos",
  "/privacidad",
  "/residencial-suspendido",
  "/recuperar-password",
  "/restablecer-password",
  "/sin-acceso",
  "/alta-residente",
] as const;

/**
 * Rutas de cuenta: exigen sesión, pero el middleware NO aplica la
 * redirección por membresía/suscripción; la propia página decide con
 * la misma lógica (así /suscripcion nunca entra en bucle).
 */
export const RUTAS_CUENTA = ["/suscripcion", "/seleccionar-residencial"] as const;

/**
 * Webhooks de billing: fuera del middleware (excluidos en su matcher).
 * No tienen sesión; se autentican por la firma del proveedor sobre el
 * cuerpo crudo (lib/billing). Nunca deben pasar por /login.
 */
export const RUTA_WEBHOOKS_BILLING = "/api/billing/webhook/";

export function esRutaPublica(pathname: string): boolean {
  return [...RUTAS_SOLO_INVITADOS, ...RUTAS_SIEMPRE_PUBLICAS].some((ruta) => pathname.startsWith(ruta));
}
