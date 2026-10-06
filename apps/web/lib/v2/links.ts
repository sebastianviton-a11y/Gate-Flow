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
  /** "Contactar →" (precios, más de 150 viviendas) y "Contacto" (footer). Por confirmar: formulario, correo o WhatsApp. */
  contacto: "#",
  /** "Soporte" (footer). Por confirmar. */
  soporte: "#",
  /** "Privacidad" (Seguridad y footer). Página por crear — ver 06-pendientes.md A.2. */
  privacidad: "#",
  /** "Términos" (Seguridad y footer). Página por crear — ver 06-pendientes.md A.2. */
  terminos: "#",
} as const;

/**
 * Alta de prueba (30 días gratis) en el panel Admin: `${NEXT_PUBLIC_ADMIN_APP_URL}/registro`.
 * Misma variable que usa apps/admin. Se resuelve en build (Next inlinea
 * NEXT_PUBLIC_*): en el preview/staging de la landing apunta al Admin de
 * staging. Sin variable (o con un valor que no sea http/https), los CTAs
 * conservan su ancla de la página — nunca se inventa un dominio.
 */
const ADMIN_APP_URL = normalizarUrlAdmin(process.env.NEXT_PUBLIC_ADMIN_APP_URL);

/**
 * Plan elegido en precios. Solo contexto comercial para /registro
 * (atribución / checkout futuro): no decide prueba, precio, permisos ni
 * viviendas — eso lo resuelve el servidor del panel.
 */
export type PlanRegistro = "hasta-50" | "hasta-150";

export function normalizarUrlAdmin(valor: string | undefined): string | null {
  const url = (valor ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+/.test(url) ? url : null;
}

export function registroHref(anclaSinDestino: string, plan?: PlanRegistro, base: string | null = ADMIN_APP_URL): string {
  if (!base) return anclaSinDestino;
  return plan ? `${base}/registro?plan=${plan}` : `${base}/registro`;
}

/** Los links de arriba no tienen destino todavía: se evita el salto al
 * inicio de página que produciría un href="#" sin manejar el click. */
export function preventPendingLinkClick(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
}
