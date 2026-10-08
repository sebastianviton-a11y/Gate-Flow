/**
 * Batería billing — capa B2 (pipeline): webhook → base REAL.
 *   firma Stripe real (SDK offline) → procesarWebhook → StripeBillingProvider
 *   (API de Stripe simulada) → aplicarEventoEnBase de lib/billing/servidor.ts
 *   (supabase-js con la clave de servicio) → PostgREST local → billing_aplicar_evento.
 * Más procesarWebhookStripe con configuración inválida (503, sin escrituras
 * ni secretos en el log).
 *
 * Solo la ejecuta tests/billing/e2e/run-local.mjs, que levanta la pila
 * local y pasa GF_BILLING_PIPELINE=1 + la base gf_billing_* + el registro
 * de fixtures. Sin eso: SKIP. "server-only" se resuelve con
 * tests/billing/e2e/server-only-shim.cjs (NODE_OPTIONS=--require).
 */
import { execFileSync } from "node:child_process";
import Stripe from "stripe";
import { CATALOGO_BILLING } from "../billing/catalogo";
import { iniciarCheckout } from "../billing/checkout";
import { StripeBillingProvider, type ClienteStripe } from "../billing/proveedores/stripe";
import { procesarWebhook } from "../billing/webhook";

let pasadas = 0;
let fallidas = 0;
let escenario = "00";
function assert(condicion: boolean, mensaje: string) {
  const limpio = mensaje.replace(/[|\n]/g, " ");
  if (condicion) pasadas++;
  else fallidas++;
  console.log(`RESULT|B2|${escenario}|${condicion ? "PASS" : "FAIL"}|${limpio}`);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main() {
  if (process.env.GF_BILLING_PIPELINE !== "1") {
    console.log("RESULT|B2|--|SKIP|pipeline webhook→base: solo con la pila local (tests/billing/e2e/run-local.mjs)");
    console.log("\n0 pasadas, 0 fallidas");
    return;
  }
  const DB = process.env.GF_BILLING_DB ?? "";
  if (!/^gf_billing_/.test(DB) || /supabase/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
    console.log("RESULT|B2|--|FAIL|rechazado: el pipeline solo corre contra la pila local");
    process.exit(1);
  }
  const reg = JSON.parse(process.env.GF_BILLING_REGISTRO ?? "{}");
  const RUN: string = reg.run;
  // Claves que crea tests/billing/e2e/fixtures.sql.
  const T = reg.tenant as { VENC: string; GRANDE: string; ACTIVO: string; PIPE: string; OTRO: string };
  const U = reg.usuario as { admin_pipe: string; guard_venc: string };
  const sql = (q: string) => execFileSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", q], { encoding: "utf8" }).trim();
  const hs = (tenant: string) => sql(`select md5(s::text) from public.suscripciones s where tenant_id = '${tenant}'`);
  const eventos: string[] = [];
  const nuevoEvento = (sufijo: string) => {
    const id = `evt_${RUN}_P${sufijo}`;
    eventos.push(id);
    return id;
  };
  const servidor = await import("../billing/servidor");
  const { createServiceRoleClient } = await import("@gateflow/supabase");
  const servicio = createServiceRoleClient();

  // ── Stripe simulado ──
  const SECRETO = "whsec_test_" + RUN.toLowerCase().replace(/[^a-z0-9]/g, "");
  const fin = Math.floor(Date.now() / 1000) + 30 * 86_400;
  const precio = { currency: "mxn", unit_amount: CATALOGO_BILLING["hasta-50"].monto, recurring: { interval: "month", interval_count: 1 } };
  const sub = (id: string, status = "active") => ({ id, status, customer: `cus_${RUN}_PIPE`, cancel_at_period_end: false, cancel_at: null, items: { data: [{ quantity: 1, current_period_end: fin, price: precio }] } });
  const est = { sesiones: {} as Record<string, any>, subs: {} as Record<string, any>, facturas: {} as Record<string, any>, canceladas: [] as string[] };
  const cliente = {
    checkout: {
      sessions: {
        create: async (p: any) => {
          const id = `cs_test_${RUN}_P1`;
          est.sesiones[id] = { id, mode: "subscription", status: "open", payment_status: "unpaid", subscription: null, customer: null, client_reference_id: p.client_reference_id };
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
        retrieve: async (id: string) => est.sesiones[id] ?? { id, status: "expired" },
        list: async (p: { subscription: string }) => ({ data: Object.values(est.sesiones).filter((s: any) => s.subscription === p.subscription) }),
        expire: async (id: string) => ({ id }),
      },
    },
    subscriptions: {
      retrieve: async (id: string) => est.subs[id],
      cancel: async (id: string) => (est.canceladas.push(id), (est.subs[id] = { ...est.subs[id], status: "canceled" })),
    },
    invoices: { retrieve: async (id: string) => est.facturas[id] },
    billingPortal: { sessions: { create: async () => ({ url: "https://billing.stripe.test/p" }) } },
  } as unknown as ClienteStripe;
  const proveedor = new StripeBillingProvider(cliente, SECRETO, null);
  const deps = { proveedor, aplicarEvento: (e: any) => servidor.aplicarEventoEnBase(e, "stripe") };
  const enviar = (id: string, tipo: string, objeto: string, secreto = SECRETO) => {
    const cuerpo = JSON.stringify({ id, object: "event", type: tipo, data: { object: { id: objeto } } });
    return procesarWebhook(deps, cuerpo, new Headers({ "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: cuerpo, secret: secreto }) }));
  };

  // ── 03. Checkout por el núcleo real + RPC real vía PostgREST (service_role) ──
  escenario = "03";
  const r = await iniciarCheckout(
    {
      proveedor,
      urlBase: "http://localhost:3000",
      paisDelTenant: async () => "MX",
      contarViviendas: async () => ({ declaradas: 40, unidadesActivas: Number(sql(`select count(*) from public.unidades where tenant_id = '${T.PIPE}' and activo`)) }),
      async crearCheckoutEnBase({ userId, tenantId, plan, expiraEn }) {
        const { data, error } = await servicio.rpc("billing_crear_checkout", {
          p_user_id: userId, p_tenant_id: tenantId, p_plan: plan.id, p_provider: "stripe", p_moneda: plan.moneda, p_monto: plan.monto, p_expires_at: expiraEn.toISOString(),
        });
        if (error) throw new Error(error.message);
        return { checkoutId: (data as any).checkout_id, anteriores: (data as any).anteriores ?? [] };
      },
      async registrarCheckoutProveedor(checkoutId, providerCheckoutId) {
        const { error } = await servicio.rpc("billing_registrar_checkout_proveedor", { p_checkout_id: checkoutId, p_provider_checkout_id: providerCheckoutId });
        if (error) throw new Error(error.message);
      },
      clienteExistente: async () => null,
    },
    { userId: U.admin_pipe, tenantId: T.PIPE, planId: "hasta-50", emailPagador: null },
  );
  assert(r.ok, "checkout creado (núcleo + RPC por PostgREST como service_role)");
  const chk = r.ok ? r.checkoutId : "";
  assert(sql(`select concat_ws('/', count(*), min(plan), min(monto), min(provider_checkout_id)) from public.billing_checkouts where tenant_id = '${T.PIPE}'`) === `1/hasta-50/49900/cs_test_${RUN}_P1`, "1 billing_checkout con plan/monto/id del proveedor");
  assert(sql(`select estado from public.suscripciones where tenant_id = '${T.PIPE}'`) === "trialing", "sin activación antes del webhook");
  const guardia = await servicio.rpc("billing_crear_checkout", { p_user_id: U.guard_venc, p_tenant_id: T.PIPE, p_plan: "hasta-50", p_provider: "stripe", p_moneda: "MXN", p_monto: 49900, p_expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  assert(/billing:rol/.test(guardia.error?.message ?? ""), "un usuario que no es admin del tenant: billing:rol");

  // ── 04. checkout.session.completed → active (base real) ──
  escenario = "04";
  est.sesiones[`cs_test_${RUN}_P1`] = { ...est.sesiones[`cs_test_${RUN}_P1`], status: "complete", payment_status: "paid", subscription: `sub_${RUN}_PIPE`, customer: `cus_${RUN}_PIPE` };
  est.subs[`sub_${RUN}_PIPE`] = sub(`sub_${RUN}_PIPE`);
  const e04 = nuevoEvento("04");
  const w04 = await enviar(e04, "checkout.session.completed", `cs_test_${RUN}_P1`);
  assert(w04.status === 200, "webhook 200");
  assert(
    sql(`select concat_ws('/', estado, provider, provider_subscription_id, provider_customer_id, plan, current_period_end = to_timestamp(${fin})) from public.suscripciones where tenant_id = '${T.PIPE}'`) ===
      `active/stripe/sub_${RUN}_PIPE/cus_${RUN}_PIPE/hasta-50/t`,
    "suscripción active / stripe / ids / plan / current_period_end",
  );
  assert(sql(`select concat_ws('/', estado, provider_subscription_id) from public.billing_checkouts where id = '${chk}'`) === `completed/sub_${RUN}_PIPE`, "checkout completed");
  assert(sql(`select resultado from public.billing_eventos where provider_event_id = '${e04}'`) === "aplicado", "billing_eventos: aplicado");

  // ── 05. Idempotencia ──
  escenario = "05";
  const h05 = hs(T.PIPE);
  const w05 = await enviar(e04, "checkout.session.completed", `cs_test_${RUN}_P1`);
  assert(w05.status === 200 && hs(T.PIPE) === h05 && sql(`select count(*) from public.billing_eventos where provider_event_id = '${e04}'`) === "1", "mismo evento: 200, sin cambios, una fila");

  // ── 14. Firma inválida ──
  escenario = "14";
  const antes14 = sql("select count(*) from public.billing_eventos");
  const w14 = await enviar(nuevoEvento("14"), "checkout.session.completed", `cs_test_${RUN}_P1`, "whsec_test_incorrecto");
  eventos.pop(); // nunca llegó a la base
  assert(w14.status === 401 && sql("select count(*) from public.billing_eventos") === antes14, "firma inválida: 401 y 0 escrituras");

  // ── 06. Suscripción de OTRO tenant ──
  escenario = "06";
  const hOtro = hs(T.OTRO);
  est.sesiones[`cs_test_${RUN}_P1`] = { ...est.sesiones[`cs_test_${RUN}_P1`], subscription: `sub_${RUN}_OTRO` };
  est.subs[`sub_${RUN}_OTRO`] = sub(`sub_${RUN}_OTRO`);
  const e06 = nuevoEvento("06");
  const w06 = await enviar(e06, "checkout.session.completed", `cs_test_${RUN}_P1`);
  assert(w06.status === 200 && sql(`select resultado || '/' || (detalle->>'motivo') from public.billing_eventos where provider_event_id = '${e06}'`) === "rechazado/suscripcion_de_otro_tenant", "rechazado: suscripcion_de_otro_tenant");
  assert(est.canceladas.length === 0, "NO se cancela la suscripción del otro tenant en Stripe");
  assert(hs(T.OTRO) === hOtro && hs(T.PIPE) === h05, "ambos tenants intactos (hash)");

  // ── 07. Duplicada del mismo tenant ──
  escenario = "07";
  est.sesiones[`cs_test_${RUN}_P1`] = { ...est.sesiones[`cs_test_${RUN}_P1`], subscription: `sub_${RUN}_PIPE2` };
  est.subs[`sub_${RUN}_PIPE2`] = sub(`sub_${RUN}_PIPE2`);
  const w07 = await enviar(nuevoEvento("07"), "checkout.session.completed", `cs_test_${RUN}_P1`);
  assert(w07.status === 200 && est.canceladas.join() === `sub_${RUN}_PIPE2`, "duplicada: se cancela SOLO la nueva en Stripe");
  assert(hs(T.PIPE) === h05, "la vigente no cambia");
  est.sesiones[`cs_test_${RUN}_P1`] = { ...est.sesiones[`cs_test_${RUN}_P1`], subscription: `sub_${RUN}_PIPE` };

  // ── 09. invoice.payment_failed → past_due ──
  escenario = "09";
  // Como en Stripe: la renovación ya ADELANTÓ el periodo del ítem (fin
  // futuro) y el impago empieza en el inicio de ese periodo (hace 2 días).
  const inicioImpago = Math.floor(Date.now() / 1000) - 2 * 86_400;
  const subImpaga = (inicio: number) => {
    const s = sub(`sub_${RUN}_PIPE`, "past_due");
    s.items.data[0] = { ...s.items.data[0], current_period_start: inicio, current_period_end: inicio + 30 * 86_400 } as any;
    return s;
  };
  est.subs[`sub_${RUN}_PIPE`] = subImpaga(inicioImpago);
  est.facturas[`in_${RUN}_1`] = { id: `in_${RUN}_1`, parent: { subscription_details: { subscription: `sub_${RUN}_PIPE` } } };
  const w09 = await enviar(nuevoEvento("09"), "invoice.payment_failed", `in_${RUN}_1`);
  assert(w09.status === 200 && sql(`select estado from public.suscripciones where tenant_id = '${T.PIPE}'`) === "past_due", "past_due en la base");
  escenario = "10";
  const impagoEnBase = () => sql(`select coalesce((impago_desde = to_timestamp(${inicioImpago}))::text, 'null') || '/' || (current_period_end > now() + interval '20 days')::text from public.suscripciones where tenant_id = '${T.PIPE}'`);
  assert(impagoEnBase() === "true/true", "impago_desde = inicio del periodo impago (no el fin futuro del periodo)");
  // Reintento fallido: Stripe reporta otra vez el periodo (aquí, con un
  // inicio posterior a propósito): el inicio del episodio no se mueve.
  est.subs[`sub_${RUN}_PIPE`] = subImpaga(inicioImpago + 3 * 86_400);
  const evt09b = nuevoEvento("09b");
  const w09b = await enviar(evt09b, "invoice.payment_failed", `in_${RUN}_1`);
  assert(w09b.status === 200 && impagoEnBase() === "true/true", "reintento fallido: no reinicia ni extiende la gracia");
  const w09c = await enviar(evt09b, "invoice.payment_failed", `in_${RUN}_1`);
  assert(w09c.status === 200 && impagoEnBase() === "true/true", "evento duplicado: sin cambios");
  escenario = "09";

  // ── 11. invoice.paid → active ──
  escenario = "11";
  est.subs[`sub_${RUN}_PIPE`] = sub(`sub_${RUN}_PIPE`, "active");
  const w11 = await enviar(nuevoEvento("11"), "invoice.paid", `in_${RUN}_1`);
  assert(w11.status === 200 && sql(`select estado || '/' || coalesce(impago_desde::text, 'null') from public.suscripciones where tenant_id = '${T.PIPE}'`) === "active/null", "pago recuperado: active y episodio de impago cerrado");
  assert(sql(`select count(*) from public.audit_log where tenant_id = '${T.PIPE}' and accion = 'billing.pago_recuperado'`) === "1", "auditoría billing.pago_recuperado");

  // ── 13. Fuera de orden: un evento viejo se aplica con el estado ACTUAL ──
  escenario = "13";
  const w13 = await enviar(nuevoEvento("13"), "invoice.payment_failed", `in_${RUN}_1`);
  assert(w13.status === 200 && sql(`select estado || '/' || coalesce(impago_desde::text, 'null') from public.suscripciones where tenant_id = '${T.PIPE}'`) === "active/null", "payment_failed tardío con la suscripción ya active: sigue active, sin reabrir el impago");

  // Nuevo impago (renovación siguiente) y, DESPUÉS, el webhook del episodio
  // anterior (factura in_1): el servidor reconsulta la suscripción, así que
  // usa el estado ACTUAL; el inicio del episodio nuevo no se mueve.
  const inicioImpago2 = Math.floor(Date.now() / 1000) - 3600;
  est.subs[`sub_${RUN}_PIPE`] = subImpaga(inicioImpago2);
  est.facturas[`in_${RUN}_2`] = { id: `in_${RUN}_2`, parent: { subscription_details: { subscription: `sub_${RUN}_PIPE` } } };
  const w13b = await enviar(nuevoEvento("13b"), "invoice.payment_failed", `in_${RUN}_2`);
  const impago2 = () => sql(`select estado || '/' || coalesce((impago_desde = to_timestamp(${inicioImpago2}))::text, 'null') from public.suscripciones where tenant_id = '${T.PIPE}'`);
  assert(w13b.status === 200 && impago2() === "past_due/true", "nuevo impago tras la recuperación: episodio nuevo con su propio inicio");
  const w13c = await enviar(nuevoEvento("13c"), "invoice.payment_failed", `in_${RUN}_1`);
  assert(w13c.status === 200 && impago2() === "past_due/true", "webhook del episodio ANTERIOR recibido después: el episodio nuevo no cambia");
  assert(sql(`select string_agg(coalesce(detalle->>'estado_proveedor', '-'), ',' order by provider_event_id) from public.billing_eventos where provider_event_id in ('evt_${RUN}_P13b', 'evt_${RUN}_P13c')`) === "past_due,past_due",
    "el status real del proveedor queda en el detalle de cada evento");

  // ── 12. customer.subscription.deleted ──
  escenario = "12";
  est.subs[`sub_${RUN}_PIPE`] = sub(`sub_${RUN}_PIPE`, "canceled");
  const w12 = await enviar(nuevoEvento("12"), "customer.subscription.deleted", `sub_${RUN}_PIPE`);
  assert(w12.status === 200 && sql(`select estado from public.suscripciones where tenant_id = '${T.PIPE}'`) === "canceled", "canceled en la base");

  // ── 15. Configuración inválida en el servidor real: 503, sin escrituras, sin secretos en el log ──
  escenario = "15";
  const salida: string[] = [];
  const originales = { info: console.info, error: console.error, warn: console.warn, log: console.log };
  const capturar = (...a: unknown[]) => void salida.push(a.map(String).join(" "));
  const antes15 = sql("select count(*) from public.billing_eventos");
  const claveLive = "sk_live_" + "Z".repeat(30);
  const casos: [string, Record<string, string | undefined>][] = [
    ["sin webhook secret", { STRIPE_SECRET_KEY: "sk_test_" + "Y".repeat(30), STRIPE_WEBHOOK_SECRET: "" }],
    ["clave live en local/staging", { STRIPE_SECRET_KEY: claveLive, STRIPE_WEBHOOK_SECRET: SECRETO, STRIPE_PERMITIR_LIVE: "true" }],
    ["clave live sin permiso", { STRIPE_SECRET_KEY: claveLive, STRIPE_WEBHOOK_SECRET: SECRETO }],
  ];
  const claves = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PERMITIR_LIVE", "NEXT_PUBLIC_ADMIN_APP_URL"] as const;
  const previo = Object.fromEntries(claves.map((k) => [k, process.env[k]]));
  const restaurar = () => {
    for (const k of claves) {
      if (previo[k] === undefined) delete process.env[k];
      else process.env[k] = previo[k];
    }
  };
  for (const [nombre, env] of casos) {
    for (const k of claves) delete process.env[k];
    process.env.NEXT_PUBLIC_ADMIN_APP_URL = "http://localhost:3923";
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    Object.assign(console, { info: capturar, error: capturar, warn: capturar, log: capturar });
    const cuerpo = JSON.stringify({ id: `evt_${RUN}_P15`, type: "checkout.session.completed", data: { object: { id: `cs_test_${RUN}_P1` } } });
    const resp = await servidor.procesarWebhookStripe(cuerpo, new Headers({ "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: cuerpo, secret: SECRETO }) }));
    Object.assign(console, originales);
    restaurar();
    assert(resp.status === 503, `${nombre}: webhook 503 (falla cerrado)`);
  }
  const log = salida.join("\n");
  assert(sql("select count(*) from public.billing_eventos") === antes15, "configuración inválida: 0 escrituras");
  assert(!log.includes("ZZZZ") && !log.includes("YYYY") && !log.includes(SECRETO) && !/whsec_|sk_live_|sk_test_|rk_test_/.test(log), "el log no contiene claves ni secretos");
  assert(/live_en_staging/.test(log) && /live_no_permitido/.test(log), "el log registra solo el motivo");

  console.log(`EVENTOS|${eventos.join(",")}`);
  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
}

void main();
