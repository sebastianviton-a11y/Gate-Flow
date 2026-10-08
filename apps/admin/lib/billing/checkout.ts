import { validarPlanParaViviendas, viviendasRequeridas, type PlanBilling } from "./catalogo";
import { contratacionHabilitada } from "./pais";
import { motivoDeErrorRpc, type BillingProvider, type MotivoCheckout } from "./tipos";

/**
 * Núcleo del alta de pago, sin Next ni Supabase (dependencias
 * inyectadas: testeable sin red). Orden:
 *   país del residencial (Argentina: sin contratación paga, pais.ts)
 *   → plan del catálogo (solo planId del navegador) → viviendas
 *   → checkout en NUESTRA base (RPC: rol, estado, viviendas otra vez)
 *   → expirar checkouts anteriores en el proveedor
 *   → sesión hospedada del proveedor → registrar su id → URL.
 * El usuario y el tenant llegan ya autorizados (autorizacion.ts).
 */

/** Vigencia de la sesión hospedada (el proveedor exige ≥ 30 min). */
export const MINUTOS_VIGENCIA_CHECKOUT = 60;

export interface DepsCheckout {
  proveedor: BillingProvider;
  /** URL pública de Admin (https, sin "/" final). Nunca el Host de la petición. */
  urlBase: string;
  /** tenants.pais del residencial, leído en el servidor (nunca del navegador). */
  paisDelTenant(tenantId: string): Promise<string | null>;
  contarViviendas(tenantId: string): Promise<{ declaradas: number | null; unidadesActivas: number }>;
  crearCheckoutEnBase(datos: {
    userId: string;
    tenantId: string;
    plan: PlanBilling;
    expiraEn: Date;
  }): Promise<{ checkoutId: string; anteriores: string[] }>;
  registrarCheckoutProveedor(checkoutId: string, providerCheckoutId: string): Promise<void>;
  clienteExistente(tenantId: string): Promise<string | null>;
  ahora?: () => Date;
  log?: (mensaje: string, datos: Record<string, unknown>) => void;
}

export interface EntradaCheckout {
  userId: string;
  tenantId: string;
  /** Lo ÚNICO que aporta el navegador. */
  planId: unknown;
  emailPagador: string | null;
}

export type ResultadoCheckout = { ok: true; url: string; checkoutId: string } | { ok: false; motivo: MotivoCheckout };

export async function iniciarCheckout(deps: DepsCheckout, entrada: EntradaCheckout): Promise<ResultadoCheckout> {
  const log = deps.log ?? (() => {});
  const ahora = (deps.ahora ?? (() => new Date()))();

  // Antes de tocar la base o el proveedor: sin país legible, falla cerrado.
  let pais: string | null;
  try {
    pais = await deps.paisDelTenant(entrada.tenantId);
  } catch {
    pais = null;
  }
  if (!pais) return { ok: false, motivo: "error" };
  if (!contratacionHabilitada(pais)) {
    log("billing.checkout_rechazado", { tenant_id: entrada.tenantId, motivo: "pais" });
    return { ok: false, motivo: "pais" };
  }

  const { declaradas, unidadesActivas } = await deps.contarViviendas(entrada.tenantId);
  const validacion = validarPlanParaViviendas(entrada.planId, viviendasRequeridas(declaradas, unidadesActivas));
  if (!validacion.ok) return { ok: false, motivo: validacion.motivo };
  const plan = validacion.plan;
  const expiraEn = new Date(ahora.getTime() + MINUTOS_VIGENCIA_CHECKOUT * 60_000);

  let checkoutId: string;
  let anteriores: string[];
  try {
    ({ checkoutId, anteriores } = await deps.crearCheckoutEnBase({ userId: entrada.userId, tenantId: entrada.tenantId, plan, expiraEn }));
  } catch (e) {
    const motivo = motivoDeErrorRpc(e instanceof Error ? e.message : String(e));
    log("billing.checkout_rechazado", { tenant_id: entrada.tenantId, motivo });
    return { ok: false, motivo };
  }

  // Un solo checkout abierto: los anteriores se expiran también en el
  // proveedor (si uno ya se pagó, el webhook lo resuelve igual).
  for (const anterior of anteriores) {
    try {
      await deps.proveedor.expirarCheckout(anterior);
    } catch {
      log("billing.expirar_checkout_fallo", { tenant_id: entrada.tenantId });
    }
  }

  let sesion;
  try {
    sesion = await deps.proveedor.crearCheckout({
      checkoutId,
      tenantId: entrada.tenantId,
      plan,
      emailPagador: entrada.emailPagador,
      customerId: await deps.clienteExistente(entrada.tenantId),
      urlExito: `${deps.urlBase}/suscripcion/procesando?c=${encodeURIComponent(checkoutId)}`,
      urlCancelar: `${deps.urlBase}/suscripcion`,
      expiraEn,
    });
  } catch {
    log("billing.proveedor_fallo", { tenant_id: entrada.tenantId, checkout_id: checkoutId });
    return { ok: false, motivo: "proveedor" };
  }

  await deps.registrarCheckoutProveedor(checkoutId, sesion.providerCheckoutId);
  log("billing.checkout_creado", { tenant_id: entrada.tenantId, checkout_id: checkoutId, plan: plan.id });
  return { ok: true, url: sesion.url, checkoutId };
}

/** Solo planId: cualquier otro campo del formulario (monto, moneda, tenant) se ignora. */
export function planIdDeFormulario(formulario: FormData): string | null {
  const valor = formulario.get("plan");
  return typeof valor === "string" ? valor : null;
}
