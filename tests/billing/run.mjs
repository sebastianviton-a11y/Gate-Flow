#!/usr/bin/env node
// ============================================================
// Batería billing + lifecycle — comando único.
//
//   pnpm test:billing           capas A + B (seguro para CI: sin red, sin
//                               credenciales, sin staging)
//   pnpm test:billing:e2e       A + B + C local (Next + PostgREST + Playwright)
//                               + C staging si GF_BILLING_E2E_STAGING=1
//                               + S Stripe TEST si GF_BILLING_STRIPE_TEST=1
//   node tests/billing/run.mjs --staging   solo C staging (opt-in)
//   node tests/billing/run.mjs --stripe    solo S Stripe TEST (opt-in)
//
// En CI (CI=true) staging y Stripe TEST solo corren desde un workflow
// manual (GITHUB_EVENT_NAME=workflow_dispatch) con la confirmación
// explícita GF_BILLING_CONFIRMACION=staging | stripe-test.
// GF_BILLING_EXIGIR=A,B convierte en FAIL un SKIP de esas capas (CI) y,
// con cualquier valor, también un PENDIENTE: en CI ninguna regla conocida
// puede quedar como pendiente (la gracia de past_due es obligatoria).
//
// Capas:
//   A        apps/admin/lib/__tests__/billing-bateria.test.ts (+ las suites
//            de billing existentes)
//   B        tests/billing/db/run-local.sh  (paquete SQL, base local, revertido)
//   B2 / C-local  tests/billing/e2e/run-local.mjs
//   C-prueba      tests/recorrido/run-local.mjs (solo --e2e): prueba gratuita
//                 de punta a punta (landing → registro AR → correo →
//                 onboarding → guardia en Guard → vencimiento) con el Auth
//                 real de Supabase; ver tests/recorrido/README.md
//   B2-compat     tests/billing/compat/rpc-postgrest.mjs (solo --e2e): llamada del
//                 servidor anterior contra el esquema migrado, por PostgREST
//   C-staging     tests/billing/staging/run-staging.sh (opt-in; escribe filas
//                 sintéticas en staging dentro de una transacción y las revierte)
//   S             apps/admin/lib/__tests__/billing-stripe-integracion.test.ts
//                 (opt-in; Stripe TEST real con test clocks + webhooks reales)
// Cada capa imprime RESULT|capa|escenario|PASS/FAIL/SKIP|caso; aquí se
// agregan y se imprime el resumen. Código de salida 1 si hay algún FAIL.
// ============================================================
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const E2E = process.argv.includes("--e2e");
const SOLO_STAGING = process.argv.includes("--staging");
const SOLO_STRIPE = process.argv.includes("--stripe");
const MODO = SOLO_STAGING ? "STAGING (C-staging)" : SOLO_STRIPE ? "STRIPE TEST (S)" : E2E ? "E2E (A + B + C + opt-in)" : "CI (A + B)";
const EXIGIDAS = new Set((process.env.GF_BILLING_EXIGIR ?? "").split(",").map((x) => x.trim()).filter(Boolean));
// En los modos dedicados, la capa pedida es obligatoria: si no corre, no hay verde.
if (SOLO_STAGING) EXIGIDAS.add("C-staging");
if (SOLO_STRIPE) EXIGIDAS.add("S");
/** Staging / Stripe TEST: opt-in; en CI, solo workflow manual con confirmación. */
function permitido(variable, confirmacion) {
  if (process.env[variable] !== "1") return { ok: false, motivo: `opt-in: ${variable}=1` };
  if (process.env.CI === "true" && !(process.env.GITHUB_EVENT_NAME === "workflow_dispatch" && process.env.GF_BILLING_CONFIRMACION === confirmacion)) {
    return { ok: false, motivo: `en CI solo desde el workflow manual con GF_BILLING_CONFIRMACION=${confirmacion}` };
  }
  return { ok: true };
}
const ESCENARIOS = {
  "00": "Preparación / salvaguardas",
  "01": "Trial activo",
  "02": "Trial vencido",
  "03": "Checkout válido",
  "04": "Webhook checkout.session.completed",
  "05": "Idempotencia",
  "06": "Evento de otro tenant (W04)",
  "07": "Suscripción duplicada mismo tenant",
  "08": "cancel_at_period_end",
  "09": "past_due dentro de la gracia",
  "10": "past_due fuera de la gracia",
  "11": "Pago recuperado (invoice.paid)",
  "12": "customer.subscription.deleted",
  "13": "Eventos fuera de orden",
  "14": "Firma inválida",
  "15": "Config Stripe inválida",
  "16": "Elegibilidad por viviendas",
  "17": "Roles",
  "18": "Multitenant",
  "19": "Integridad referencial",
  "20": "Teardown / residuos",
  // Prueba gratuita de punta a punta (tests/recorrido/run-local.mjs).
  // 21–30 quedan reservados para Argentina / Mercado Pago (su rama).
  "31": "Prueba · landing V2 → Probar gratis",
  "32": "Prueba · registro AR + correo + 30 días",
  "33": "Prueba · residentes y guardias",
  "34": "Prueba · AR sin contratación paga (interfaz y servidor)",
  "35": "Prueba · ningún correo a dominios reales",
  "36": "Prueba · anti-bot Turnstile (formulario y servidor)",
  "37": "Prueba · entorno de clientes (sin claves de prueba ni precios sin aprobar)",
};

// Entorno limpio para las suites TS: sin URLs públicas del shell que cambian resultados.
const envLimpio = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NEXT_PUBLIC_") && !k.startsWith("STRIPE_") && k !== "SUPABASE_SERVICE_ROLE_KEY"));

function correr(nombre, comando, args, env = process.env) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const p = spawn(comando, args, { cwd: RAIZ, env, stdio: ["ignore", "pipe", "pipe"] });
    let salida = "";
    let errores = "";
    p.stdout.on("data", (d) => (salida += d));
    p.stderr.on("data", (d) => (errores += d));
    p.on("close", (codigo) => resolve({ nombre, codigo, salida, errores, segundos: Math.round((Date.now() - inicio) / 1000) }));
  });
}

const resultados = [];
const fixtures = [];
const capas = [];
function absorber(r, capaPorDefecto) {
  let lineas = 0;
  for (const l of r.salida.split("\n")) {
    if (l.startsWith("RESULT|")) {
      const [, capa, escenario, estado, ...caso] = l.split("|");
      resultados.push({ capa, escenario, estado, caso: caso.join("|") });
      lineas++;
    } else if (l.startsWith("FIXTURES|")) fixtures.push(l);
  }
  // Suites existentes: "N pasadas, M fallidas".
  const m = /(\d+) pasadas, (\d+) fallidas/.exec(r.salida);
  if (!lineas && m) {
    for (let i = 0; i < Number(m[1]); i++) resultados.push({ capa: capaPorDefecto, escenario: "--", estado: "PASS", caso: r.nombre });
    for (let i = 0; i < Number(m[2]); i++) resultados.push({ capa: capaPorDefecto, escenario: "--", estado: "FAIL", caso: r.nombre });
  }
  if (r.codigo !== 0 && !resultados.some((x) => x.capa === capaPorDefecto && x.estado === "FAIL")) {
    const err = (r.errores || r.salida).split("\n").filter((x) => x.trim() && !x.includes("claude-code-hint"));
    resultados.push({ capa: capaPorDefecto, escenario: "--", estado: "FAIL", caso: `${r.nombre} terminó con código ${r.codigo}: ${(err.find((x) => /Error/.test(x)) ?? err[0] ?? "").slice(0, 160)}` });
  }
  capas.push({ nombre: r.nombre, segundos: r.segundos, codigo: r.codigo });
}

const inicio = Date.now();
console.log(`Batería billing + lifecycle — modo ${MODO}\n`);

async function staging() {
  const p = permitido("GF_BILLING_E2E_STAGING", "staging");
  if (!p.ok) return void resultados.push({ capa: "C-staging", escenario: "--", estado: "SKIP", caso: `staging no ejecutado (${p.motivo})` });
  absorber(await correr("C · staging (escrituras sintéticas revertidas)", "bash", ["tests/billing/staging/run-staging.sh"]), "C-staging");
}
async function stripeTest() {
  const p = permitido("GF_BILLING_STRIPE_TEST", "stripe-test");
  if (!p.ok) return void resultados.push({ capa: "S", escenario: "--", estado: "SKIP", caso: `Stripe TEST no ejecutado (${p.motivo})` });
  absorber(await correr("S · Stripe TEST (test clocks + webhooks reales)", "npx", ["-y", "tsx", "apps/admin/lib/__tests__/billing-stripe-integracion.test.ts"]), "S");
}

if (SOLO_STAGING) await staging();
else if (SOLO_STRIPE) await stripeTest();
else {
  // A — pura + suites de billing existentes
  absorber(await correr("A · billing-bateria.test.ts", "npx", ["-y", "tsx", "apps/admin/lib/__tests__/billing-bateria.test.ts"], envLimpio), "A");
  for (const f of ["billing-checkout", "billing-webhook", "billing-acceso", "billing-config", "suscripcion-situacion", "acceso-trial", "prueba-argentina"]) {
    absorber(await correr(`A · ${f}.test.ts (existente)`, "npx", ["-y", "tsx", `apps/admin/lib/__tests__/${f}.test.ts`], envLimpio), "A-existentes");
  }
  // B — base local
  absorber(await correr("B · paquete SQL (base local, revertido)", "bash", ["tests/billing/db/run-local.sh"]), "B");
  if (E2E) {
    absorber(await correr("C · pila local (pipeline + HTTP + Playwright)", "node", ["tests/billing/e2e/run-local.mjs"]), "C-local");
    absorber(await correr("C · recorrido de prueba gratuita (Auth real + landing + Admin + Guard, desktop y móvil)", "node", ["tests/recorrido/run-local.mjs"]), "C-prueba");
    absorber(await correr("B2 · compatibilidad del despliegue (RPC por PostgREST, código anterior)", "node", ["tests/billing/compat/rpc-postgrest.mjs"]), "B2-compat");
    await staging();
    await stripeTest();
  }
}
// Capas exigidas: si una no ejecutó ninguna prueba (0 PASS), no hay verde.
// Los SKIP parciales dentro de una capa que sí corrió se mantienen como SKIP.
for (const capa of EXIGIDAS) {
  const deCapa = resultados.filter((r) => r.capa === capa);
  if (deCapa.some((r) => r.estado === "PASS")) continue;
  if (!deCapa.length) resultados.push({ capa, escenario: "--", estado: "FAIL", caso: "capa exigida sin resultados" });
  for (const r of deCapa) {
    if (r.estado === "SKIP") {
      r.estado = "FAIL";
      r.caso = `capa exigida omitida: ${r.caso}`;
    }
  }
}

// ── Resumen ──
const cuenta = (filtro) => resultados.filter(filtro).length;
const ancho = Math.max(...Object.values(ESCENARIOS).map((s) => s.length));
console.log("Escenario".padEnd(ancho + 5) + "PASS  FAIL  SKIP  PEND  capas");
for (const [id, nombre] of Object.entries(ESCENARIOS).sort(([a], [b]) => a.localeCompare(b))) {
  const de = (e) => resultados.filter((r) => r.escenario === id && r.estado === e).length;
  const enCapas = [...new Set(resultados.filter((r) => r.escenario === id).map((r) => r.capa))].join(",") || "—";
  const veredicto = de("FAIL") ? "FAIL" : de("PENDIENTE") ? "PASS*" : de("PASS") ? "PASS" : "—";
  console.log(`${id} ${nombre}`.padEnd(ancho + 5) + `${String(de("PASS")).padStart(4)}  ${String(de("FAIL")).padStart(4)}  ${String(de("SKIP")).padStart(4)}  ${String(de("PENDIENTE")).padStart(4)}  ${enCapas}  ${veredicto}`);
}
const sinEscenario = resultados.filter((r) => !ESCENARIOS[r.escenario] && r.estado !== "SKIP");
if (sinEscenario.length) console.log(`-- generales/suites existentes`.padEnd(ancho + 5) + `${String(cuenta((r) => !ESCENARIOS[r.escenario] && r.estado === "PASS")).padStart(4)}  ${String(cuenta((r) => !ESCENARIOS[r.escenario] && r.estado === "FAIL")).padStart(4)}  ${String(cuenta((r) => !ESCENARIOS[r.escenario] && r.estado === "SKIP")).padStart(4)}`);

if (!resultados.some((r) => r.estado === "PASS")) resultados.push({ capa: "--", escenario: "--", estado: "FAIL", caso: "no se ejecutó ninguna prueba (0 PASS)" });
const fallos = resultados.filter((r) => r.estado === "FAIL");
if (fallos.length) {
  console.log("\nFallos:");
  for (const f of fallos) console.log(`  ✗ [${f.capa} ${f.escenario}] ${f.caso}`);
}
const pendientes = resultados.filter((r) => r.estado === "PENDIENTE");
const pendientesBloquean = EXIGIDAS.size > 0 && pendientes.length > 0;
if (pendientes.length) {
  console.log(pendientesBloquean
    ? "\nPendientes (en CI cuentan como FAIL: GF_BILLING_EXIGIR):"
    : "\nPendientes conocidos (comportamiento esperado que hoy no se cumple; no cuentan como FAIL):");
  for (const p of pendientes) console.log(`  * [${p.capa} ${p.escenario}] ${p.caso}`);
}
const omitidos = resultados.filter((r) => r.estado === "SKIP");
if (omitidos.length) {
  console.log("\nOmitidos:");
  for (const s of omitidos) console.log(`  – [${s.capa}] ${s.caso}`);
}
console.log("\nFixtures:");
if (!fixtures.length) console.log("  (ninguna capa con fixtures corrió)");
let residuos = 0;
for (const f of fixtures) {
  const [, capa, run, creados, eliminados, res] = f.split("|");
  residuos += Number(res.split("=")[1]);
  console.log(`  ${capa.padEnd(10)} ${creados.padEnd(14)} ${eliminados.padEnd(16)} ${res.padEnd(12)} ${run}`);
}
console.log("\nCapas:");
for (const c of capas) console.log(`  ${c.codigo === 0 ? "✓" : "✗"} ${c.nombre} (${c.segundos}s)`);
const total = resultados.length;
console.log(`\nTOTAL=${total}  PASS=${cuenta((r) => r.estado === "PASS")}  FAIL=${fallos.length}  SKIPPED=${omitidos.length}  PENDIENTES=${pendientes.length}  RESIDUOS=${residuos}  DURACION=${Math.round((Date.now() - inicio) / 1000)}s`);
const falla = fallos.length > 0 || residuos > 0 || pendientesBloquean;
console.log(falla ? "RESULTADO: FAIL" : pendientes.length ? `RESULTADO: PASS con ${pendientes.length} pendiente(s) conocido(s)` : "RESULTADO: PASS");
process.exit(falla ? 1 : 0);
