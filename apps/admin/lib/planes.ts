import { CATALOGO_BILLING, formatearMonto, type PlanBillingId } from "./billing/catalogo";

/**
 * Planes que muestra /suscripcion. Los montos NO viven aquí: salen del
 * catálogo del servidor (lib/billing/catalogo.ts, montos MXN pendientes
 * de aprobación comercial). Esto solo arma la presentación; el cobro
 * vuelve a resolver el plan en el servidor a partir de su id.
 */
export const CORREO_SOPORTE = "soporte@gateflow.mx";

export type AccionPlan =
  /** Alta por checkout hospedado (server action con planId). */
  | { tipo: "checkout"; planId: PlanBillingId }
  | { tipo: "contacto"; href: string };

export interface Plan {
  id: PlanBillingId | "mas-150";
  nombre: string;
  /** null = sin límite publicado (contacto). */
  limiteViviendas: number | null;
  /** null = sin precio publicado (contacto). */
  precio: { texto: string; periodo: "mes"; referenciaUsd: number } | null;
  accion: AccionPlan;
}

function planDeCatalogo(id: PlanBillingId): Plan {
  const p = CATALOGO_BILLING[id];
  return {
    id,
    nombre: p.nombre,
    limiteViviendas: p.limiteViviendas,
    precio: { texto: formatearMonto(p), periodo: "mes", referenciaUsd: p.referenciaUsd },
    accion: { tipo: "checkout", planId: id },
  };
}

export const PLANES: readonly Plan[] = [
  planDeCatalogo("hasta-50"),
  planDeCatalogo("hasta-150"),
  {
    id: "mas-150",
    nombre: "Más de 150 viviendas",
    limiteViviendas: null,
    precio: null,
    accion: { tipo: "contacto", href: `mailto:${CORREO_SOPORTE}?subject=Plan%20para%20m%C3%A1s%20de%20150%20viviendas` },
  },
];
