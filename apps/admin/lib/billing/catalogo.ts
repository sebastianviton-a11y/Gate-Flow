/**
 * Catálogo de planes de autoservicio: ÚNICA fuente de los montos que se
 * cobran. Se resuelve siempre en el servidor; el navegador solo envía
 * planId. Cambiar un precio = cambiar este archivo (y nada más): la
 * lógica de billing no conoce montos.
 *
 * ⚠ PENDIENTES DE APROBACIÓN COMERCIAL ⚠
 * Los montos MXN de abajo son de desarrollo/test. No usar en producción
 * sin aprobación: docs/operations/BILLING.md, "Precios".
 *
 * Los límites de viviendas también viven en la base
 * (public.billing_limite_plan, migración 20261008100000): un test
 * verifica que coincidan.
 */

import { esEntornoDePruebas } from "../entorno";

export type PlanBillingId = "hasta-50" | "hasta-150";
export type MonedaBilling = "MXN";

export interface PlanBilling {
  id: PlanBillingId;
  nombre: string;
  limiteViviendas: number;
  moneda: MonedaBilling;
  /** En centavos (unidad mínima), como lo recibe el proveedor. */
  monto: number;
  /** Precio comercial de referencia (landing); no se cobra en USD. */
  referenciaUsd: number;
  activo: boolean;
}

/** true mientras los montos MXN no estén aprobados comercialmente. */
export const MONTOS_PENDIENTES_DE_APROBACION = true;

/**
 * ¿Se pueden mostrar y cobrar los montos en este entorno? Solo si están
 * aprobados comercialmente o si el Admin corre en un entorno de pruebas
 * (local, staging, previews: ahí corren las pruebas de Stripe TEST).
 * En el entorno de clientes, con montos pendientes, no se muestran
 * precios ni se abre un checkout nuevo; las suscripciones existentes y
 * su gestión no cambian.
 */
export function montosPublicables(
  entorno: Readonly<Record<string, string | undefined>>,
  pendientes: boolean = MONTOS_PENDIENTES_DE_APROBACION,
): boolean {
  return !pendientes || esEntornoDePruebas(entorno.NEXT_PUBLIC_ADMIN_APP_URL);
}

export const CATALOGO_BILLING: Readonly<Record<PlanBillingId, PlanBilling>> = {
  "hasta-50": {
    id: "hasta-50",
    nombre: "Hasta 50 viviendas",
    limiteViviendas: 50,
    moneda: "MXN",
    monto: 49_900, // MXN 499.00 — PENDIENTE DE APROBACIÓN COMERCIAL
    referenciaUsd: 29,
    activo: true,
  },
  "hasta-150": {
    id: "hasta-150",
    nombre: "Hasta 150 viviendas",
    limiteViviendas: 150,
    moneda: "MXN",
    monto: 89_900, // MXN 899.00 — PENDIENTE DE APROBACIÓN COMERCIAL
    referenciaUsd: 49,
    activo: true,
  },
};

/** Más de esto no hay autoservicio: "Contactar". */
export const MAX_VIVIENDAS_AUTOSERVICIO = 150;

/** Plan comprable por planId del navegador; cualquier otro valor → null. */
export function planDeCheckout(planId: unknown): PlanBilling | null {
  if (typeof planId !== "string" || !Object.prototype.hasOwnProperty.call(CATALOGO_BILLING, planId)) return null;
  const plan = CATALOGO_BILLING[planId as PlanBillingId];
  return plan.activo ? plan : null;
}

/** Regla aprobada: max(declaradas en el registro, unidades activas). */
export function viviendasRequeridas(declaradas: number | null | undefined, unidadesActivas: number): number {
  return Math.max(declaradas ?? 0, unidadesActivas);
}

export type ValidacionPlan =
  | { ok: true; plan: PlanBilling }
  | { ok: false; motivo: "plan" | "viviendas" | "contacto" };

/** El plan pedido cubre las viviendas del residencial (nunca uno menor). */
export function validarPlanParaViviendas(planId: unknown, viviendas: number): ValidacionPlan {
  if (viviendas > MAX_VIVIENDAS_AUTOSERVICIO) return { ok: false, motivo: "contacto" };
  const plan = planDeCheckout(planId);
  if (!plan) return { ok: false, motivo: "plan" };
  if (viviendas > plan.limiteViviendas) return { ok: false, motivo: "viviendas" };
  return { ok: true, plan };
}

/** "$499" (MXN) para mostrar; el cobro usa monto en centavos. */
export function formatearMonto(plan: Pick<PlanBilling, "moneda" | "monto">): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: plan.moneda,
    minimumFractionDigits: plan.monto % 100 === 0 ? 0 : 2,
  }).format(plan.monto / 100);
}
