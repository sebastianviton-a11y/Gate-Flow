/**
 * Batería billing — capa S: integración con Stripe TEST real (API + test
 * clocks + webhooks reales hacia staging). OPT-IN y manual.
 *
 *   GF_BILLING_STRIPE_TEST=1  STRIPE_TEST_SECRET_KEY=(rk_test_… o sk_test_…)
 *   GF_STAGING_DB_URL=…sfuckzzqejerrifuypby…   (limpieza de los eventos que Stripe entrega a staging)
 *   npx tsx apps/admin/lib/__tests__/billing-stripe-integracion.test.ts
 *
 * Validación de solicitudes sin cuenta (stripe-mock, sin estado):
 *   GF_BILLING_STRIPE_TEST=1 GF_BILLING_STRIPE_MOCK=1 GF_STRIPE_API_BASE=http://localhost:12111 STRIPE_TEST_SECRET_KEY=sk_test_…
 *
 * Qué prueba con objetos REALES de Stripe TEST, pasándolos por NUESTRO
 * normalizador (StripeBillingProvider) y NUESTRA regla de acceso
 * (estadoEfectivoSuscripcion), con el tiempo del test clock:
 *   P1  configuración (solo lectura): endpoint del webhook de staging y sus
 *       eventos; Customer Portal (cancelar al final del periodo, sin cambio
 *       de plan)
 *   P2  rechazo del PAGO INICIAL: la suscripción nace incomplete →
 *       incomplete_expired; nunca activa ni past_due
 *   P3  fallo de una FACTURA DE RENOVACIÓN: active → past_due; verifica la
 *       HIPÓTESIS H1 (factura subscription_cycle creada en current_period_start,
 *       su línea cubre ese periodo, primer cobro fallido posterior ≤ 2 h);
 *       impagoDesde = current_period_start y 7 días de gracia desde ahí
 *       aunque current_period_end ya sea futuro; un reintento no lo mueve;
 *       recuperación (invoice.paid) lo cierra; un segundo impago y el webhook
 *       del episodio anterior recibido después (lleva el inicio nuevo); estado
 *       final (unpaid/canceled/past_due) sin abrir gracia y su recuperación;
 *       reintentos hasta el estado final que dicte la configuración de la
 *       cuenta (Smart Retries / "si fallan todos los reintentos")
 *   P4  cancelación al final del periodo → canceled
 *   P5  los eventos de P2–P4 llegaron al webhook de staging y fueron
 *       aceptados (pending_webhooks = 0), quedaron registrados sin tocar
 *       ningún tenant, y se borran por id
 * Limpieza: se borran los test clocks (borran clientes y suscripciones);
 * producto y precio fixture se reutilizan (no crecen).
 * Nunca imprime la clave. Nunca usa producción. Correos: example.com
 * (Stripe TEST no envía correos a clientes).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";
import { DIAS_GRACIA_PAGO, estadoEfectivoSuscripcion, suscripcionOperativa } from "@gateflow/auth/client";
import { CATALOGO_BILLING } from "../billing/catalogo";
import { EVENTOS_STRIPE, StripeBillingProvider, type ClienteStripe } from "../billing/proveedores/stripe";
import type { EventoNormalizado } from "../billing/tipos";

/* eslint-disable @typescript-eslint/no-explicit-any */
let pasadas = 0;
let fallidas = 0;
let omitidas = 0;
let escenario = "00";
function res(estado: "PASS" | "FAIL" | "SKIP", mensaje: string) {
  if (estado === "PASS") pasadas++;
  else if (estado === "FAIL") fallidas++;
  else omitidas++;
  console.log(`RESULT|S|${escenario}|${estado}|${mensaje.replace(/[|\n]/g, " ")}`);
}
const assert = (cond: boolean, mensaje: string, detalle = "") => res(cond ? "PASS" : "FAIL", cond || !detalle ? mensaje : `${mensaje} — ${detalle}`);
/** Afirmación sobre el ESTADO de Stripe: con stripe-mock (sin estado) solo se cuenta la solicitud. */
let MODO_MOCK = false;
const estadoOk = (cond: boolean, mensaje: string, detalle = "") => (MODO_MOCK ? undefined : assert(cond, mensaje, detalle));
const info = (mensaje: string) => console.log(`INFO|S|${escenario}|${mensaje.replace(/[|\n]/g, " ")}`);

const REF_PRODUCCION = "xlozkpygubyiuxopmdxw";
const REF_STAGING = "sfuckzzqejerrifuypby";
const DIA = 86_400;
const RAIZ = join(__dirname, "../../../..");

async function main() {
  if (process.env.GF_BILLING_STRIPE_TEST !== "1") {
    console.log("RESULT|S|--|SKIP|Stripe TEST real: opt-in (GF_BILLING_STRIPE_TEST=1 + STRIPE_TEST_SECRET_KEY)");
    console.log("\n0 pasadas, 0 fallidas");
    return;
  }
  // ── Salvaguardas ──
  const clave = (process.env.STRIPE_TEST_SECRET_KEY ?? "").trim();
  const MOCK = process.env.GF_BILLING_STRIPE_MOCK === "1";
  MODO_MOCK = MOCK;
  const fin = (m: string) => {
    console.log(`RESULT|S|--|FAIL|${m}`);
    process.exit(2);
  };
  if (!/^(sk|rk)_test_/.test(clave)) fin("STRIPE_TEST_SECRET_KEY ausente o no es de modo TEST (sk_test_/rk_test_)");
  for (const v of Object.values(process.env)) if (typeof v === "string" && (v.includes(REF_PRODUCCION) || /(^|[/.])gateflow\.mx/.test(v))) fin("rechazado: el entorno contiene una referencia a PRODUCCIÓN");
  // Con stripe-mock no hay cuenta ni red: se permite en CI (valida las solicitudes en cada PR).
  if (!MOCK && process.env.CI === "true" && !(process.env.GITHUB_EVENT_NAME === "workflow_dispatch" && process.env.GF_BILLING_CONFIRMACION === "stripe-test")) {
    fin("rechazado: en CI solo corre desde el workflow manual con confirmación explícita");
  }
  const DB = process.env.GF_STAGING_DB_URL ?? "";
  if (!MOCK && !DB.includes(REF_STAGING)) fin("falta GF_STAGING_DB_URL de staging: Stripe entrega los eventos de la prueba al webhook de staging y hay que limpiarlos por id");
  const base = process.env.GF_STRIPE_API_BASE ? new URL(process.env.GF_STRIPE_API_BASE) : null;
  if (base && !MOCK) fin("GF_STRIPE_API_BASE solo se admite con GF_BILLING_STRIPE_MOCK=1");
  const version = /STRIPE_API_VERSION = "([^"]+)"/.exec(readFileSync(join(RAIZ, "apps/admin/lib/billing/servidor.ts"), "utf8"))?.[1];
  const stripe: any = new Stripe(clave, {
    apiVersion: version as any,
    maxNetworkRetries: 2,
    timeout: 30_000,
    ...(base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") as "http" | "https" } : {}),
  });
  let solicitudes = 0;
  const rechazadas: string[] = [];
  stripe.on("response", (r: any) => {
    solicitudes++;
    if (r.status >= 400) rechazadas.push(`${r.method} ${r.path} → ${r.status}`);
  });
  const proveedor = new StripeBillingProvider(stripe as unknown as ClienteStripe, "whsec_no_usado", null);
  const run = `ZZ_AUTOTEST_${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}_${Math.random().toString(16).slice(2, 8)}`;
  const relojes: string[] = [];
  const clientes: string[] = [];
  const t0 = Math.floor(Date.now() / 1000) - 5;
  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const llamar = async <T>(nombre: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e: any) {
      res("FAIL", `${nombre}: ${e?.type ?? "error"} ${e?.code ?? ""} ${String(e?.message ?? e).slice(0, 200)}`);
      return null;
    }
  };
  /** Estado tras la normalización de NUESTRO adaptador (refetch real a Stripe). */
  const normalizar = (tipo: string, objetoId: string) => llamar(`normalizar ${tipo}`, () => proveedor.normalizarEvento({ id: `evt_local_${run}`, tipo, objetoId }));
  const acceso = (n: EventoNormalizado | null, en: number) =>
    n ? estadoEfectivoSuscripcion({ estado: n.estado === "active" || n.estado === "past_due" || n.estado === "canceled" ? n.estado : "ignorar", trial_ends_at: null, current_period_end: n.currentPeriodEnd?.toISOString() ?? null, cancel_at_period_end: n.cancelAtPeriodEnd, impago_desde: n.impagoDesde?.toISOString() ?? null }, new Date(en * 1000)) : "sin_dato";

  const esperarReloj = async (id: string) => {
    for (let i = 0; i < 90; i++) {
      const r = await stripe.testHelpers.testClocks.retrieve(id);
      if (MOCK || r.status === "ready") return r;
      if (r.status === "internal_failure") throw new Error("test clock internal_failure");
      await dormir(2000);
    }
    throw new Error("test clock sin terminar de avanzar en 180 s");
  };
  const avanzar = async (id: string, hasta: number) => {
    await stripe.testHelpers.testClocks.advance(id, { frozen_time: hasta });
    return esperarReloj(id);
  };
  const nuevoCliente = async (sufijo: string, ahora: number, pm: string) => {
    const reloj = await stripe.testHelpers.testClocks.create({ frozen_time: ahora, name: `${run}_${sufijo}` });
    relojes.push(reloj.id);
    const cliente = await stripe.customers.create({ email: `zz-autotest+${run.toLowerCase()}-${sufijo}@example.com`, name: `${run} ${sufijo}`, test_clock: reloj.id, metadata: { gf_autotest: run } });
    clientes.push(cliente.id);
    await usarTarjeta(cliente.id, pm);
    return { reloj, cliente };
  };
  const usarTarjeta = async (cliente: string, pm: string) => {
    const metodo = await stripe.paymentMethods.attach(pm, { customer: cliente });
    await stripe.customers.update(cliente, { invoice_settings: { default_payment_method: metodo.id } });
  };
  const precioFixture = async () => {
    const plan = CATALOGO_BILLING["hasta-50"];
    const lookup = `gf_autotest_${plan.id}_${plan.monto}_${plan.moneda.toLowerCase()}_mes`;
    const existentes = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
    if (!MOCK && existentes.data[0]) return existentes.data[0].id as string;
    const producto = await stripe.products.create({ name: "ZZ_AUTOTEST · Gate Flow (fixture de pruebas)", metadata: { gf_autotest_fixture: "gateflow-billing" } });
    const precio = await stripe.prices.create({ product: producto.id, currency: plan.moneda.toLowerCase(), unit_amount: plan.monto, recurring: { interval: "month", interval_count: 1 }, lookup_key: lookup, metadata: { gf_autotest_fixture: "gateflow-billing" } });
    return precio.id as string;
  };
  const finItem = (s: any): number | null => s?.items?.data?.[0]?.current_period_end ?? null;
  // HIPÓTESIS H1 (tests/billing/STRIPE.md): en los flujos soportados la
  // factura impaga se crea en el current_period_start del ítem y su primer
  // intento de cobro es posterior. Mide factura, línea, primer cobro fallido
  // y periodo para que P3/P6 la confirmen o la refuten con Stripe real.
  const relacionImpago = async (sub: any, facturaId: string) => {
    const inv: any = await stripe.invoices.retrieve(facturaId);
    const cps: number | null = sub?.items?.data?.[0]?.current_period_start ?? null;
    const linea = (inv?.lines?.data ?? []).find((l: any) => l?.period?.start != null);
    const cliente = typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id;
    const fallidos: number[] = [];
    for await (const c of stripe.charges.list({ customer: cliente, limit: 100 })) {
      if ((c as any).status === "failed" && cps !== null && (c as any).created >= cps) fallidos.push((c as any).created);
    }
    return {
      cps,
      creada: (inv?.created ?? null) as number | null,
      motivo: (inv?.billing_reason ?? null) as string | null,
      inicioLinea: (linea?.period?.start ?? null) as number | null,
      primerFallo: fallidos.length ? Math.min(...fallidos) : null,
    };
  };
  const describir = (r: Awaited<ReturnType<typeof relacionImpago>>) =>
    `motivo=${r.motivo} creada−cps=${r.creada !== null && r.cps !== null ? r.creada - r.cps : "?"}s línea−cps=${r.inicioLinea !== null && r.cps !== null ? r.inicioLinea - r.cps : "?"}s primerFallo−cps=${r.primerFallo !== null && r.cps !== null ? r.primerFallo - r.cps : "?"}s`;

  try {
    // ── P0. Modo TEST ──
    escenario = "15";
    const reloj0 = await llamar("crear test clock (verificación de modo)", () => stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `${run}_modo` }));
    if (!reloj0) return;
    relojes.push((reloj0 as any).id);
    if ((reloj0 as any).livemode !== false) fin("la cuenta respondió livemode≠false: se aborta");
    assert(true, "la clave opera en modo TEST (livemode=false)");

    // ── P1. Configuración (solo lectura) ──
    const urlWebhook = `${(process.env.GF_STAGING_ADMIN_URL ?? "https://staging--gateflow-admin-staging.netlify.app").replace(/\/+$/, "")}/api/billing/webhook/stripe`;
    const endpoints: any = await llamar("listar webhook endpoints", () => stripe.webhookEndpoints.list({ limit: 100 }));
    if (endpoints && !MOCK) {
      const ep = endpoints.data.find((e: any) => e.url === urlWebhook);
      assert(Boolean(ep), "existe el endpoint del webhook de staging en Stripe TEST", "no hay endpoint con la URL de staging");
      if (ep) {
        assert(ep.status === "enabled", "endpoint habilitado", ep.status);
        const faltan = ep.enabled_events.includes("*") ? [] : EVENTOS_STRIPE.filter((t) => !ep.enabled_events.includes(t));
        assert(faltan.length === 0, `endpoint suscrito a los ${EVENTOS_STRIPE.length} eventos que procesa el webhook`, `faltan: ${faltan.join(", ")}`);
      }
    } else if (endpoints) assert(true, "solicitud aceptada: webhookEndpoints.list");
    const idPortal = process.env.GF_STRIPE_PORTAL_CONFIGURATION_ID;
    const portal: any = await llamar("leer configuración del Customer Portal", async () =>
      idPortal ? stripe.billingPortal.configurations.retrieve(idPortal) : (await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })).data[0],
    );
    if (portal && !MOCK) {
      const f = portal.features ?? {};
      assert(f.subscription_cancel?.enabled === true && f.subscription_cancel?.mode === "at_period_end", "portal: cancelar al final del periodo", JSON.stringify(f.subscription_cancel ?? null));
      assert(f.subscription_update?.enabled !== true, "portal: sin cambio de plan", "subscription_update habilitado");
      assert(f.payment_method_update?.enabled === true, "portal: permite actualizar el método de pago");
    } else if (portal) assert(true, "solicitud aceptada: billingPortal.configurations");

    const precio = await llamar("precio fixture (reutilizable)", precioFixture);
    if (!precio) return;
    const crearSuscripcion = (cliente: string) =>
      stripe.subscriptions.create({ customer: cliente, items: [{ price: precio, quantity: 1 }], payment_behavior: "allow_incomplete", metadata: { gf_autotest: run }, expand: ["latest_invoice"] });

    // ── P2. Rechazo del PAGO INICIAL ──
    escenario = "03";
    const ahora = Math.floor(Date.now() / 1000);
    const a = await llamar("P2 cliente con tarjeta que falla al cobrar", () => nuevoCliente("inicial", ahora, "pm_card_chargeCustomerFail"));
    if (a) {
      const s: any = await llamar("P2 crear suscripción (primer cobro rechazado)", () => crearSuscripcion(a.cliente.id));
      if (s) await llamar("P2 flujo", async () => {
        estadoOk(s.status === "incomplete", "rechazo inicial: la suscripción nace incomplete (nunca active ni past_due)", s.status);
        const n = await normalizar("customer.subscription.created", s.id);
        estadoOk(n?.estado === "ignorar", "nuestro normalizador la ignora (no activa el residencial)", String(n?.estado));
        await avanzar(a.reloj.id, ahora + DIA + 3600);
        const s2 = await stripe.subscriptions.retrieve(s.id);
        estadoOk(s2.status === "incomplete_expired", "tras 23 h: incomplete_expired", s2.status);
        const n2 = await normalizar("customer.subscription.updated", s.id);
        estadoOk(n2?.estado === "ignorar", "incomplete_expired también se ignora (sigue bloqueado por trial vencido)", String(n2?.estado));
      });
    }

    // ── P3. Fallo de una FACTURA DE RENOVACIÓN ──
    escenario = "09";
    const b = await llamar("P3 cliente con tarjeta válida", () => nuevoCliente("renovacion", ahora, "pm_card_visa"));
    if (b) {
      const s: any = await llamar("P3 crear suscripción (primer cobro OK)", () => crearSuscripcion(b.cliente.id));
      if (s) await llamar("P3 flujo", async () => {
        const finPeriodo1 = finItem(s) ?? 0;
        estadoOk(s.status === "active", "primer cobro OK: active", s.status);
        await usarTarjeta(b.cliente.id, "pm_card_chargeCustomerFail");
        const reloj = await avanzar(b.reloj.id, finPeriodo1 + 2 * 3600);
        const fallo = reloj.frozen_time as number;
        const s2: any = await stripe.subscriptions.retrieve(s.id, { expand: ["latest_invoice"] });
        const factura = typeof s2.latest_invoice === "string" ? { id: s2.latest_invoice } : s2.latest_invoice;
        estadoOk(s2.status === "past_due", "renovación con la tarjeta rechazada: past_due", s2.status);
        estadoOk(factura?.status === "open" && (factura?.attempt_count ?? 0) >= 1, "factura de renovación abierta con ≥1 intento", `${factura?.status}/${factura?.attempt_count}`);
        const finPeriodo2 = finItem(s2) ?? 0;
        info(`current_period_end antes ${new Date(finPeriodo1 * 1000).toISOString()} → tras la renovación fallida ${new Date(finPeriodo2 * 1000).toISOString()}`);
        // H1 con objetos reales: factura de renovación creada en el inicio del
        // periodo impago, su línea cubre ese periodo y el primer cobro fallido
        // es posterior (≤ 2 h) y no posterior al instante observado.
        const h1 = await llamar("P3 relación factura / primer fallo / periodo", () => relacionImpago(s2, factura.id));
        if (h1) {
          info(`H1 renovación: ${describir(h1)}`);
          estadoOk(
            h1.motivo === "subscription_cycle" && h1.cps !== null && h1.creada !== null && Math.abs(h1.creada - h1.cps) <= 120 && h1.inicioLinea === h1.cps
              && h1.primerFallo !== null && h1.primerFallo >= h1.cps && h1.primerFallo <= fallo && h1.primerFallo - h1.cps <= 2 * 3600,
            "H1: factura subscription_cycle creada en current_period_start, línea del periodo impago y primer fallo posterior (≤ 2 h)",
            describir(h1),
          );
        }
        const n = await normalizar("invoice.payment_failed", factura.id);
        estadoOk(n?.estado === "past_due", "nuestro normalizador: past_due", String(n?.estado));
        estadoOk(suscripcionOperativa(acceso(n, fallo + 3 * DIA) as any), "día 3 tras el fallo: operativo (gracia)", String(acceso(n, fallo + 3 * DIA)));
        // Regla de negocio: 7 días de gracia desde el inicio del impago
        // (inicio del periodo impago), aunque Stripe ya adelantó el fin.
        escenario = "10";
        const inicio = n?.impagoDesde ? n.impagoDesde.getTime() / 1000 : null;
        const inicioItem = s2?.items?.data?.[0]?.current_period_start ?? null;
        info(`inicio del impago normalizado ${n?.impagoDesde?.toISOString() ?? "null"}; fallo del cobro ${new Date(fallo * 1000).toISOString()}`);
        estadoOk(
          inicio !== null && inicio === inicioItem && inicio <= fallo && (finPeriodo2 ?? 0) > fallo + DIAS_GRACIA_PAGO * DIA,
          "impagoDesde = current_period_start del periodo impago (≤ fallo) y current_period_end ya es futuro",
          `inicio=${inicio} item=${inicioItem} fallo=${fallo} fin=${finPeriodo2}`,
        );
        if (inicio !== null) {
          const antes = acceso(n, inicio + DIAS_GRACIA_PAGO * DIA - 60);
          const enLimite = acceso(n, inicio + DIAS_GRACIA_PAGO * DIA);
          estadoOk(antes === "gracia" && enLimite === "inactiva", `frontera exacta: gracia 1 min antes de ${DIAS_GRACIA_PAGO} días desde el impago, bloqueado en el límite`, `${antes}/${enLimite}`);
        }
        const dia8 = acceso(n, fallo + (DIAS_GRACIA_PAGO + 1) * DIA);
        estadoOk(dia8 === "inactiva", `día ${DIAS_GRACIA_PAGO + 1} tras el fallo de renovación: bloqueado`, `sigue "${dia8}" (impagoDesde ${n?.impagoDesde?.toISOString() ?? "null"}, fin de periodo ${n?.currentPeriodEnd?.toISOString()})`);
        // Un reintento (3 días después) no mueve el inicio del impago.
        await avanzar(b.reloj.id, fallo + 3 * DIA);
        const nr = await normalizar("customer.subscription.updated", s.id);
        estadoOk(nr?.estado === "past_due" && nr?.impagoDesde?.getTime() === n?.impagoDesde?.getTime(), "tras un reintento: sigue past_due con el MISMO inicio de impago", `${nr?.estado}/${nr?.impagoDesde?.toISOString()}`);
        // Recuperación.
        escenario = "11";
        await usarTarjeta(b.cliente.id, "pm_card_visa");
        const pagada: any = await llamar("pagar la factura abierta", () => stripe.invoices.pay(factura.id));
        const s3: any = await stripe.subscriptions.retrieve(s.id);
        estadoOk(pagada?.status === "paid" && s3.status === "active", "pago recuperado: factura paid, suscripción active", `${pagada?.status}/${s3.status}`);
        const n3 = await normalizar("invoice.paid", factura.id);
        estadoOk(n3?.estado === "active" && n3?.impagoDesde === null, "nuestro normalizador: active, sin inicio de impago (episodio cerrado)", `${n3?.estado}/${n3?.impagoDesde}`);
        // Reintentos hasta el estado final que dicte la configuración de la cuenta.
        escenario = "10";
        await usarTarjeta(b.cliente.id, "pm_card_chargeCustomerFail");
        const finPeriodo3 = finItem(s3) ?? 0;
        await avanzar(b.reloj.id, finPeriodo3 + 2 * 3600);
        const s4: any = await stripe.subscriptions.retrieve(s.id);
        let estado = s4.status as string;
        // Nuevo impago y, DESPUÉS, un webhook del episodio ANTERIOR (su factura
        // ya está pagada): se normaliza con el estado ACTUAL de la suscripción,
        // así que trae el inicio del episodio nuevo, nunca el viejo.
        const factura2 = typeof s4.latest_invoice === "string" ? s4.latest_invoice : s4.latest_invoice?.id;
        const h1b = factura2 ? await llamar("P3 relación del segundo impago", () => relacionImpago(s4, factura2)) : null;
        if (h1b) info(`H1 segundo impago: ${describir(h1b)}`);
        const viejo = await normalizar("invoice.payment_failed", factura.id);
        const inicio2 = s4?.items?.data?.[0]?.current_period_start ?? null;
        estadoOk(
          estado === "past_due" && inicio2 !== null && viejo?.impagoDesde?.getTime() === inicio2 * 1000 && viejo.impagoDesde.getTime() !== n?.impagoDesde?.getTime(),
          "webhook del episodio anterior tras el nuevo impago: lleva el inicio del episodio NUEVO (reconsulta), nunca el viejo",
          `${estado}/${viejo?.impagoDesde?.toISOString()} vs nuevo ${inicio2}`,
        );
        let t = finPeriodo3 + 2 * 3600;
        const traza = [`+0d:${estado}`];
        for (let d = 3; d <= 45 && estado === "past_due"; d += 3) {
          t = finPeriodo3 + d * DIA;
          await avanzar(b.reloj.id, t);
          estado = (await stripe.subscriptions.retrieve(s.id)).status;
          traza.push(`+${d}d:${estado}`);
        }
        info(`reintentos (configuración de la cuenta): ${traza.join(" ")}`);
        estadoOk(["canceled", "unpaid", "past_due"].includes(estado), `estado final tras agotar reintentos: ${estado}`);
        const nf = await normalizar("customer.subscription.updated", s.id);
        const af = acceso(nf, t);
        estadoOk(!suscripcionOperativa(af as any), `con el estado final (${estado} → ${nf?.estado}) el residencial queda bloqueado`, `nuestra regla lo deja "${af}"`);
        estadoOk(nf?.estadoProveedor === estado && (estado === "past_due" || nf?.impagoDesde === null),
          `estado final ${estado}: status real conservado y, si no es past_due, sin fecha propia (no abre ni extiende la gracia)`, `${nf?.estadoProveedor}/${nf?.impagoDesde?.toISOString() ?? "null"}`);
        // Recuperación desde el estado final (evidencia para el texto de la UI):
        // ¿basta con actualizar la tarjeta o hay que pagar las facturas abiertas?
        if (estado === "unpaid" || estado === "past_due") {
          escenario = "11";
          await usarTarjeta(b.cliente.id, "pm_card_visa");
          await avanzar(b.reloj.id, t + DIA);
          const tras = (await stripe.subscriptions.retrieve(s.id)).status as string;
          info(`recuperación desde ${estado}: solo con tarjeta nueva, +1 d → ${tras}`);
          let final = tras;
          if (tras !== "active") {
            const abiertas = await stripe.invoices.list({ subscription: s.id, status: "open", limit: 10 });
            for (const inv of abiertas.data) await llamar("pagar factura abierta", () => stripe.invoices.pay(inv.id as string));
            final = (await stripe.subscriptions.retrieve(s.id)).status as string;
            info(`recuperación desde ${estado}: pagando ${abiertas.data.length} factura(s) abierta(s) → ${final}`);
          }
          const nrec = await normalizar("customer.subscription.updated", s.id);
          estadoOk(final === "active" && nrec?.estado === "active" && nrec.impagoDesde === null,
            `recuperación desde ${estado}: active en Stripe y en nuestro normalizador, episodio cerrado`, `${final}/${nrec?.estado}`);
        }
      });
    }

    // ── P4. Cancelación al final del periodo ──
    escenario = "08";
    const c = await llamar("P4 cliente", () => nuevoCliente("cancelacion", ahora, "pm_card_visa"));
    if (c) {
      const s: any = await llamar("P4 crear suscripción", () => crearSuscripcion(c.cliente.id));
      const u: any = s ? await llamar("P4 cancelar al final del periodo", () => stripe.subscriptions.update(s.id, { cancel_at_period_end: true })) : null;
      if (s && u) await llamar("P4 flujo", async () => {
        const n = await normalizar("customer.subscription.updated", s.id);
        const finP = n?.currentPeriodEnd ? n.currentPeriodEnd.getTime() / 1000 : 0;
        estadoOk(n?.estado === "active" && n.cancelAtPeriodEnd === true, "normalizado: active + cancel_at_period_end", `${n?.estado}/${n?.cancelAtPeriodEnd}`);
        estadoOk(acceso(n, finP - 60) === "activa" && acceso(n, finP) === "inactiva", "operativo hasta el fin del periodo; bloqueado en el límite");
        escenario = "12";
        await avanzar(c.reloj.id, finP + 3600);
        const s2 = await stripe.subscriptions.retrieve(s.id);
        const n2 = await normalizar("customer.subscription.deleted", s.id);
        estadoOk(s2.status === "canceled" && n2?.estado === "canceled", "al terminar el periodo: canceled", `${s2.status}/${n2?.estado}`);
      });
    }

    // ── P6. Renovación fallida REAL de un residencial sintético activado por Checkout ──
    // Requiere GF_STRIPE_SUSCRIPCION_SINTETICA=sub_… de un residencial ZZ_AUTOTEST_
    // de staging que ya pagó en el Checkout hospedado (paso manual: la UI de
    // Stripe no se automatiza aquí). Fuerza la factura de renovación AHORA
    // (billing_cycle_anchor=now) con una tarjeta que falla y sigue la cadena
    // real: Stripe → webhook firmado → staging → past_due → recuperación.
    escenario = "10";
    const subSintetica = (process.env.GF_STRIPE_SUSCRIPCION_SINTETICA ?? (MOCK ? "sub_mockP6" : "")).trim();
    if (!subSintetica) {
      res("SKIP", "P6 renovación fallida real de un residencial activado por Checkout: falta GF_STRIPE_SUSCRIPCION_SINTETICA (requiere un pago manual previo en el Checkout hospedado)");
    } else if (!/^sub_[A-Za-z0-9]+$/.test(subSintetica)) {
      res("FAIL", "GF_STRIPE_SUSCRIPCION_SINTETICA no es un id de suscripción");
    } else {
      await llamar("P6 flujo", async () => {
        const q = (sql: string) => execFileSync("psql", [DB, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
        let tenant = "";
        let admin = "";
        if (!MOCK) {
          const filas = q(`select t.id || '|' || t.nombre || '|' || coalesce(t.observaciones, '') || '|' || s.estado from public.suscripciones s join public.tenants t on t.id = s.tenant_id where s.provider = 'stripe' and s.provider_subscription_id = '${subSintetica}'`).split("\n").filter(Boolean);
          const [id, nombre, obs, estado] = (filas[0] ?? "").split("|");
          if (filas.length !== 1 || !nombre?.startsWith("ZZ_AUTOTEST_") || !obs?.startsWith("gf-autotest:")) {
            res("FAIL", "P6 rechazado: la suscripción no pertenece a un residencial sintético ZZ_AUTOTEST_ de staging (no se toca)");
            return;
          }
          if (estado !== "active") {
            res("FAIL", `P6: el residencial sintético no está active (${estado})`);
            return;
          }
          tenant = id ?? "";
          admin = q(`select ut.user_id from public.user_tenants ut join public.roles r on r.id = ut.rol_id where ut.tenant_id = '${tenant}' and ut.activo and r.clave = 'admin_residencial' limit 1`);
        }
        const sub0: any = await stripe.subscriptions.retrieve(subSintetica);
        estadoOk(sub0.status === "active", "P6: suscripción del residencial sintético active", sub0.status);
        const cliente = typeof sub0.customer === "string" ? sub0.customer : sub0.customer?.id;
        await usarTarjeta(cliente, "pm_card_chargeCustomerFail");
        const forzada = Math.floor(Date.now() / 1000);
        await stripe.subscriptions.update(subSintetica, { billing_cycle_anchor: { type: "now" }, proration_behavior: "none", payment_behavior: "allow_incomplete" });
        const esperarEstado = async (esperado: string) => {
          for (let i = 0; !MOCK && i < 60; i++) {
            // Devuelve el inicio del impago guardado (epoch; 0 si es null).
            const [estado, impago] = q(`select estado || '|' || coalesce(extract(epoch from impago_desde)::bigint::text, '0') from public.suscripciones where provider_subscription_id = '${subSintetica}'`).split("|");
            if (estado === esperado) return Number(impago);
            await dormir(3000);
          }
          return null;
        };
        const impago = await esperarEstado("past_due");
        estadoOk(impago !== null, "P6: el webhook real llevó el residencial a past_due en staging", "no llegó a past_due en 180 s");
        if (impago !== null && !MOCK) {
          assert(impago > 0, "P6: staging guardó impago_desde (inicio del impago) desde el webhook real", "impago_desde null: sin gracia (falla cerrado)");
          // H1 en la cadena real: la fecha guardada es exactamente el
          // current_period_start de Stripe, la factura impaga se creó ahí (al
          // forzar la renovación) y el primer cobro fallido es posterior.
          const subP: any = await stripe.subscriptions.retrieve(subSintetica);
          const facturaP = typeof subP.latest_invoice === "string" ? subP.latest_invoice : subP.latest_invoice?.id;
          const h1 = facturaP ? await llamar("P6 relación factura / primer fallo / periodo", () => relacionImpago(subP, facturaP)) : null;
          if (h1) info(`H1 P6: ${describir(h1)} impago_desde−cps=${h1.cps !== null ? impago - h1.cps : "?"}s cps−forzada=${h1.cps !== null ? h1.cps - forzada : "?"}s`);
          assert(
            !!h1 && h1.cps === impago && h1.cps >= forzada - 5 && h1.cps <= forzada + 120 && h1.creada !== null && Math.abs(h1.creada - h1.cps) <= 120
              && h1.inicioLinea === h1.cps && h1.primerFallo !== null && h1.primerFallo >= h1.cps,
            "P6 H1: impago_desde guardado = current_period_start; factura creada al forzar la renovación; primer fallo posterior",
            h1 ? describir(h1) : "sin factura",
          );
          const graciaDias = (impago + DIAS_GRACIA_PAGO * DIA - forzada) / DIA;
          info(`impago_desde guardado ${new Date(impago * 1000).toISOString()} → gracia efectiva ${graciaDias.toFixed(2)} días desde el fallo forzado`);
          assert(impago > 0 && graciaDias <= DIAS_GRACIA_PAGO + 0.1 && graciaDias > DIAS_GRACIA_PAGO - 0.1, `P6: gracia efectiva = ${DIAS_GRACIA_PAGO} días desde el inicio del impago`, `${graciaDias.toFixed(2)} días`);
          if (admin) {
            // Transacción de solo evaluación: JWT simulado + rol authenticated, y rollback.
            const op = q(`begin; select set_config('request.jwt.claims', json_build_object('sub', '${admin}', 'role', 'authenticated')::text, true); set local role authenticated; select public.tenant_operativo('${tenant}'); rollback;`);
            assert(op.split("\n").includes("t"), "P6: en gracia el residencial sigue operativo (tenant_operativo real en staging)", op);
          }
        }
        // Recuperación con tarjeta válida.
        escenario = "11";
        await usarTarjeta(cliente, "pm_card_visa");
        const sub1: any = await stripe.subscriptions.retrieve(subSintetica, { expand: ["latest_invoice"] });
        const factura = typeof sub1.latest_invoice === "string" ? sub1.latest_invoice : sub1.latest_invoice?.id;
        await stripe.invoices.pay(factura);
        const impago2 = await esperarEstado("active");
        estadoOk(impago2 !== null, "P6: invoice.paid real → active en staging (pago recuperado)", "no volvió a active en 180 s");
        if (impago2 !== null && !MOCK) assert(impago2 === 0, "P6: el pago cerró el episodio (impago_desde null en staging)", String(impago2));
        if (!MOCK) {
          const eventos: string[] = [];
          for await (const e of stripe.events.list({ created: { gte: forzada - 5 }, types: EVENTOS_STRIPE, limit: 100 })) if (e.data?.object?.customer === cliente) eventos.push(e.id);
          info(`P6: eventos aplicados al residencial sintético (se borran con SU teardown, por id): ${eventos.join(",")}`);
        }
      });
    }

    // ── P5. Webhooks reales → staging ──
    escenario = "04";
    if (MOCK) {
      escenario = "00";
      assert(rechazadas.length === 0 && solicitudes > 20, `stripe-mock aceptó las ${solicitudes} solicitudes del flujo completo (P0–P4, P6)`, rechazadas.slice(0, 3).join("; "));
      escenario = "04";
      res("SKIP", "P5 (entrega real de webhooks a staging): no aplica con stripe-mock");
    } else {
      const propios = new Set(clientes);
      const eventos: any[] = [];
      for await (const e of stripe.events.list({ created: { gte: t0 }, types: EVENTOS_STRIPE, limit: 100 })) {
        const o = e.data?.object ?? {};
        if (propios.has(o.customer)) eventos.push(e);
      }
      assert(eventos.length > 0, `Stripe generó ${eventos.length} eventos procesables para los objetos de la prueba`);
      let pendientes = eventos.map((e) => e.id);
      for (let i = 0; i < 60 && pendientes.length; i++) {
        const quedan: string[] = [];
        for (const id of pendientes) if ((await stripe.events.retrieve(id)).pending_webhooks > 0) quedan.push(id);
        pendientes = quedan;
        if (pendientes.length) await dormir(5000);
      }
      escenario = "14";
      assert(pendientes.length === 0, "todos los eventos entregados y aceptados (2xx) por el webhook de staging (firma real)", `${pendientes.length} sin entregar/aceptar`);
      // Registro en staging y limpieza por id.
      escenario = "20";
      const ids = eventos.map((e) => e.id).filter((id) => /^evt_[A-Za-z0-9]+$/.test(id));
      const lista = ids.map((id) => `'${id}'`).join(",");
      const q = (sql: string) => execFileSync("psql", [DB, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
      if (ids.length) {
        const fila = q(`select count(*) || '/' || count(*) filter (where tenant_id is null and resultado in ('sin_asociacion','ignorado','rechazado')) from public.billing_eventos where provider = 'stripe' and provider_event_id in (${lista})`);
        const [registrados, inocuos] = fila.split("/");
        assert(registrados === String(ids.length), "staging registró cada evento una vez (idempotencia por id)", fila);
        assert(inocuos === registrados, "ningún evento de la prueba tocó un tenant (sin_asociacion/ignorado/rechazado)", fila);
        const borrados = q(`with b as (delete from public.billing_eventos where provider = 'stripe' and provider_event_id in (${lista}) and tenant_id is null and resultado in ('sin_asociacion','ignorado','rechazado') returning 1) select count(*) from b`);
        assert(borrados === registrados, "limpieza en staging por id de evento", `${borrados} de ${registrados}`);
        assert(q(`select count(*) from public.billing_eventos where provider_event_id in (${lista})`) === "0", "0 eventos de la prueba en staging");
      }
    }
  } finally {
    // ── Limpieza en Stripe TEST ──
    escenario = "20";
    let borrados = 0;
    for (const id of relojes) {
      try {
        await stripe.testHelpers.testClocks.del(id);
        borrados++;
      } catch (e: any) {
        res("FAIL", `no se pudo borrar el test clock ${id}: ${String(e?.message ?? e).slice(0, 120)}`);
      }
    }
    assert(borrados === relojes.length, `test clocks borrados (${borrados}/${relojes.length}): eliminan sus clientes y suscripciones`);
    let vivos = 0;
    if (!MOCK) {
      for (const id of clientes) if (!(await stripe.customers.retrieve(id).catch(() => ({ deleted: true }))).deleted) vivos++;
      assert(vivos === 0, "0 clientes de prueba en Stripe TEST", `${vivos} siguen existiendo`);
    }
    const residuos = relojes.length - borrados + vivos;
    console.log(`FIXTURES|S|run=${run}|creados=${relojes.length + clientes.length}|eliminados=${relojes.length + clientes.length - residuos}|residuos=${residuos}`);
  }
  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas${omitidas ? `, ${omitidas} omitidas` : ""}`);
  if (fallidas > 0) process.exit(1);
}

void main();
