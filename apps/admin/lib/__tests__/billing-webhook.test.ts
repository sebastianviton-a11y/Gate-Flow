/**
 * Billing V1 — webhook y adaptador Stripe, sin red ni cuenta:
 *   - la firma Stripe-Signature se genera y verifica DE VERDAD con el SDK
 *     (webhooks.generateTestHeaderString / constructEvent, offline);
 *   - la API de Stripe (sesiones, suscripciones, facturas, portal) es un
 *     cliente falso detrás de ClienteStripe;
 *   - la base es un aplicarEvento falso (la RPC real se prueba en
 *     supabase/tests/security/96_billing.sql).
 *   npx tsx apps/admin/lib/__tests__/billing-webhook.test.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import Stripe from "stripe";
import { CATALOGO_BILLING } from "../billing/catalogo";
import { EVENTOS_STRIPE, StripeBillingProvider, TOLERANCIA_FIRMA_SEGUNDOS, estadoDeSuscripcionStripe, type ClienteStripe } from "../billing/proveedores/stripe";
import type { EventoNormalizado } from "../billing/tipos";
import { procesarWebhook, type ResultadoAplicar } from "../billing/webhook";

let pasadas = 0;
let fallidas = 0;
function assert(condicion: boolean, mensaje: string) {
  if (condicion) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}
async function seccion(nombre: string, fn: () => void | Promise<void>) {
  console.log(`\n${nombre}`);
  await fn();
}

const SECRETO = "whsec_test_" + "x".repeat(24);
const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";
const FIN = 1_800_000_000; // segundos

/* eslint-disable @typescript-eslint/no-explicit-any */
function suscripcion(id: string, status: string, extra: Record<string, any> = {}) {
  return {
    id,
    status,
    customer: "cus_1",
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: { tenant_id: B }, // informativa: nunca se usa
    items: { data: [{ quantity: 1, current_period_end: FIN, price: { currency: "mxn", unit_amount: CATALOGO_BILLING["hasta-50"].monto, recurring: { interval: "month", interval_count: 1 } } }] },
    ...extra,
  };
}

function falso() {
  const estado = {
    sesiones: {
      cs_1: { id: "cs_1", mode: "subscription", status: "complete", payment_status: "paid", subscription: "sub_1", customer: "cus_1", client_reference_id: "chk-1", metadata: { tenant_id: B } },
    } as Record<string, any>,
    suscripciones: { sub_1: suscripcion("sub_1", "active") } as Record<string, any>,
    facturas: { in_1: { id: "in_1", parent: { subscription_details: { subscription: "sub_1" } } } } as Record<string, any>,
    creadas: [] as { params: any; opciones: any }[],
    expiradas: [] as string[],
    canceladas: [] as string[],
    portal: [] as any[],
    consultas: [] as number[],
    fallarConsultas: false,
  };
  const consulta = () => {
    if (estado.fallarConsultas) throw new Error("Stripe API caída");
    estado.consultas.push(Date.now());
  };
  const cliente = {
    checkout: {
      sessions: {
        create: async (params: any, opciones: any) => {
          estado.creadas.push({ params, opciones });
          return { id: "cs_nuevo", url: "https://checkout.stripe.test/cs_nuevo" };
        },
        retrieve: async (id: string) => {
          consulta();
          return estado.sesiones[id] ?? { id, status: "expired" };
        },
        list: async (p: { subscription: string }) => {
          consulta();
          return { data: Object.values(estado.sesiones).filter((s: any) => s.subscription === p.subscription) };
        },
        expire: async (id: string) => {
          estado.expiradas.push(id);
          return { id };
        },
      },
    },
    subscriptions: {
      retrieve: async (id: string) => {
        consulta();
        return estado.suscripciones[id];
      },
      cancel: async (id: string) => {
        estado.canceladas.push(id);
        estado.suscripciones[id] = { ...estado.suscripciones[id], status: "canceled" };
        return estado.suscripciones[id];
      },
    },
    invoices: { retrieve: async (id: string) => (consulta(), estado.facturas[id]) },
    billingPortal: { sessions: { create: async (p: any) => (estado.portal.push(p), { url: "https://billing.stripe.test/p" }) } },
  } as unknown as ClienteStripe;
  return { estado, cliente, proveedor: new StripeBillingProvider(cliente, SECRETO, "bpc_test_1") };
}

function evento(id: string, tipo: string, objetoId: string, secreto = SECRETO, timestamp?: number) {
  const cuerpo = JSON.stringify({ id, object: "event", type: tipo, created: Math.floor(Date.now() / 1000), data: { object: { id: objetoId, metadata: { tenant_id: B } } } });
  const firma = Stripe.webhooks.generateTestHeaderString({ payload: cuerpo, secret: secreto, ...(timestamp ? { timestamp } : {}) });
  return { cuerpo, cabeceras: new Headers({ "stripe-signature": firma }) };
}

function base(resultados: ResultadoAplicar[] = [{ resultado: "aplicado", tenant_id: A }]) {
  const aplicados: EventoNormalizado[] = [];
  const logs: string[] = [];
  return {
    aplicados,
    logs,
    aplicarEvento: async (e: EventoNormalizado) => {
      aplicados.push(e);
      return resultados[Math.min(aplicados.length - 1, resultados.length - 1)]!;
    },
    log: (m: string, d: Record<string, unknown>) => {
      logs.push(m + " " + JSON.stringify(d));
    },
  };
}

async function main() {
  await seccion("11–13. firma: válida, inválida, alterada, sin cabecera, replay fuera de ventana", () => {
    const { proveedor } = falso();
    const ok = evento("evt_1", "checkout.session.completed", "cs_1");
    const v = proveedor.verificarWebhook(ok.cuerpo, ok.cabeceras);
    assert(v?.id === "evt_1" && v.tipo === "checkout.session.completed" && v.objetoId === "cs_1", "11. firma válida → evento verificado (id, tipo, objeto)");
    const otro = evento("evt_1", "checkout.session.completed", "cs_1", "whsec_otro_" + "y".repeat(24));
    assert(proveedor.verificarWebhook(otro.cuerpo, otro.cabeceras) === null, "12. firma con otro secreto → rechazada");
    assert(proveedor.verificarWebhook(ok.cuerpo.replace("cs_1", "cs_2"), ok.cabeceras) === null, "12. cuerpo alterado → rechazada");
    assert(proveedor.verificarWebhook(ok.cuerpo, new Headers()) === null, "12. sin Stripe-Signature → rechazada");
    const viejo = evento("evt_1", "checkout.session.completed", "cs_1", SECRETO, Math.floor(Date.now() / 1000) - TOLERANCIA_FIRMA_SEGUNDOS - 60);
    assert(proveedor.verificarWebhook(viejo.cuerpo, viejo.cabeceras) === null, "13. replay fuera de la ventana de 5 min → rechazado");
    assert(new StripeBillingProvider({} as ClienteStripe, "", null).verificarWebhook(ok.cuerpo, ok.cabeceras) === null, "sin STRIPE_WEBHOOK_SECRET → nunca verifica");
  });

  await seccion("12. firma inválida: 401 y ninguna escritura ni consulta", async () => {
    const { proveedor, estado } = falso();
    const b = base();
    const malo = evento("evt_x", "checkout.session.completed", "cs_1", "whsec_otro_" + "y".repeat(24));
    const r = await procesarWebhook({ proveedor, aplicarEvento: b.aplicarEvento, log: b.log }, malo.cuerpo, malo.cabeceras);
    assert(r.status === 401 && b.aplicados.length === 0 && estado.consultas.length === 0, "401, sin RPC ni consultas a Stripe");
  });

  await seccion("Normalización: siempre se vuelve a consultar a Stripe; la metadata nunca es autoridad", async () => {
    const { proveedor, estado } = falso();
    const antes = Date.now();
    const n = await proveedor.normalizarEvento({ id: "evt_1", tipo: "checkout.session.completed", objetoId: "cs_1" });
    assert(n.estado === "active" && n.subscriptionId === "sub_1" && n.customerId === "cus_1", "pago confirmado → active con ids del proveedor");
    assert(n.providerCheckoutId === "cs_1" && n.clientReferenceId === "chk-1", "asociación: la sesión y NUESTRO checkout_id (client_reference_id)");
    assert(n.moneda === "MXN" && n.monto === CATALOGO_BILLING["hasta-50"].monto && n.intervalo === "month", "monto/moneda/intervalo del precio real de la suscripción");
    assert(n.currentPeriodEnd?.getTime() === FIN * 1000 && n.cancelAtPeriodEnd === false, "fin de periodo del item");
    assert(!JSON.stringify(n).includes(B), "la metadata (tenant_id de B) no aparece en lo normalizado");
    assert(n.versionAt.getTime() >= antes && n.versionAt.getTime() <= (estado.consultas[0] ?? 0), "15. versión = instante previo a la consulta (ordena snapshots fuera de orden)");

    estado.sesiones.cs_1 = { ...estado.sesiones.cs_1, payment_status: "unpaid" };
    assert((await proveedor.normalizarEvento({ id: "e", tipo: "checkout.session.completed", objetoId: "cs_1" })).estado === "ignorar", "21. sesión sin pago → no activa");
    estado.sesiones.cs_1 = { ...estado.sesiones.cs_1, payment_status: "paid", mode: "payment" };
    assert((await proveedor.normalizarEvento({ id: "e", tipo: "checkout.session.completed", objetoId: "cs_1" })).estado === "ignorar", "modo payment → ignorado");
    const exp = await proveedor.normalizarEvento({ id: "e", tipo: "checkout.session.expired", objetoId: "cs_1" });
    assert(exp.estado === "checkout_expirado" && exp.providerCheckoutId === "cs_1", "checkout.session.expired → checkout_expirado");
  });

  await seccion("25–26, 29–32. estados de la suscripción", async () => {
    const casos: [string, string][] = [
      ["active", "active"],
      ["past_due", "past_due"],
      ["unpaid", "past_due"],
      ["paused", "past_due"],
      ["canceled", "canceled"],
      ["incomplete", "ignorar"],
      ["incomplete_expired", "ignorar"],
      ["trialing", "ignorar"],
      ["otro", "ignorar"],
    ];
    for (const [stripe, nuestro] of casos) assert(estadoDeSuscripcionStripe(stripe) === nuestro, `${stripe} → ${nuestro}`);

    const { proveedor, estado } = falso();
    estado.suscripciones.sub_1 = suscripcion("sub_1", "past_due");
    const fallo = await proveedor.normalizarEvento({ id: "e2", tipo: "invoice.payment_failed", objetoId: "in_1" });
    assert(fallo.estado === "past_due" && fallo.subscriptionId === "sub_1" && fallo.providerCheckoutId === "cs_1", "26. factura fallida → past_due, asociada a nuestro checkout por la sesión");
    estado.suscripciones.sub_1 = suscripcion("sub_1", "active", { cancel_at_period_end: true });
    const cancel = await proveedor.normalizarEvento({ id: "e3", tipo: "customer.subscription.updated", objetoId: "sub_1" });
    assert(cancel.estado === "active" && cancel.cancelAtPeriodEnd, "30. cancelación pedida → active + cancel_at_period_end");
    estado.suscripciones.sub_1 = suscripcion("sub_1", "active", { cancel_at: FIN - 3600 });
    const antes = await proveedor.normalizarEvento({ id: "e4", tipo: "customer.subscription.updated", objetoId: "sub_1" });
    assert(antes.cancelAtPeriodEnd && antes.currentPeriodEnd?.getTime() === (FIN - 3600) * 1000, "cancel_at anterior al fin del periodo → el acceso termina en cancel_at");
    estado.suscripciones.sub_1 = suscripcion("sub_1", "canceled");
    assert((await proveedor.normalizarEvento({ id: "e5", tipo: "customer.subscription.deleted", objetoId: "sub_1" })).estado === "canceled", "32. borrada → canceled");
    const dos = suscripcion("sub_1", "active");
    dos.items.data.push({ ...dos.items.data[0]! });
    estado.suscripciones.sub_1 = dos;
    assert((await proveedor.normalizarEvento({ id: "e6", tipo: "invoice.paid", objetoId: "in_1" })).monto === null, "19. dos líneas → monto no comparable (la base rechaza la activación)");
    estado.suscripciones.sub_1 = suscripcion("sub_1", "active", {
      items: { data: [{ quantity: 1, current_period_end: FIN, price: { currency: "usd", unit_amount: 2900, recurring: { interval: "year", interval_count: 1 } } }] },
    });
    const usd = await proveedor.normalizarEvento({ id: "e7", tipo: "invoice.paid", objetoId: "in_1" });
    assert(usd.moneda === "USD" && usd.monto === 2900 && usd.intervalo === "year", "19–20. moneda/monto/intervalo reales se envían tal cual (la base los compara con el checkout)");
    estado.facturas.in_2 = { id: "in_2", parent: null };
    assert((await proveedor.normalizarEvento({ id: "e8", tipo: "invoice.paid", objetoId: "in_2" })).estado === "ignorar", "factura sin suscripción → ignorada");
    assert((await proveedor.normalizarEvento({ id: "e9", tipo: "charge.succeeded", objetoId: "ch_1" })).estado === "ignorar", "tipo no manejado → ignorado");
  });

  await seccion("Webhook: flujo completo, duplicados y errores", async () => {
    const { proveedor, estado } = falso();
    const ok = evento("evt_1", "checkout.session.completed", "cs_1");

    const b1 = base();
    const r1 = await procesarWebhook({ proveedor, aplicarEvento: b1.aplicarEvento, log: b1.log }, ok.cuerpo, ok.cabeceras);
    assert(r1.status === 200 && b1.aplicados.length === 1 && b1.aplicados[0]?.estado === "active", "11. firma válida → RPC con el estado normalizado → 200");

    const b2 = base([{ resultado: "duplicado", resultado_original: "aplicado" }]);
    const r2 = await procesarWebhook({ proveedor, aplicarEvento: b2.aplicarEvento, log: b2.log }, ok.cuerpo, ok.cabeceras);
    assert(r2.status === 200 && estado.canceladas.length === 0, "14. duplicado → 200 sin efectos extra");

    const b3 = base([{ resultado: "suscripcion_duplicada", tenant_id: A }]);
    await procesarWebhook({ proveedor, aplicarEvento: b3.aplicarEvento, log: b3.log }, ok.cuerpo, ok.cabeceras);
    assert(estado.canceladas.join(",") === "sub_1", "36. suscripción duplicada → se cancela en Stripe (la vigente no se pisa)");

    estado.suscripciones.sub_1 = suscripcion("sub_1", "active");
    estado.canceladas = [];
    const b4 = base([{ resultado: "duplicado", resultado_original: "suscripcion_duplicada" }]);
    await procesarWebhook({ proveedor, aplicarEvento: b4.aplicarEvento, log: b4.log }, ok.cuerpo, ok.cabeceras);
    assert(estado.canceladas.join(",") === "sub_1", "reintento de una duplicada → vuelve a intentar cancelarla");
    estado.canceladas = [];
    await procesarWebhook({ proveedor, aplicarEvento: b4.aplicarEvento, log: b4.log }, ok.cuerpo, ok.cabeceras);
    assert(estado.canceladas.length === 0, "cancelar es idempotente (ya cancelada en Stripe)");

    for (const resultado of ["sin_asociacion", "rechazado", "obsoleto", "ignorado"]) {
      const b = base([{ resultado }]);
      const r = await procesarWebhook({ proveedor, aplicarEvento: b.aplicarEvento, log: b.log }, ok.cuerpo, ok.cabeceras);
      assert(r.status === 200, `15–17. ${resultado} → 200 (registrado en la base; Stripe no reintenta en bucle)`);
    }

    estado.fallarConsultas = true;
    const b5 = base();
    const r5 = await procesarWebhook({ proveedor, aplicarEvento: b5.aplicarEvento, log: b5.log }, ok.cuerpo, ok.cabeceras);
    assert(r5.status === 500 && b5.aplicados.length === 0, "Stripe API caída → 500 (reintento) y nada aplicado");
    estado.fallarConsultas = false;
    const r6 = await procesarWebhook(
      { proveedor, aplicarEvento: async () => { throw new Error("db"); }, log: () => {} },
      ok.cuerpo,
      ok.cabeceras,
    );
    assert(r6.status === 500, "base caída → 500 (la RPC es atómica: el evento no quedó registrado)");
    const todos = [...b1.logs, ...b3.logs, ...b5.logs].join("\n");
    assert(!/@|email|card|tarjeta|cus_1|whsec/i.test(todos), "logs sin email, tarjeta, cliente ni secretos");
  });

  await seccion("Checkout hospedado y portal", async () => {
    const { proveedor, estado } = falso();
    const r = await proveedor.crearCheckout({
      checkoutId: "chk-9",
      tenantId: A,
      plan: CATALOGO_BILLING["hasta-150"],
      emailPagador: "admin@x.test",
      customerId: null,
      urlExito: "https://admin.test/suscripcion/procesando?c=chk-9",
      urlCancelar: "https://admin.test/suscripcion",
      expiraEn: new Date(Date.now() + 3_600_000),
    });
    const { params, opciones } = estado.creadas[0]!;
    assert(r.url === "https://checkout.stripe.test/cs_nuevo" && r.providerCheckoutId === "cs_nuevo", "devuelve la URL hospedada");
    assert(params.mode === "subscription" && params.client_reference_id === "chk-9", "modo subscription + client_reference_id = nuestro checkout");
    const pd = params.line_items[0].price_data;
    assert(pd.currency === "mxn" && pd.unit_amount === CATALOGO_BILLING["hasta-150"].monto && pd.recurring.interval === "month", "precio inline MXN mensual del catálogo");
    assert(params.line_items.length === 1 && params.line_items[0].quantity === 1, "una línea, cantidad 1");
    assert(!params.subscription_data.trial_period_days && !params.subscription_data.trial_end, "sin trial en Stripe (el trial de 30 días ya se usó)");
    assert(params.customer_email === "admin@x.test" && !params.customer, "cliente nuevo: email prellenado");
    assert(params.success_url.endsWith("/suscripcion/procesando?c=chk-9") && params.cancel_url.endsWith("/suscripcion"), "success/cancel");
    assert(opciones.idempotencyKey === "checkout-chk-9", "idempotencia de la creación por checkout");
    await proveedor.crearCheckout({ ...{ checkoutId: "chk-10", tenantId: A, plan: CATALOGO_BILLING["hasta-50"], emailPagador: "a@x.test", customerId: "cus_viejo", urlExito: "u", urlCancelar: "c", expiraEn: new Date(Date.now() + 3_600_000) } });
    assert(estado.creadas[1]!.params.customer === "cus_viejo" && !estado.creadas[1]!.params.customer_email, "33. realta: reutiliza el cliente de Stripe");
    await proveedor.expirarCheckout("cs_1");
    assert(estado.expiradas.length === 0, "una sesión ya completada no se expira");
    const portal = await proveedor.crearSesionGestion("cus_1", "https://admin.test/suscripcion");
    assert(portal.url.startsWith("https://billing.stripe.test") && estado.portal[0].configuration === "bpc_test_1", "portal con NUESTRA configuración (cancelar al final, sin cambio de plan)");
    let sinConfig = false;
    try {
      await new StripeBillingProvider({} as ClienteStripe, SECRETO, null).crearSesionGestion("cus_1", "u");
    } catch {
      sinConfig = true;
    }
    assert(sinConfig, "sin STRIPE_PORTAL_CONFIGURATION_ID el portal no se abre con la configuración por defecto");
    assert(EVENTOS_STRIPE.includes("checkout.session.completed") && EVENTOS_STRIPE.includes("invoice.payment_failed") && EVENTOS_STRIPE.includes("customer.subscription.deleted"), "eventos a suscribir en Stripe");
  });

  await seccion("21. la success URL no activa; solo el webhook verificado escribe", () => {
    const RAIZ = join(__dirname, "../../../..");
    const leer = (r: string) => readFileSync(join(RAIZ, r), "utf8");
    const procesando = leer("apps/admin/app/suscripcion/procesando/page.tsx") + leer("apps/admin/app/suscripcion/procesando/espera-confirmacion.tsx");
    assert(!/\.rpc\(|\.(insert|update|upsert|delete)\(|billing\/servidor|actions/.test(procesando), "/suscripcion/procesando no escribe ni llama a billing");
    assert(procesando.includes('decision.tipo === "permitir" && decision.estado === "activa") redirect("/dashboard")'), "con la suscripción activa → dashboard");
    const archivos: string[] = [];
    const recorrer = (d: string) => {
      for (const n of readdirSync(d)) {
        if (n === "node_modules" || n === ".next" || n === "__tests__") continue;
        const p = join(d, n);
        if (statSync(p).isDirectory()) recorrer(p);
        else if (/\.(ts|tsx)$/.test(n)) archivos.push(p);
      }
    };
    recorrer(join(RAIZ, "apps"));
    recorrer(join(RAIZ, "packages"));
    const conAplicar = archivos.filter((f) => /\.rpc\(\s*"billing_aplicar_evento"/.test(readFileSync(f, "utf8"))).map((f) => relative(RAIZ, f));
    assert(conAplicar.join(",") === "apps/admin/lib/billing/servidor.ts", `.rpc("billing_aplicar_evento") solo desde el servidor del webhook (${conAplicar.join(",")})`);
    const ruta = leer("apps/admin/app/api/billing/webhook/stripe/route.ts");
    assert(ruta.includes("await request.text()") && ruta.includes('runtime = "nodejs"'), "la ruta lee el cuerpo CRUDO (firma) en runtime Node");
    const clientes = archivos.filter((f) => /^\s*["']use client["']/m.test(readFileSync(f, "utf8")));
    assert(clientes.every((f) => !/STRIPE_|from "stripe"|billing\/servidor|proveedores\/stripe/.test(readFileSync(f, "utf8"))), "ningún Client Component toca Stripe ni sus secretos");
    assert(!archivos.some((f) => /NEXT_PUBLIC_STRIPE/.test(readFileSync(f, "utf8"))) && !/NEXT_PUBLIC_STRIPE/.test(leer("apps/admin/.env.example")), "no existe NEXT_PUBLIC_STRIPE_*");
    const env = leer("apps/admin/.env.example");
    assert(/^STRIPE_SECRET_KEY=$/m.test(env) && /^STRIPE_WEBHOOK_SECRET=$/m.test(env) && /^STRIPE_PORTAL_CONFIGURATION_ID=$/m.test(env), ".env.example: solo nombres, sin valores");
    assert(!/sk_(test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/.test(env), ".env.example sin claves");
    assert(leer("apps/admin/middleware.ts").includes("api/billing/webhook/"), "el webhook queda fuera del middleware de sesión (no redirige a /login)");
    const servidor = leer("apps/admin/lib/billing/servidor.ts");
    assert(servidor.startsWith('import "server-only";'), "lib/billing/servidor.ts es server-only");
    assert(servidor.includes('esLive && process.env.STRIPE_PERMITIR_LIVE !== "true"'), "una clave live se rechaza salvo STRIPE_PERMITIR_LIVE=true");
  });

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
}

void main();
