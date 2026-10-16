import type { MouseEvent } from "react";

// Destinos de los enlaces secundarios de la landing V2, centralizados en
// un solo lugar para no inventar URLs. Los del panel salen de
// NEXT_PUBLIC_ADMIN_APP_URL (login y las páginas legales que se aceptan al
// registrarse); sin esa variable quedan en "#" y el enlace no navega.
// Contacto y soporte usan el correo de soporte que ya muestra el panel.
//
// Actualizar aquí cuando cambie un destino — no hace falta tocar los
// componentes que los usan.
const CORREO_SOPORTE = "soporte@gateflow.mx";

/**
 * Alta de prueba (30 días gratis) en el panel Admin: `${NEXT_PUBLIC_ADMIN_APP_URL}/registro`.
 * Misma variable que usa apps/admin. Se resuelve en build (Next inlinea
 * NEXT_PUBLIC_*): en el preview/staging de la landing apunta al Admin de
 * staging. Sin variable (o con un valor que no sea http/https), los CTAs
 * conservan su ancla de la página — nunca se inventa un dominio.
 */
const ADMIN_APP_URL = normalizarUrlAdmin(process.env.NEXT_PUBLIC_ADMIN_APP_URL);

/**
 * Modo «Solicitar demo» (NEXT_PUBLIC_LANDING_MODO=demo): mientras el alta
 * de prueba no esté abierta en el panel de clientes, todos los CTAs de
 * prueba dicen «Solicitar demo» y abren el contacto de demo, y no se
 * muestran los enlaces legales (son los documentos que se aceptan en
 * /registro; hasta publicarlos no hay una página a la que llevar). Sin la
 * variable (staging, previews) todo queda como antes. Se resuelve en
 * build, igual que NEXT_PUBLIC_ADMIN_APP_URL.
 */
export const MODO_DEMO = process.env.NEXT_PUBLIC_LANDING_MODO === "demo";

/** Contacto de demo: NEXT_PUBLIC_LANDING_CONTACTO_DEMO (mailto: o https://,
 * p. ej. WhatsApp); sin valor válido, el correo de soporte. */
const CONTACTO_DEMO =
  normalizarContactoDemo(process.env.NEXT_PUBLIC_LANDING_CONTACTO_DEMO) ??
  `mailto:${CORREO_SOPORTE}?subject=${encodeURIComponent("Solicitud de demo - Gate Flow")}`;

export const V2_LINKS = {
  /** Header desktop y menú mobile: login del panel Admin. */
  ingresar: ADMIN_APP_URL ? `${ADMIN_APP_URL}/login` : "#",
  /** "Contactar →" (precios, más de 150 viviendas) y "Contacto" (footer). */
  contacto: `mailto:${CORREO_SOPORTE}?subject=Gate%20Flow`,
  /** "Soporte" (footer). */
  soporte: `mailto:${CORREO_SOPORTE}`,
  /** "Privacidad" (Seguridad y footer): la misma que se acepta en /registro. */
  privacidad: ADMIN_APP_URL ? `${ADMIN_APP_URL}/privacidad` : "#",
  /** "Términos" (Seguridad y footer): los mismos que se aceptan en /registro. */
  terminos: ADMIN_APP_URL ? `${ADMIN_APP_URL}/terminos` : "#",
  /** CTAs de prueba en modo demo. */
  demo: CONTACTO_DEMO,
} as const;

/** Privacidad y Términos solo se muestran fuera del modo demo. */
export const MOSTRAR_LEGALES = !MODO_DEMO;

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

export function normalizarContactoDemo(valor: string | undefined): string | null {
  const contacto = (valor ?? "").trim();
  return /^mailto:[^\s@/]+@[^\s@/]+\.[^\s@/]+|^https:\/\/[^/\s]+/.test(contacto) ? contacto : null;
}

/** Destino de un CTA de prueba: /registro del panel o, en modo demo, el contacto de demo. */
export function ctaHref(anclaSinDestino: string, plan?: PlanRegistro, modoDemo: boolean = MODO_DEMO): string {
  return modoDemo ? V2_LINKS.demo : registroHref(anclaSinDestino, plan);
}

/** Texto de un CTA de prueba («Probar gratis…») o «Solicitar demo» en modo demo. */
export function ctaTexto(textoPrueba: string, modoDemo: boolean = MODO_DEMO): string {
  return modoDemo ? "Solicitar demo" : textoPrueba;
}

export function registroHref(anclaSinDestino: string, plan?: PlanRegistro, base: string | null = ADMIN_APP_URL): string {
  if (!base) return anclaSinDestino;
  return plan ? `${base}/registro?plan=${plan}` : `${base}/registro`;
}

/** Solo un enlace todavía sin destino ("#") se queda quieto: se evita el
 * salto al inicio de página. Con destino real, navega normalmente. */
export function preventPendingLinkClick(e: MouseEvent<HTMLAnchorElement>) {
  if (e.currentTarget.getAttribute("href") === "#") e.preventDefault();
}
