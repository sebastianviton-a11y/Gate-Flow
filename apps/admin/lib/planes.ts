/**
 * Planes que muestra /suscripcion. Fuente única para la pantalla y,
 * más adelante, para el checkout: conectar Stripe o Mercado Pago es
 * cambiar la acción de un plan a "checkout" e implementar su handler,
 * sin rehacer la pantalla. Hoy ningún plan cobra.
 */
export const CORREO_SOPORTE = "soporte@gateflow.mx";

export type AccionPlan =
  /** Pagos todavía no disponibles: botón deshabilitado, sin fingir cobro. */
  | { tipo: "proximamente" }
  /** Reservado para la fase de pagos (no se usa todavía). */
  | { tipo: "checkout"; planId: string }
  | { tipo: "contacto"; href: string };

export interface Plan {
  id: "hasta-50" | "hasta-150" | "mas-150";
  nombre: string;
  /** null = sin precio publicado (contacto). */
  precio: { moneda: "USD"; monto: number; periodo: "mes" } | null;
  accion: AccionPlan;
}

export const PLANES: readonly Plan[] = [
  { id: "hasta-50", nombre: "Hasta 50 viviendas", precio: { moneda: "USD", monto: 29, periodo: "mes" }, accion: { tipo: "proximamente" } },
  { id: "hasta-150", nombre: "Hasta 150 viviendas", precio: { moneda: "USD", monto: 49, periodo: "mes" }, accion: { tipo: "proximamente" } },
  { id: "mas-150", nombre: "Más de 150 viviendas", precio: null, accion: { tipo: "contacto", href: `mailto:${CORREO_SOPORTE}?subject=Plan%20para%20m%C3%A1s%20de%20150%20viviendas` } },
];
