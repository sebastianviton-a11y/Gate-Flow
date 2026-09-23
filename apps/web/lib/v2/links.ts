import type { MouseEvent } from "react";

// Destinos pendientes de la landing V2 — centralizados en un solo lugar
// para no inventar URLs (ver handoff 06-pendientes.md, sección B.1).
// Mientras no exista el destino real, el link es un `<a>` real y
// accesible, pero sin acción de navegación (se previene el "salto" al
// inicio de la página que produciría un href="#" normal).
//
// Actualizar aquí cuando cada destino esté definido — no hace falta tocar
// los componentes que los usan.
export const V2_LINKS = {
  /** Header desktop y menú mobile. URL del login de la app: por confirmar. */
  ingresar: "#",
  /** CTA final ("Comenzar prueba gratis"). Sin destino hasta tener la URL del flujo de prueba. */
  comenzarPrueba: "#",
  /** "Contactar →" (precios, más de 150 viviendas) y "Contacto" (footer). Por confirmar: formulario, correo o WhatsApp. */
  contacto: "#",
  /** "Soporte" (footer). Por confirmar. */
  soporte: "#",
  /** "Privacidad" (Seguridad y footer). Página por crear — ver 06-pendientes.md A.2. */
  privacidad: "#",
  /** "Términos" (Seguridad y footer). Página por crear — ver 06-pendientes.md A.2. */
  terminos: "#",
} as const;

/** Los links de arriba no tienen destino todavía: se evita el salto al
 * inicio de página que produciría un href="#" sin manejar el click. */
export function preventPendingLinkClick(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
}
