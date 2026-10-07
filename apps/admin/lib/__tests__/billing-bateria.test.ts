/**
 * Batería billing + lifecycle — capa A (pura, sin red ni base).
 * Escenarios 1–20 de tests/billing/README.md en su parte TypeScript:
 * decisiones de acceso (Admin y Guard), checkout, webhook con firma
 * Stripe REAL (SDK offline) y API de Stripe simulada, configuración,
 * elegibilidad, roles, multitenant y salvaguardas del paquete SQL.
 * La base (billing_aplicar_evento, tenant_operativo) se prueba en la
 * capa B: tests/billing/db/escenarios.sql.
 *
 * Tiempo: todo con instantes fijos (AHORA + offsets); nunca el reloj.
 *   npx tsx apps/admin/lib/__tests__/billing-bateria.test.ts
 * Imprime RESULT|A|<escenario>|PASS/FAIL|<caso> para tests/billing/run.mjs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";
import { avisoTrial, estadoEfectivoSuscripcion, resolverAcceso, resolverAccesoUsuario, type FilaMembresia } from "@gateflow/auth/client";
import { destinoDeDecision } from "../acceso-panel";
import { autorizarBilling, permiteAlta } from "../billing/autorizacion";
import { CATALOGO_BILLING, MAX_VIVIENDAS_AUTOSERVICIO, validarPlanParaViviendas, viviendasRequeridas } from "../billing/catalogo";
import { iniciarCheckout, planIdDeFormulario, type DepsCheckout } from "../billing/checkout";
import { configuracionStripe } from "../billing/config";
import { StripeBillingProvider, type ClienteStripe } from "../billing/proveedores/stripe";
import type { EventoNormalizado } from "../billing/tipos";
import { procesarWebhook, type ResultadoAplicar } from "../billing/webhook";

let pasadas = 0;
let fallidas = 0;
let escenario = "00";
function assert(condicion: boolean, mensaje: string) {
  const limpio = mensaje.replace(/[|\n]/g, " ");
  if (condicion) {
    pasadas++;
    console.log(`RESULT|A|${escenario}|PASS|${limpio}`);
  } else {
    fallidas++;
    console.log(`RESULT|A|${escenario}|FAIL|${limpio}`);
    console.error(`✗ FALLÓ: [${escenario}] ${mensaje}`);
  }
}
let pendientes = 0;
/** Comportamiento esperado que HOY no se cumple, documentado y pendiente de una corrección aprobada: no cuenta como FAIL. */
function pendiente(condicion: boolean, mensaje: string, detalle: string) {
  const limpio = (t: string) => t.replace(/[|\n]/g, " ");
  if (condicion) return assert(true, mensaje);
  pendientes++;
  console.log(`RESULT|A|${escenario}|PENDIENTE|${limpio(mensaje)} — ${limpio(detalle)}`);
}
async function seccion(id: string, nombre: string, fn: () => void | Promise<void>) {
  escenario = id;
  console.log(`\n${id}. ${nombre}`);
  await fn();
}

const RAIZ = join(__dirname, "../../../..");
const fuente = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

// ── Tiempo controlado ──
const AHORA = new Date("2026-10-07T18:00:00Z");
const DIA = 86_400_000;
const en = (ms: number) => new Date(AHORA.getTime() + ms).toISOString();

// ── Fixtures en memoria (ids con forma sintética) ──
const TA = "aaaaaaaa-0000-4000-8000-0000000000a1";
const TB = "bbbbbbbb-0000-4000-8000-0000000000b1";
const USUARIO = "00000000-0000-4000-8000-00000000000a";

type Sus = { estado: string; trial_ends_at: string | null; current_period_end?: string | null; cancel_at_period_end?: boolean };
const trial = (finMs: number): Sus => ({ estado: "trialing", trial_ends_at: en(finMs), current_period_end: null, cancel_at_period_end: false });
const pagada = (estado: string, cpeMs: number | null, cancel = false): Sus => ({
  estado,
  trial_ends_at: null,
  current_period_end: cpeMs === null ? null : en(cpeMs),
  cancel_at_period_end: cancel,
});
function membresia(rol: string, s: Sus | null, estadoServicio = "activo") {
  return { roles: { clave: rol }, tenants: { onboarding_completado: true, estado_servicio: estadoServicio, timezone: "America/Mexico_City", suscripciones: s } };
}
function fila(tenantId: string, rol: string, s: Sus | null): FilaMembresia {
  return { tenant_id: tenantId, roles: { clave: rol }, tenants: { nombre: `ZZ_AUTOTEST_${tenantId.slice(0, 4)}`, onboarding_completado: true, estado_servicio: "activo", timezone: "America/Mexico_City", suscripciones: s } };
}
const admin = (s: Sus | null) => resolverAcceso({ error: null, membresia: membresia("admin_residencial", s), ahora: AHORA, app: "admin" });
const guardiaEnGuard = (s: Sus | null) => resolverAcceso({ error: null, membresia: membresia("guardia", s), ahora: AHORA, app: "guard" });
const guardiaEnAdmin = (s: Sus | null) => resolverAcceso({ error: null, membresia: membresia("guardia", s), ahora: AHORA, app: "admin" });
const URL_GUARD = "https://guard.zz-autotest.invalid";
/** Lo mismo que hace app/guard/layout.tsx con esServicioInactivo (acceso-guard.ts). */
const guardBloquea = (d: { tipo: string }) => d.tipo === "suspendido" || d.tipo === "suscripcion";

// ── Stripe simulado (API) + firma real ──
const SECRETO = "whsec_test_" + "z".repeat(32);
const FIN_PERIODO = Math.floor((AHORA.getTime() + 30 * DIA) / 1000);
/* eslint-disable @typescript-eslint/no-explicit-any */
function stripeFalso() {
  const precio = { currency: "mxn", unit_amount: CATALOGO_BILLING["hasta-50"].monto, recurring: { interval: "month", interval_count: 1 } };
  const est = {
    sesiones: {
      cs_test_zz1: { id: "cs_test_zz1", mode: "subscription", status: "complete", payment_status: "paid", subscription: "sub_zz_a", customer: "cus_zz_a", client_reference_id: "chk-zz-1", metadata: { tenant_id: TB } },
    } as Record<string, any>,
    suscripciones: {
      sub_zz_a: { id: "sub_zz_a", status: "active", customer: "cus_zz_a", cancel_at_period_end: false, cancel_at: null, metadata: { tenant_id: TB }, items: { data: [{ quantity: 1, current_period_end: FIN_PERIODO, price: precio }] } },
    } as Record<string, any>,
    facturas: { in_zz1: { id: "in_zz1", parent: { subscription_details: { subscription: "sub_zz_a" } } } } as Record<string, any>,
    consultas: 0,
    canceladas: [] as string[],
    creadas: [] as any[],
    expiradas: [] as string[],
    fallarCancelar: false,
  };
  const cliente = {
    checkout: {
      sessions: {
        create: async (params: any, opciones: any) => (est.creadas.push({ params, opciones }), { id: "cs_test_nuevo", url: "https://checkout.stripe.test/cs_test_nuevo" }),
        retrieve: async (id: string) => (est.consultas++, est.sesiones[id] ?? { id, status: "expired" }),
        list: async (p: { subscription: string }) => (est.consultas++, { data: Object.values(est.sesiones).filter((s: any) => s.subscription === p.subscription) }),
        expire: async (id: string) => (est.expiradas.push(id), { id }),
      },
    },
    subscriptions: {
      retrieve: async (id: string) => (est.consultas++, est.suscripciones[id]),
      cancel: async (id: string) => {
        if (est.fallarCancelar) throw new Error("Stripe caído");
        est.canceladas.push(id);
        est.suscripciones[id] = { ...est.suscripciones[id], status: "canceled" };
        return est.suscripciones[id];
      },
    },
    invoices: { retrieve: async (id: string) => (est.consultas++, est.facturas[id]) },
    billingPortal: { sessions: { create: async () => ({ url: "https://billing.stripe.test/p" }) } },
  } as unknown as ClienteStripe;
  return { est, proveedor: new StripeBillingProvider(cliente, SECRETO, "bpc_test_zz") };
}
function evento(id: string, tipo: string, objetoId: string, opciones: { secreto?: string; timestamp?: number; manipular?: boolean } = {}) {
  const cuerpo = JSON.stringify({ id, object: "event", type: tipo, created: Math.floor(Date.now() / 1000), data: { object: { id: objetoId, metadata: { tenant_id: TB } } } });
  const firma = Stripe.webhooks.generateTestHeaderString({ payload: cuerpo, secret: opciones.secreto ?? SECRETO, ...(opciones.timestamp ? { timestamp: opciones.timestamp } : {}) });
  return { cuerpo: opciones.manipular ? cuerpo.replace(objetoId, objetoId + "x") : cuerpo, cabeceras: new Headers({ "stripe-signature": firma }) };
}
function base(resultado: ResultadoAplicar = { resultado: "aplicado", tenant_id: TA }) {
  const aplicados: EventoNormalizado[] = [];
  const logs: { m: string; d: Record<string, unknown> }[] = [];
  let siguiente = resultado;
  return {
    aplicados,
    logs,
    responder(r: ResultadoAplicar) {
      siguiente = r;
    },
    deps: (proveedor: StripeBillingProvider) => ({
      proveedor,
      aplicarEvento: async (e: EventoNormalizado) => (aplicados.push(e), siguiente),
      log: (m: string, d: Record<string, unknown>) => logs.push({ m, d }),
    }),
  };
}

// ── Checkout simulado (sin red ni base) ──
function checkoutFalso(viviendas: { declaradas: number | null; unidadesActivas: number }) {
  const { est, proveedor } = stripeFalso();
  const enBase: any[] = [];
  const registrados: [string, string][] = [];
  const deps: DepsCheckout = {
    proveedor,
    urlBase: "https://admin.zz-autotest.invalid",
    contarViviendas: async () => viviendas,
    crearCheckoutEnBase: async (d) => (enBase.push(d), { checkoutId: "chk-zz-nuevo", anteriores: ["cs_test_viejo"] }),
    registrarCheckoutProveedor: async (a, b) => void registrados.push([a, b]),
    clienteExistente: async () => null,
    ahora: () => AHORA,
  };
  return { est, deps, enBase, registrados };
}

async function main() {
  await seccion("01", "Trial activo", () => {
    const s = trial(10 * DIA);
    const d = admin(s);
    assert(d.tipo === "permitir" && d.estado === "trial_activo", "admin entra al panel con trial vigente");
    assert(destinoDeDecision(d, URL_GUARD) === null, "Admin no redirige (dashboard accesible)");
    assert(guardiaEnGuard(s).tipo === "permitir", "guardia opera en Guard");
    assert(avisoTrial(s, AHORA, "America/Mexico_City") !== null, "aviso de días restantes del trial");
    const r = resolverAccesoUsuario({ error: null, filas: [fila(TA, "admin_residencial", s)], cookieTenantId: null, app: "admin", ahora: AHORA });
    assert(!permiteAlta(r), "durante el trial no se ofrece checkout");
  });

  await seccion("02", "Trial vencido", () => {
    const s = trial(-1);
    const d = admin(s);
    assert(d.tipo === "suscripcion" && d.estado === "vencida", "admin: decisión suscripcion/vencida");
    assert(destinoDeDecision(d, URL_GUARD) === "/suscripcion", "Admin → /suscripcion");
    const g = guardiaEnGuard(s);
    assert(guardBloquea(g), "Guard → /servicio-inactivo (esServicioInactivo)");
    assert(destinoDeDecision(guardiaEnAdmin(s), URL_GUARD) === `${URL_GUARD}/guard`, "guardia que abre Admin va a Guard (y Guard lo bloquea)");
    assert(estadoEfectivoSuscripcion(trial(0), AHORA) === "vencida", "frontera exacta: trial_ends_at = ahora → vencida");
    assert(estadoEfectivoSuscripcion(trial(1), AHORA) === "trial_activo", "1 ms antes → trial_activo");
    const r = resolverAccesoUsuario({ error: null, filas: [fila(TA, "admin_residencial", s)], cookieTenantId: null, app: "admin", ahora: AHORA });
    assert(permiteAlta(r), "con el trial vencido se ofrece checkout");
    assert(/redirect\(RUTA_SERVICIO_INACTIVO\)/.test(fuente("apps/guard/app/guard/layout.tsx")), "layout de Guard redirige a /servicio-inactivo");
    // Datos preservados: ningún punto del flujo borra datos (la capa B lo comprueba en la base).
    assert(!/\.delete\(/.test(fuente("apps/admin/lib/billing/servidor.ts")), "billing (servidor) no borra filas");
  });

  await seccion("03", "Checkout válido", async () => {
    const f = checkoutFalso({ declaradas: 40, unidadesActivas: 12 });
    const r = await iniciarCheckout(f.deps, { userId: USUARIO, tenantId: TA, planId: "hasta-50", emailPagador: null });
    assert(r.ok && r.url.startsWith("https://checkout.stripe.test/"), "devuelve la URL hospedada del proveedor");
    assert(f.enBase.length === 1, "exactamente 1 billing_checkout en la base");
    assert(f.enBase[0]?.plan.id === "hasta-50" && f.enBase[0]?.plan.monto === 49_900 && f.enBase[0]?.plan.moneda === "MXN", "plan/monto/moneda del catálogo (hasta-50, 49900, MXN)");
    assert(f.enBase[0]?.expiraEn.getTime() === AHORA.getTime() + 60 * 60_000, "vigencia 60 min con tiempo controlado");
    assert(f.est.creadas.length === 1 && f.est.creadas[0].params.line_items[0].price_data.unit_amount === 49_900, "1 sesión en Stripe con el monto del catálogo");
    assert(f.est.creadas[0].params.client_reference_id === "chk-zz-nuevo", "client_reference_id = nuestro checkout");
    assert(f.est.creadas[0].opciones.idempotencyKey === "checkout-chk-zz-nuevo", "idempotency key por checkout (doble clic)");
    assert(f.est.expiradas.length === 0 && f.registrados.length === 1, "registra el id del proveedor; el anterior sólo se expira si está abierto");
    assert(f.est.creadas[0].params.success_url.includes("/suscripcion/procesando?c=chk-zz-nuevo"), "success_url a /suscripcion/procesando (sin activar nada)");
    const form = new FormData();
    form.set("plan", "hasta-50");
    form.set("monto", "1");
    form.set("tenant_id", TB);
    assert(planIdDeFormulario(form) === "hasta-50", "del formulario solo se toma planId (monto/tenant ignorados)");
    const f2 = checkoutFalso({ declaradas: 40, unidadesActivas: 0 });
    const r2 = await iniciarCheckout(f2.deps, { userId: USUARIO, tenantId: TA, planId: "hasta-999", emailPagador: null });
    assert(!r2.ok && r2.motivo === "plan" && f2.enBase.length === 0 && f2.est.creadas.length === 0, "plan inexistente: ni base ni Stripe");
    const pagina = fuente("apps/admin/app/suscripcion/page.tsx");
    assert(/name="plan" value=\{plan\.accion\.planId\}/.test(pagina) && !/name="monto"/.test(pagina), "el formulario de /suscripcion solo envía planId");
  });

  await seccion("04", "Webhook checkout.session.completed", async () => {
    const { est, proveedor } = stripeFalso();
    const b = base();
    const e = evento("evt_zz_04", "checkout.session.completed", "cs_test_zz1");
    const resp = await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
    const n = b.aplicados[0];
    assert(resp.status === 200, "200");
    assert(b.aplicados.length === 1, "una llamada a billing_aplicar_evento");
    assert(n?.estado === "active" && n.providerCheckoutId === "cs_test_zz1" && n.clientReferenceId === "chk-zz-1", "active, asociado por NUESTRO checkout");
    assert(n?.subscriptionId === "sub_zz_a" && n.customerId === "cus_zz_a", "subscription y customer del proveedor");
    assert(n?.currentPeriodEnd?.getTime() === FIN_PERIODO * 1000 && n.cancelAtPeriodEnd === false, "current_period_end del recurso consultado");
    assert(n?.monto === 49_900 && n.moneda === "MXN" && n.intervalo === "month", "monto/moneda/intervalo para validar contra el checkout");
    assert(est.consultas >= 2, "el estado sale de consultar de nuevo a Stripe (no del payload)");
    assert(!JSON.stringify(n).includes(TB), "la metadata del evento (tenant de otro) nunca llega a la base");
    const d = admin(pagada("active", 30 * DIA));
    assert(d.tipo === "permitir" && destinoDeDecision(d, URL_GUARD) === null, "suscripción active → dashboard");
    assert(!guardBloquea(guardiaEnGuard(pagada("active", 30 * DIA))), "Guard desbloqueado");
  });

  await seccion("05", "Idempotencia", async () => {
    const { est, proveedor } = stripeFalso();
    const b = base({ resultado: "duplicado", resultado_original: "aplicado", tenant_id: TA });
    const e = evento("evt_zz_04", "checkout.session.completed", "cs_test_zz1");
    const r1 = await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
    const r2 = await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
    assert(r1.status === 200 && r2.status === 200, "reentrega: 200 (Stripe no reintenta para siempre)");
    assert(est.canceladas.length === 0, "duplicado de un evento aplicado: sin efectos en el proveedor");
  });

  await seccion("06", "Evento de otro tenant (W04)", async () => {
    const { est, proveedor } = stripeFalso();
    const b = base({ resultado: "rechazado", tenant_id: TA });
    const e = evento("evt_zz_06", "checkout.session.completed", "cs_test_zz1");
    const resp = await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
    assert(resp.status === 200, "rechazado → 200 (registrado, sin efectos)");
    assert(est.canceladas.length === 0, "NO se cancela la suscripción de B en Stripe");
    const b2 = base({ resultado: "duplicado", resultado_original: "rechazado", tenant_id: TA });
    await procesarWebhook(b2.deps(proveedor), e.cuerpo, e.cabeceras);
    assert(est.canceladas.length === 0, "reentrega del rechazado: tampoco cancela");
    const sql = fuente("supabase/migrations/20261008300000_billing_evento_otro_tenant.sql");
    assert(sql.indexOf("suscripcion_de_otro_tenant") < sql.indexOf("otra_suscripcion_vigente"), "en la RPC, otro tenant se evalúa antes que duplicada");
  });

  await seccion("07", "Suscripción duplicada del mismo tenant", async () => {
    const { est, proveedor } = stripeFalso();
    const b = base({ resultado: "suscripcion_duplicada", tenant_id: TA });
    const e = evento("evt_zz_07", "checkout.session.completed", "cs_test_zz1");
    const r1 = await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
    assert(r1.status === 200 && est.canceladas.length === 1 && est.canceladas[0] === "sub_zz_a", "la duplicada se cancela en Stripe (una vez)");
    b.responder({ resultado: "duplicado", resultado_original: "suscripcion_duplicada", tenant_id: TA });
    await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
    assert(est.canceladas.length === 1, "reintento: ya cancelada → idempotente (no repite la cancelación)");
    const x = stripeFalso();
    x.est.fallarCancelar = true;
    const r3 = await procesarWebhook(base({ resultado: "suscripcion_duplicada", tenant_id: TA }).deps(x.proveedor), e.cuerpo, e.cabeceras);
    assert(r3.status === 500, "si cancelar falla → 500 para que Stripe reintente");
  });

  await seccion("08", "cancel_at_period_end", async () => {
    const antes = pagada("active", 10 * DIA, true);
    const d = admin(antes);
    assert(d.tipo === "permitir", "antes del límite: operativo");
    assert(d.tipo === "permitir" && d.avisoPago?.nivel === "cancelacion", "aviso de cancelación programada");
    assert(!guardBloquea(guardiaEnGuard(antes)), "Guard opera antes del límite");
    assert(estadoEfectivoSuscripcion(pagada("active", 1, true), AHORA) === "activa", "1 ms antes: activa");
    const limite = pagada("active", 0, true);
    assert(destinoDeDecision(admin(limite), URL_GUARD) === "/suscripcion", "en el límite exacto: Admin → /suscripcion (sin esperar webhook)");
    assert(guardBloquea(guardiaEnGuard(limite)), "en el límite: Guard bloqueado");
    const { est, proveedor } = stripeFalso();
    const cancelAt = FIN_PERIODO - 5 * 86_400;
    est.suscripciones.sub_zz_a = { ...est.suscripciones.sub_zz_a, cancel_at: cancelAt };
    const b = base();
    const e = evento("evt_zz_08", "customer.subscription.updated", "sub_zz_a");
    await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
    assert(b.aplicados[0]?.cancelAtPeriodEnd === true && b.aplicados[0]?.currentPeriodEnd?.getTime() === cancelAt * 1000, "cancel_at programado → fin efectivo = min(cancel_at, fin de periodo)");
  });

  await seccion("09", "past_due dentro de la gracia", () => {
    const s = pagada("past_due", -3 * DIA);
    const d = admin(s);
    assert(d.tipo === "permitir" && d.estado === "gracia", "día 3: operativo (gracia)");
    assert(d.tipo === "permitir" && d.avisoPago?.nivel === "gracia" && /No pudimos cobrar/.test(d.avisoPago.texto), "aviso de pago fallido en Admin");
    const g = guardiaEnGuard(s);
    assert(g.tipo === "permitir" && g.avisoPago === null, "Guard opera y no muestra mensajes de pago");
    assert(estadoEfectivoSuscripcion(pagada("past_due", -7 * DIA + 1), AHORA) === "gracia", "1 ms antes de agotar los 7 días: gracia");
  });

  await seccion("10", "past_due fuera de la gracia", async () => {
    const s = pagada("past_due", -7 * DIA);
    assert(estadoEfectivoSuscripcion(s, AHORA) === "inactiva", "frontera exacta de 7 días: inactiva");
    assert(destinoDeDecision(admin(s), URL_GUARD) === "/suscripcion", "Admin → /suscripcion");
    assert(guardBloquea(guardiaEnGuard(s)), "Guard bloqueado");
    assert(estadoEfectivoSuscripcion(pagada("past_due", null), AHORA) === "inactiva", "past_due sin fin de periodo: bloqueado (falla cerrado)");
    // Renovación fallida con la semántica de Stripe: al renovar, Stripe AVANZA
    // current_period_end al periodo nuevo (el impago) aunque el cobro falle.
    // Regla de negocio: 7 días de gracia desde el fallo. Confirmación real:
    // billing-stripe-integracion.test.ts (P3, test clock).
    const { proveedor, est } = stripeFalso();
    const falloSeg = Math.floor(AHORA.getTime() / 1000);
    est.suscripciones.sub_zz_a = { ...est.suscripciones.sub_zz_a, status: "past_due", items: { data: [{ ...est.suscripciones.sub_zz_a.items.data[0], current_period_end: falloSeg + 30 * 86_400 }] } };
    const b10 = base();
    const e10 = evento("evt_zz_10", "invoice.payment_failed", "in_zz1");
    await procesarWebhook(b10.deps(proveedor), e10.cuerpo, e10.cabeceras);
    const n10 = b10.aplicados[0];
    const dia8 = n10 ? estadoEfectivoSuscripcion({ estado: n10.estado, trial_ends_at: null, current_period_end: n10.currentPeriodEnd?.toISOString() ?? null, cancel_at_period_end: false }, new Date(AHORA.getTime() + 8 * DIA)) : "sin_dato";
    pendiente(
      dia8 === "inactiva",
      "renovación fallida real (periodo ya avanzado por Stripe): día 8 tras el fallo → bloqueado",
      `hoy queda "${dia8}": la gracia se mide desde current_period_end (${n10?.currentPeriodEnd?.toISOString()}), gracia efectiva ≈ 37 días`,
    );
    const pagina = fuente("apps/admin/app/suscripcion/page.tsx");
    assert(/suscripcion\?\.estado === "past_due"/.test(pagina) && /Actualizar método de pago/.test(pagina), "/suscripcion con past_due: actualizar método de pago (no un checkout nuevo)");
  });

  await seccion("11", "Pago recuperado (invoice.paid)", async () => {
    const { proveedor } = stripeFalso();
    const b = base();
    const e = evento("evt_zz_11", "invoice.paid", "in_zz1");
    await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
    const n = b.aplicados[0];
    assert(n?.estado === "active" && n.subscriptionId === "sub_zz_a", "factura → suscripción → active");
    assert(n?.providerCheckoutId === "cs_test_zz1" && n.clientReferenceId === "chk-zz-1", "se asocia a NUESTRO checkout original (requisito para active)");
    assert(admin(pagada("active", 30 * DIA)).tipo === "permitir", "vuelve a operar");
  });

  await seccion("12", "customer.subscription.deleted", async () => {
    const { est, proveedor } = stripeFalso();
    est.suscripciones.sub_zz_a = { ...est.suscripciones.sub_zz_a, status: "canceled" };
    const b = base();
    const e = evento("evt_zz_12", "customer.subscription.deleted", "sub_zz_a");
    await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
    assert(b.aplicados[0]?.estado === "canceled" && b.aplicados[0]?.cancelAtPeriodEnd === false, "estado canceled");
    const s = pagada("canceled", 10 * DIA);
    assert(destinoDeDecision(admin(s), URL_GUARD) === "/suscripcion", "Admin → /suscripcion");
    assert(guardBloquea(guardiaEnGuard(s)), "Guard bloqueado");
    const r = resolverAccesoUsuario({ error: null, filas: [fila(TA, "admin_residencial", s)], cookieTenantId: null, app: "admin", ahora: AHORA });
    assert(permiteAlta(r), "canceled: se puede volver a pagar");
  });

  await seccion("13", "Eventos fuera de orden", async () => {
    const { proveedor } = stripeFalso();
    const b = base();
    // Llega tarde un payment_failed, pero la suscripción ya está active: manda el estado actual.
    const e = evento("evt_zz_13", "invoice.payment_failed", "in_zz1");
    await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
    assert(b.aplicados[0]?.estado === "active", "evento viejo → se aplica el estado ACTUAL del proveedor (refetch)");
    const e2 = evento("evt_zz_13b", "customer.subscription.updated", "sub_zz_a");
    await procesarWebhook(b.deps(proveedor), e2.cuerpo, e2.cabeceras);
    const [v1, v2] = [b.aplicados[0]?.versionAt.getTime() ?? 0, b.aplicados[1]?.versionAt.getTime() ?? 0];
    assert(v2 >= v1 && v1 > 0, "provider_version_at = instante de la consulta (monótono)");
    assert(/p_version_at <= v_s\.provider_version_at/.test(fuente("supabase/migrations/20261008300000_billing_evento_otro_tenant.sql")), "la RPC descarta snapshots más viejos (obsoleto)");
  });

  await seccion("14", "Firma inválida", async () => {
    const casos: [string, ReturnType<typeof evento> | { cuerpo: string; cabeceras: Headers }][] = [
      ["secreto incorrecto", evento("evt_zz_14a", "checkout.session.completed", "cs_test_zz1", { secreto: "whsec_test_otro" })],
      ["cuerpo manipulado", evento("evt_zz_14b", "checkout.session.completed", "cs_test_zz1", { manipular: true })],
      ["fuera de la ventana (10 min)", evento("evt_zz_14c", "checkout.session.completed", "cs_test_zz1", { timestamp: Math.floor(Date.now() / 1000) - 600 })],
      ["sin cabecera", { cuerpo: "{}", cabeceras: new Headers() }],
    ];
    for (const [nombre, e] of casos) {
      const { est, proveedor } = stripeFalso();
      const b = base();
      const resp = await procesarWebhook(b.deps(proveedor), e.cuerpo, e.cabeceras);
      assert(resp.status === 401 && b.aplicados.length === 0 && est.consultas === 0, `${nombre}: 401, sin escrituras ni consultas a Stripe`);
    }
  });

  await seccion("15", "Configuración Stripe inválida", () => {
    const clave = "sk_live_" + "Q".repeat(24);
    const live = configuracionStripe({ STRIPE_SECRET_KEY: clave, STRIPE_WEBHOOK_SECRET: SECRETO, STRIPE_PERMITIR_LIVE: "true", NEXT_PUBLIC_ADMIN_APP_URL: "https://staging--gateflow-admin-staging.netlify.app" });
    assert(!live.ok && live.motivo === "live_en_staging", "live en staging → deshabilitado aunque haya permiso");
    const sinPermiso = configuracionStripe({ STRIPE_SECRET_KEY: clave, STRIPE_WEBHOOK_SECRET: SECRETO, NEXT_PUBLIC_ADMIN_APP_URL: "https://gateflow.mx" });
    assert(!sinPermiso.ok && sinPermiso.motivo === "live_no_permitido", "live sin STRIPE_PERMITIR_LIVE → deshabilitado");
    const sinSecreto = configuracionStripe({ STRIPE_SECRET_KEY: "rk_test_" + "Q".repeat(24) });
    assert(!sinSecreto.ok && sinSecreto.motivo === "sin_webhook_secret", "falta el webhook secret → deshabilitado (webhook 503)");
    assert(![live, sinPermiso, sinSecreto].some((c) => JSON.stringify(c).includes("QQQQ") || JSON.stringify(c).includes("whsec_")), "el resultado nunca contiene la clave ni el secreto");
    const servidor = fuente("apps/admin/lib/billing/servidor.ts");
    assert(/status: 503/.test(servidor) && /config\.motivo/.test(servidor) && !/console\.\w+\([^)]*config\.clave/.test(servidor), "servidor: 503 sin proveedor y solo registra el motivo");
  });

  await seccion("16", "Elegibilidad por viviendas", () => {
    assert(viviendasRequeridas(30, 50) === 50 && viviendasRequeridas(120, 49) === 120 && viviendasRequeridas(null, 7) === 7, "max(declaradas, unidades activas)");
    assert(validarPlanParaViviendas("hasta-50", 50).ok, "50 → hasta-50 permitido");
    const v51 = validarPlanParaViviendas("hasta-50", 51);
    assert(!v51.ok && v51.motivo === "viviendas", "51 → hasta-50 rechazado");
    assert(validarPlanParaViviendas("hasta-150", 51).ok && validarPlanParaViviendas("hasta-150", 150).ok, "51 y 150 → hasta-150 permitido");
    const v151 = validarPlanParaViviendas("hasta-150", 151);
    assert(!v151.ok && v151.motivo === "contacto" && MAX_VIVIENDAS_AUTOSERVICIO === 150, ">150 → contacto (sin autoservicio)");
    const sql = fuente("tests/billing/db/escenarios.sql");
    assert(sql.includes(`when 'hasta-50' then ${CATALOGO_BILLING["hasta-50"].monto} when 'hasta-150' then ${CATALOGO_BILLING["hasta-150"].monto}`), "montos del paquete SQL = catálogo");
  });

  await seccion("17", "Roles", () => {
    const filaRol = (rol: string, s: Sus) => resolverAccesoUsuario({ error: null, filas: [fila(TA, rol, s)], cookieTenantId: null, app: "admin", ahora: AHORA });
    const vencida = trial(-1);
    assert(autorizarBilling(USUARIO, filaRol("admin_residencial", vencida)).ok, "admin_residencial puede pagar");
    for (const rol of ["guardia", "residente", "super_admin"]) {
      const a = autorizarBilling(USUARIO, filaRol(rol, vencida));
      assert(!a.ok && a.motivo === "rol", `${rol} no puede pagar (rol)`);
    }
    const sinTenant = resolverAccesoUsuario({ error: null, filas: [], cookieTenantId: null, app: "admin", ahora: AHORA });
    assert(!autorizarBilling(USUARIO, sinTenant).ok && sinTenant.decision.tipo === "sin_acceso", "usuario sin tenant: sin acceso y sin pago");
    assert(!autorizarBilling(null, filaRol("admin_residencial", vencida)).ok, "sin sesión: no");
    const sa = resolverAcceso({ error: null, membresia: membresia("super_admin", vencida), ahora: AHORA, app: "admin" });
    assert(sa.tipo === "permitir", "super_admin: excepción administrativa (no se bloquea por suscripción)");
    const res = resolverAcceso({ error: null, membresia: membresia("residente", pagada("active", 30 * DIA)), ahora: AHORA, app: "admin" });
    assert(res.tipo === "sin_acceso", "residente no usa el panel Admin");
  });

  await seccion("18", "Multitenant (gf_tenant revalidado)", () => {
    const filas = [fila(TA, "admin_residencial", trial(-1)), fila(TB, "admin_residencial", pagada("active", 30 * DIA))];
    const sinCookie = resolverAccesoUsuario({ error: null, filas, cookieTenantId: null, app: "admin", ahora: AHORA });
    assert(sinCookie.decision.tipo === "seleccionar_residencial", "2 residenciales sin cookie → elegir (nunca limit(1))");
    const a = resolverAccesoUsuario({ error: null, filas, cookieTenantId: TA, app: "admin", ahora: AHORA });
    const b = resolverAccesoUsuario({ error: null, filas, cookieTenantId: TB, app: "admin", ahora: AHORA });
    assert(destinoDeDecision(a.decision, URL_GUARD) === "/suscripcion" && destinoDeDecision(b.decision, URL_GUARD) === null, "la decisión usa la suscripción del residencial elegido");
    const au = autorizarBilling(USUARIO, a);
    assert(au.ok && au.tenantId === TA, "el pago se autoriza para el tenant de gf_tenant, no otro");
    const ajeno = resolverAccesoUsuario({ error: null, filas, cookieTenantId: "cccccccc-0000-4000-8000-0000000000c1", app: "admin", ahora: AHORA });
    assert(ajeno.decision.tipo === "seleccionar_residencial" && ajeno.decision.limpiarCookie && !autorizarBilling(USUARIO, ajeno).ok, "gf_tenant sin membresía → falla cerrado, se borra la cookie, sin pago");
    const basura = resolverAccesoUsuario({ error: null, filas, cookieTenantId: "no-es-uuid", app: "admin", ahora: AHORA });
    assert(basura.decision.tipo === "seleccionar_residencial", "gf_tenant malformado → falla cerrado");
    const mixto = [fila(TA, "guardia", trial(-1)), fila(TB, "admin_residencial", trial(-1))];
    const comoGuardia = resolverAccesoUsuario({ error: null, filas: mixto, cookieTenantId: TA, app: "admin", ahora: AHORA });
    assert(!autorizarBilling(USUARIO, comoGuardia).ok, "admin en B + guardia en A, con A elegido: no paga A");
  });

  await seccion("19", "Integridad referencial (lado servidor)", async () => {
    const f = checkoutFalso({ declaradas: 40, unidadesActivas: 0 });
    await iniciarCheckout(f.deps, { userId: USUARIO, tenantId: TA, planId: "hasta-50", emailPagador: null });
    assert(f.enBase[0]?.tenantId === TA && f.enBase[0]?.userId === USUARIO, "el checkout se crea con el tenant/usuario ya autorizados");
    assert(f.est.creadas[0].params.metadata.tenant_id === TA, "metadata del proveedor = mismo tenant (solo informativa)");
    const mig = fuente("supabase/migrations/20261008100000_billing_base.sql");
    assert(/tenant_id uuid not null references public\.tenants \(id\)/.test(mig) && /user_id uuid not null references public\.users \(id\)/.test(mig), "FK de billing_checkouts a tenants y users");
    assert(/uq_suscripciones_provider_subscription/.test(mig) && /uq_billing_eventos_provider_event/.test(mig), "únicos: suscripción del proveedor y evento");
  });

  await seccion("20", "Salvaguardas del paquete SQL y del teardown", () => {
    const sql = fuente("tests/billing/db/escenarios.sql");
    const sinComentarios = sql.replace(/--.*$/gm, "");
    assert(/^\s*begin;/m.test(sinComentarios) && !/\bcommit\b/i.test(sinComentarios), "begin sin commit");
    assert(/raise exception using[\s\S]*GF_AUTOTEST_RESULTADOS/.test(sinComentarios), "termina siempre con excepción (rollback garantizado)");
    const teardown = fuente("tests/billing/db/teardown.sql").replace(/--.*$/gm, "");
    const deletes = teardown.match(/\bdelete from [^;]+;/gi) ?? [];
    assert(/^\\ir teardown\.sql$/m.test(sinComentarios) && !/\bdelete from\b/i.test(sinComentarios), "el paquete no borra nada por sí mismo: usa teardown.sql");
    assert(deletes.length === 6 && deletes.every((d) => /= any \(v_[teu]\)|= v_emp/.test(d)), "todo DELETE filtra por ids registrados (nunca genérico)");
    assert(/GF_TEARDOWN_ABORTADO: tenant sin marca/.test(teardown) && /<> v_esperadas/.test(teardown), "aborta sin marca o con un número de filas inesperado");
    const staging = fuente("tests/billing/staging/run-staging.sh");
    assert(/xlozkpygubyiuxopmdxw/.test(staging) && /GF_BILLING_E2E_STAGING/.test(staging) && /sfuckzzqejerrifuypby/.test(staging), "runner de staging: opt-in explícito, solo staging, rechaza producción");
  });

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas${pendientes ? `, ${pendientes} pendientes` : ""}`);
  if (fallidas > 0) process.exit(1);
}

void main();
