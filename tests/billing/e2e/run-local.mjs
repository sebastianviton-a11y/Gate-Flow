#!/usr/bin/env node
// ============================================================
// Batería billing — capa C LOCAL (sin red externa, sin Stripe, sin staging):
//   Postgres local gf_billing_e2e (todas las migraciones)
//   + PostgREST local + gateway (gateway.mjs: /rest/v1 y /auth/v1/user)
//   + Admin y Guard REALES (next build + next start) con Stripe bloqueado
//     (sin-red-stripe.cjs)
//   + pipeline webhook → base (billing-bateria-pipeline.test.ts)
//   + HTTP (firma, configuración inválida, rutas sin sesión)
//   + Playwright (redirecciones, planes, CTA, bloqueo/desbloqueo).
// Fixtures confirmados SOLO en la base local, marcados ZZ_AUTOTEST_ y
// borrados con el teardown por ids (tests/billing/e2e/teardown.sql).
//
// Requisitos (si faltan → SKIP, nunca PASS):
//   psql + Postgres local (PGHOST/PGPORT/PGUSER)
//   GF_POSTGREST_BIN o `postgrest` en el PATH
//   playwright-core (GF_PLAYWRIGHT_CORE_DIR = carpeta con node_modules)
//   Chromium (GF_CHROMIUM o el navegador de Playwright)
// Salida: RESULT|C-local|… y FIXTURES|C-local|… para tests/billing/run.mjs.
// ============================================================
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cookieSesion, firmarJwt, iniciarGateway } from "./gateway.mjs";

const CAPA = "C-local";
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");
const DB = process.env.GF_BILLING_E2E_DB ?? "gf_billing_e2e";
const P = { postgrest: 3921, gateway: 3922, admin: 3923, guard: 3924, adminMalConfig: 3925 };
const URL_SUPABASE = `http://localhost:${P.gateway}`;
const URL_ADMIN = `http://localhost:${P.admin}`;
const URL_GUARD = `http://localhost:${P.guard}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gf-billing-e2e-"));

let fallas = 0;
function res(e, estado, texto) {
  if (estado === "FAIL") fallas++;
  console.log(`RESULT|${CAPA}|${e}|${estado}|${String(texto).replace(/[|\n]/g, " ")}`);
}
const ok = (e, cond, texto, detalle = "") => res(e, cond ? "PASS" : "FAIL", cond ? texto : `${texto} — ${detalle}`);

// ── Salvaguardas: solo local ──
if (!/^gf_billing_/.test(DB)) {
  res("--", "FAIL", "GF_BILLING_E2E_DB debe llamarse gf_billing_*");
  process.exit(1);
}
for (const v of [process.env.PGHOST, process.env.DATABASE_URL, process.env.PGDATABASE]) {
  if (/supabase|pooler/.test(v ?? "")) {
    res("--", "FAIL", "rechazado: el entorno apunta a Supabase; la capa C local es solo local");
    process.exit(1);
  }
}
if (process.env.PGHOST && !/^(\/|localhost$|127\.0\.0\.1$)/.test(process.env.PGHOST)) {
  res("--", "FAIL", "rechazado: PGHOST no es local");
  process.exit(1);
}

// ── Requisitos ──
const quien = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
const PGRST = process.env.GF_POSTGREST_BIN || quien("postgrest");
if (!quien("psql") || spawnSync("psql", ["-X", "-At", "-d", "postgres", "-c", "select 1"]).status !== 0) {
  res("--", "SKIP", "capa C local omitida: no hay Postgres local accesible (PGHOST/PGPORT/PGUSER)");
  process.exit(0);
}
if (!PGRST || !fs.existsSync(PGRST)) {
  res("--", "SKIP", "capa C local omitida: falta PostgREST (GF_POSTGREST_BIN)");
  process.exit(0);
}
let playwright = null;
try {
  const base = process.env.GF_PLAYWRIGHT_CORE_DIR ? path.resolve(process.env.GF_PLAYWRIGHT_CORE_DIR) : RAIZ;
  playwright = createRequire(path.join(base, "noop.js"))("playwright-core");
} catch {
  playwright = null;
}

// ── Procesos y limpieza ──
const procesos = [];
const generados = ["apps/admin/next-env.d.ts", "apps/guard/next-env.d.ts"].filter((f) => !fs.existsSync(path.join(RAIZ, f)));
let gateway = null;
function detener() {
  for (const p of procesos) {
    try {
      process.kill(-p.pid, "SIGTERM");
    } catch {
      /* ya terminó */
    }
  }
  procesos.length = 0;
  gateway?.close();
  gateway = null;
  for (const f of generados) fs.rmSync(path.join(RAIZ, f), { force: true });
}
process.on("exit", detener);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => process.exit(130));

function iniciar(nombre, comando, args, opciones) {
  const log = fs.openSync(path.join(TMP, `${nombre}.log`), "a");
  const p = spawn(comando, args, { ...opciones, stdio: ["ignore", log, log], detached: true });
  procesos.push(p);
  return p;
}
/** spawn asíncrono con límite de tiempo: { status, signal, stdout, stderr }. */
function ejecutar(comando, args, opciones, ms) {
  return new Promise((resolve) => {
    const p = spawn(comando, args, { ...opciones, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const t = setTimeout(() => p.kill("SIGTERM"), ms);
    p.on("close", (status, signal) => {
      clearTimeout(t);
      resolve({ status, signal, stdout, stderr });
    });
  });
}
async function esperar(url, ms = 60_000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return true;
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const sql = (q) => execFileSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", q], { encoding: "utf8" }).trim();
const leerLog = (nombre) => {
  try {
    return fs.readFileSync(path.join(TMP, `${nombre}.log`), "utf8");
  } catch {
    return "";
  }
};
const HASH_TODO = `select md5(concat_ws('#',
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.tenants t),
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.suscripciones t),
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.user_tenants t),
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.users t),
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.empresas t),
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.unidades t),
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.billing_checkouts t),
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.billing_eventos t),
  (select count(*)::text from public.audit_log), (select count(*)::text from auth.users)))`;

async function main() {
  const inicio = Date.now();
  // 1. Base y PostgREST
  execFileSync("bash", [path.join(RAIZ, "tests/billing/db/construir-base.sh"), DB], { stdio: ["ignore", "ignore", "inherit"] });
  const secreto = crypto.randomBytes(32).toString("hex");
  const claveDb = crypto.randomBytes(16).toString("hex");
  sql(`alter role authenticator password '${claveDb}'`);
  iniciar("postgrest", PGRST, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator:${claveDb}@127.0.0.1:${process.env.PGPORT ?? 5432}/${DB}`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: secreto,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(P.postgrest),
      PGRST_LOG_LEVEL: "crit",
    },
  });
  if (!(await esperar(`http://127.0.0.1:${P.postgrest}/`, 20_000))) {
    res("--", "FAIL", "PostgREST local no arrancó");
    return;
  }
  gateway = await iniciarGateway({ puerto: P.gateway, postgrest: `http://127.0.0.1:${P.postgrest}`, secreto });
  const anon = firmarJwt({ role: "anon", iss: "gf-autotest" }, secreto);
  const servicio = firmarJwt({ role: "service_role", iss: "gf-autotest" }, secreto);

  // 2. Fixtures confirmados (locales)
  const hashAntes = sql(HASH_TODO);
  const run = `ZZ_AUTOTEST_${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}_${crypto.randomBytes(3).toString("hex")}`;
  const fix = JSON.parse(execFileSync("psql", ["-X", "-q", "-At", "-d", DB, "-v", `run=${run}`, "-f", path.join(AQUI, "fixtures.sql")], { encoding: "utf8" }).trim());
  const T = fix.tenant;
  const U = fix.usuario;
  const eventos = [];
  const email = (k) => `zz_autotest+${run.toLowerCase()}-${k}@gateflow.invalid`;

  try {
    // 3. Pipeline webhook → base (B2)
    // Asíncrono: el gateway vive en este proceso y spawnSync lo bloquearía.
    const pipe = await ejecutar("npx", ["-y", "tsx", "apps/admin/lib/__tests__/billing-bateria-pipeline.test.ts"], {
      cwd: RAIZ,
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${path.join(AQUI, "server-only-shim.cjs")}`.trim(),
        GF_BILLING_PIPELINE: "1",
        GF_BILLING_DB: DB,
        GF_BILLING_REGISTRO: JSON.stringify(fix),
        NEXT_PUBLIC_SUPABASE_URL: URL_SUPABASE,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
        SUPABASE_SERVICE_ROLE_KEY: servicio,
      },
    }, 180_000);
    for (const linea of (pipe.stdout ?? "").split("\n")) {
      if (linea.startsWith("RESULT|")) {
        console.log(linea);
        if (linea.includes("|FAIL|")) fallas++;
      }
      if (linea.startsWith("EVENTOS|")) eventos.push(...linea.slice(8).split(",").filter(Boolean));
    }
    if (pipe.status !== 0 && !(pipe.stdout ?? "").includes("|FAIL|")) {
      const err = (pipe.stderr ?? "").split("\n").filter((l) => l.trim() && !l.includes("claude-code-hint"));
      const clave = err.find((l) => /Error|error:/.test(l)) ?? err[0] ?? "";
      res("--", "FAIL", `pipeline terminó con error (status ${pipe.status}${pipe.signal ? `, ${pipe.signal}` : ""}): ${clave.slice(0, 200)}`);
    }

    // 4. Builds de Admin y Guard contra la pila local
    const envPublico = {
      NEXT_PUBLIC_SUPABASE_URL: URL_SUPABASE,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
      NEXT_PUBLIC_ADMIN_APP_URL: URL_ADMIN,
      NEXT_PUBLIC_GUARD_APP_URL: URL_GUARD,
      NEXT_TELEMETRY_DISABLED: "1",
    };
    for (const app of ["admin", "guard"]) {
      const b = spawnSync("npx", ["next", "build"], { cwd: path.join(RAIZ, "apps", app), env: { ...process.env, ...envPublico }, encoding: "utf8", timeout: 600_000 });
      if (b.status !== 0) {
        res("--", "FAIL", `next build de ${app} falló: ${(b.stderr || b.stdout || "").split("\n").filter(Boolean).slice(-3).join(" ")}`);
        return;
      }
    }
    const bloqueos = path.join(TMP, "stripe-bloqueos.txt");
    const envServidor = {
      ...process.env,
      ...envPublico,
      SUPABASE_SERVICE_ROLE_KEY: servicio,
      STRIPE_SECRET_KEY: "sk_test_" + "ZZAUTOTEST".repeat(3),
      STRIPE_WEBHOOK_SECRET: "whsec_test_" + crypto.randomBytes(12).toString("hex"),
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_test_ZZAUTOTEST",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${path.join(AQUI, "sin-red-stripe.cjs")}`.trim(),
      GF_STRIPE_BLOQUEOS: bloqueos,
    };
    delete envServidor.STRIPE_PERMITIR_LIVE;
    const claveLive = "sk_live_" + "Q".repeat(30);
    iniciar("admin", "npx", ["next", "start", "-p", String(P.admin)], { cwd: path.join(RAIZ, "apps/admin"), env: envServidor });
    iniciar("guard", "npx", ["next", "start", "-p", String(P.guard)], { cwd: path.join(RAIZ, "apps/guard"), env: envServidor });
    iniciar("admin-malconfig", "npx", ["next", "start", "-p", String(P.adminMalConfig)], {
      cwd: path.join(RAIZ, "apps/admin"),
      env: { ...envServidor, STRIPE_SECRET_KEY: claveLive, STRIPE_PERMITIR_LIVE: "true" },
    });
    for (const u of [`${URL_ADMIN}/login`, `${URL_GUARD}/login`, `http://localhost:${P.adminMalConfig}/login`]) {
      if (!(await esperar(u, 60_000))) {
        res("--", "FAIL", `no arrancó ${u}`);
        return;
      }
    }

    // 5. HTTP
    const firmaFalsa = `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`;
    const cuerpo = JSON.stringify({ id: `evt_${run}_http`, type: "checkout.session.completed", data: { object: { id: `cs_test_${run}_x` } } });
    const eventosAntes = sql("select count(*) from public.billing_eventos");
    let r = await fetch(`${URL_ADMIN}/api/billing/webhook/stripe`, { method: "POST", headers: { "stripe-signature": firmaFalsa }, body: cuerpo });
    ok("14", r.status === 401, "HTTP: webhook con firma inválida → 401", `status ${r.status}`);
    r = await fetch(`${URL_ADMIN}/api/billing/webhook/stripe`, { method: "POST", body: cuerpo });
    ok("14", r.status === 401, "HTTP: webhook sin cabecera de firma → 401", `status ${r.status}`);
    ok("14", sql("select count(*) from public.billing_eventos") === eventosAntes, "HTTP: firmas inválidas → 0 escrituras");
    r = await fetch(`http://localhost:${P.adminMalConfig}/api/billing/webhook/stripe`, { method: "POST", headers: { "stripe-signature": firmaFalsa }, body: cuerpo });
    ok("15", r.status === 503, "HTTP: clave live en un host no productivo → webhook 503 (falla cerrado)", `status ${r.status}`);
    const logMal = leerLog("admin-malconfig");
    ok("15", /live_en_staging/.test(logMal) && !logMal.includes("QQQQ") && !/sk_live_|whsec_/.test(logMal), "log del servidor: solo el motivo, ningún secreto");
    for (const ruta of ["/dashboard", "/suscripcion"]) {
      r = await fetch(`${URL_ADMIN}${ruta}`, { redirect: "manual" });
      ok("17", [302, 307].includes(r.status) && (r.headers.get("location") ?? "").includes("/login"), `HTTP: Admin ${ruta} sin sesión → /login`, `${r.status} ${r.headers.get("location")}`);
    }

    // 6. Playwright
    if (!playwright) {
      res("--", "SKIP", "flujos de navegador omitidos: falta playwright-core (GF_PLAYWRIGHT_CORE_DIR)");
    } else {
      let navegador;
      try {
        navegador = await playwright.chromium.launch({ ...(process.env.GF_CHROMIUM ? { executablePath: process.env.GF_CHROMIUM } : {}), args: ["--no-sandbox"] });
      } catch (e) {
        res("--", "SKIP", `flujos de navegador omitidos: Chromium no disponible (${String(e).split("\n")[0].slice(0, 120)})`);
      }
      if (navegador) {
        try {
          await flujos(navegador, { run, T, U, email, secreto, eventos, bloqueos });
        } finally {
          await navegador.close();
        }
      }
    }
  } finally {
    // 7. Teardown por ids registrados (siempre, también si algo falló)
    const registro = { ...fix.registro, eventos };
    const t = spawnSync("psql", ["-X", "-q", "-At", "-d", DB, "-v", `run=${run}`, "-v", `reg=${JSON.stringify(registro)}`, "-f", path.join(AQUI, "teardown.sql")], { encoding: "utf8" });
    const linea = (p) => JSON.parse(((t.stdout ?? "").split("\n").find((l) => l.startsWith(p)) ?? `${p}null`).slice(p.length));
    const suma = (o) => Object.values(o ?? {}).reduce((a, b) => a + Number(b), 0);
    const creados = linea("CREADOS|");
    const residuos = linea("RESIDUOS|");
    const sueltos = Number(sql(`select count(*) from public.billing_eventos where left(provider_event_id, ${`evt_${run}`.length}) = 'evt_${run}'`) || 0);
    ok("20", t.status === 0 && residuos !== null && suma(residuos) === 0 && sueltos === 0, "teardown local por ids: 0 residuos", (t.stderr ?? "").split("\n")[0] || JSON.stringify(residuos));
    ok("20", sql(HASH_TODO) === hashAntes, "base local idéntica a antes de los fixtures (hash)");
    console.log(`FIXTURES|${CAPA}|run=${run}|creados=${suma(creados)}|eliminados=${suma(creados) - suma(residuos)}|residuos=${suma(residuos) + sueltos}`);
    detener();
    spawnSync("dropdb", ["--if-exists", DB]);
    console.log(`DURACION|${CAPA}|${Math.round((Date.now() - inicio) / 1000)}s`);
  }
}

// ── Flujos de navegador ──
async function flujos(navegador, { run, T, U, email, secreto, eventos, bloqueos }) {
  let n = 0;
  // impago: expresión SQL del inicio del impago (solo past_due), como la
  // normaliza el servidor desde current_period_start; null = sin fecha.
  const evento = (tenantKey, tipo, estado, cpe, cancel, cs, ref, sub, impago = "null", estadoProveedor = estado) => {
    const id = `evt_${run}_C${++n}`;
    eventos.push(id);
    return JSON.parse(
      sql(`select public.billing_aplicar_evento('stripe', '${id}', '${tipo}', '${estado}', ${cs ? `'${cs}'` : "null"}, ${ref ? `'${ref}'` : "null"},
        '${sub}', 'cus_${run}_${tenantKey}', ${cpe}, ${cancel}, clock_timestamp(), 'MXN', 49900, 'month', ${impago}, '${estadoProveedor}')`),
    );
  };
  const fechaMx = (ms, conAnio) =>
    new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "long", ...(conAnio ? { year: "numeric" } : {}) }).format(new Date(ms));
  const contexto = async (usuario, gfTenant) => {
    const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const { nombre, valor } = cookieSesion({ urlSupabase: URL_SUPABASE, secreto, userId: U[usuario], email: email(usuario) });
    const cookies = [{ name: nombre, value: valor, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }];
    if (gfTenant) cookies.push({ name: "gf_tenant", value: gfTenant, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" });
    await ctx.addCookies(cookies);
    return ctx;
  };
  const visitar = async (usuario, url, gfTenant) => {
    const ctx = await contexto(usuario, gfTenant);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    return { ctx, page, ruta: new URL(page.url()).pathname, origen: new URL(page.url()).origin };
  };
  const texto = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

  // 02 · trial vencido: Admin → /suscripcion; Guard → /servicio-inactivo
  let v = await visitar("admin_venc", `${URL_ADMIN}/dashboard`);
  let t = await texto(v.page);
  ok("02", v.ruta === "/suscripcion", "Playwright: admin con trial vencido → /suscripcion", v.ruta);
  ok("02", t.includes("Tu prueba gratuita de 30 días terminó"), "Playwright: /suscripcion muestra el vencimiento del trial");
  const cta50 = v.page.locator('[data-plan="hasta-50"] button:has-text("Activar plan")');
  ok("03", (await cta50.count()) === 1 && (await cta50.isEnabled()), "Playwright: CTA 'Activar plan' habilitado (40 viviendas, hasta-50)");
  // 03 · CTA → server action → checkout en la base; Stripe bloqueado → aviso de error, sin activar
  await Promise.all([v.page.waitForURL(/\/suscripcion\?error=/, { timeout: 90_000 }).catch(() => null), cta50.click()]);
  t = await texto(v.page);
  const checkouts = sql(`select concat_ws('/', count(*), min(plan), min(monto), min(moneda), min(estado)) from public.billing_checkouts where tenant_id = '${T.VENC}'`);
  ok("03", checkouts === "1/hasta-50/49900/MXN/created", "Playwright: clic en 'Activar plan' → exactamente 1 billing_checkout (hasta-50, 49900 MXN)", checkouts);
  ok("03", fs.existsSync(bloqueos) && /stripe\.com/.test(fs.readFileSync(bloqueos, "utf8")), "el servidor llegó al proveedor (salida a Stripe bloqueada en la prueba)");
  ok("03", v.page.url().includes("error=proveedor") && t.includes("No pudimos abrir el pago"), "proveedor caído → aviso claro, sin pantalla de error", v.page.url());
  ok("03", sql(`select estado from public.suscripciones where tenant_id = '${T.VENC}'`) === "trialing", "sin activación antes del webhook");
  await v.ctx.close();

  v = await visitar("guard_venc", `${URL_GUARD}/guard`);
  ok("02", v.ruta === "/servicio-inactivo", "Playwright: guardia con trial vencido → Guard /servicio-inactivo", v.ruta);
  ok("02", (await texto(v.page)).includes("El servicio de este residencial no está activo"), "Guard muestra servicio inactivo (sin datos comerciales)");
  await v.ctx.close();
  v = await visitar("guard_venc", `${URL_ADMIN}/dashboard`);
  ok("17", v.origen === URL_GUARD, "Playwright: guardia que abre Admin → app Guard", v.origen + v.ruta);
  await v.ctx.close();

  // 16 · plan deshabilitado (60 viviendas)
  v = await visitar("admin_grande", `${URL_ADMIN}/suscripcion`);
  const tarjeta50 = v.page.locator('[data-plan="hasta-50"]');
  ok("16", (await tarjeta50.innerText()).includes("Tu residencial supera este plan.") && (await tarjeta50.locator("button").isDisabled()), "Playwright: 60 viviendas → hasta-50 deshabilitado con motivo");
  ok("16", await v.page.locator('[data-plan="hasta-150"] button:has-text("Activar plan")').isEnabled(), "Playwright: 60 viviendas → hasta-150 habilitado");
  await v.ctx.close();

  // 04 · webhook (RPC real) → active → Admin dashboard y Guard desbloqueado
  const chk = sql(`select id from public.billing_checkouts where tenant_id = '${T.VENC}'`);
  sql(`select public.billing_registrar_checkout_proveedor('${chk}', 'cs_test_${run}_C')`);
  const cs = `cs_test_${run}_C`;
  const subV = `sub_${run}_VENC`;
  let e = evento("VENC", "checkout.session.completed", "active", "now() + interval '30 days'", false, cs, chk, subV);
  ok("04", e.resultado === "aplicado", "evento de checkout completado aplicado (RPC real)", JSON.stringify(e));
  v = await visitar("admin_venc", `${URL_ADMIN}/dashboard`);
  ok("04", v.ruta === "/dashboard", "Playwright: tras el webhook, admin → dashboard", v.ruta);
  await v.ctx.close();
  v = await visitar("guard_venc", `${URL_GUARD}/guard`);
  ok("04", v.ruta === "/guard", "Playwright: tras el webhook, Guard desbloqueado", v.ruta);
  await v.ctx.close();

  // 09 · past_due en gracia: opera + aviso de pago (Admin), Guard opera
  // Como Stripe en una renovación fallida: el periodo ya se adelantó (fin
  // en +27 días) y el impago empezó hace 3 días.
  evento("VENC", "invoice.payment_failed", "past_due", "now() + interval '27 days'", false, cs, chk, subV, "now() - interval '3 days'");
  const finGracia = Date.parse(sql(`select to_char((impago_desde + interval '7 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.suscripciones where tenant_id = '${T.VENC}'`));
  const finPeriodo = Date.parse(sql(`select to_char(current_period_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.suscripciones where tenant_id = '${T.VENC}'`));
  v = await visitar("admin_venc", `${URL_ADMIN}/dashboard`);
  t = await texto(v.page);
  ok("09", v.ruta === "/dashboard" && t.includes("No pudimos cobrar tu suscripción"), "Playwright: past_due día 3 (periodo futuro) → dashboard con aviso de pago", v.ruta);
  ok("10", t.includes(`antes del ${fechaMx(finGracia)}`) && !t.includes(`antes del ${fechaMx(finPeriodo + 7 * 86_400_000)}`),
    "Playwright: el aviso fecha el fin de la gracia en inicio del impago + 7 días (no fin de periodo + 7)", `${fechaMx(finGracia)}`);
  await v.ctx.close();
  v = await visitar("admin_venc", `${URL_ADMIN}/suscripcion`);
  t = await texto(v.page);
  ok("10", t.includes(`hasta el ${fechaMx(finGracia, true)}`), "Playwright: /suscripcion muestra 'sigue funcionando hasta' el fin de la gracia", v.ruta);
  await v.ctx.close();
  v = await visitar("guard_venc", `${URL_GUARD}/guard`);
  ok("09", v.ruta === "/guard", "Playwright: past_due en gracia → Guard opera", v.ruta);
  await v.ctx.close();

  // 10 · fuera de la gracia: bloqueado; /suscripcion pide actualizar método de pago
  // El paso del tiempo se simula moviendo el inicio del episodio a hace 8
  // días (el reloj no se toca); luego un reintento fallido con una fecha
  // nueva NO debe reabrir la gracia.
  sql(`update public.suscripciones set impago_desde = now() - interval '8 days' where tenant_id = '${T.VENC}'`);
  evento("VENC", "customer.subscription.updated", "past_due", "now() + interval '22 days'", false, cs, chk, subV, "now() - interval '1 hour'");
  ok("10", sql(`select (impago_desde < now() - interval '7 days')::text from public.suscripciones where tenant_id = '${T.VENC}'`) === "true", "reintento fallido con la gracia agotada: el inicio del impago no se mueve");
  v = await visitar("admin_venc", `${URL_ADMIN}/dashboard`);
  t = await texto(v.page);
  ok("10", v.ruta === "/suscripcion" && t.includes("Actualizar método de pago") && (await v.page.locator('[data-plan="hasta-50"]').count()) === 0, "Playwright: past_due día 8 → /suscripcion con 'Actualizar método de pago' (sin planes)", v.ruta);
  await v.ctx.close();
  v = await visitar("guard_venc", `${URL_GUARD}/guard`);
  ok("10", v.ruta === "/servicio-inactivo", "Playwright: past_due día 8 → Guard bloqueado", v.ruta);
  await v.ctx.close();

  // 11 · pago recuperado
  evento("VENC", "invoice.paid", "active", "now() + interval '30 days'", false, cs, chk, subV);
  v = await visitar("guard_venc", `${URL_GUARD}/guard`);
  ok("11", v.ruta === "/guard", "Playwright: invoice.paid → Guard desbloqueado", v.ruta);
  await v.ctx.close();

  // 08 · cancelación cumplida (sin webhook de borrado): bloqueado
  evento("VENC", "customer.subscription.updated", "active", "now() - interval '1 second'", true, cs, chk, subV);
  v = await visitar("admin_venc", `${URL_ADMIN}/dashboard`);
  ok("08", v.ruta === "/suscripcion", "Playwright: cancel_at_period_end cumplido → Admin /suscripcion", v.ruta);
  await v.ctx.close();
  v = await visitar("guard_venc", `${URL_GUARD}/guard`);
  ok("08", v.ruta === "/servicio-inactivo", "Playwright: cancel_at_period_end cumplido → Guard bloqueado", v.ruta);
  await v.ctx.close();

  // 12 · deleted → canceled; vuelve a ofrecer planes
  e = evento("VENC", "customer.subscription.deleted", "canceled", "now() + interval '30 days'", false, cs, chk, subV);
  v = await visitar("admin_venc", `${URL_ADMIN}/dashboard`);
  t = await texto(v.page);
  ok("12", e.resultado === "aplicado" && v.ruta === "/suscripcion" && t.includes("Tu suscripción no está activa") && (await v.page.locator('[data-plan="hasta-50"]').count()) === 1, "Playwright: canceled → /suscripcion con planes de nuevo", v.ruta);
  await v.ctx.close();

  // 01 · activo sin cambios: dashboard; /suscripcion muestra la gestión
  v = await visitar("admin_activo", `${URL_ADMIN}/dashboard`);
  ok("01", v.ruta === "/dashboard", "Playwright: suscripción activa → dashboard", v.ruta);
  await v.page.goto(`${URL_ADMIN}/suscripcion`, { waitUntil: "domcontentloaded" });
  ok("01", (await v.page.locator('[data-gestion="proveedor"]').count()) === 1 && (await v.page.locator('[data-plan="hasta-50"]').count()) === 0, "Playwright: activa → /suscripcion muestra la gestión, no planes");
  await v.ctx.close();

  // 18 · multitenant: gf_tenant revalidado
  v = await visitar("multi", `${URL_ADMIN}/dashboard`);
  ok("18", v.ruta === "/seleccionar-residencial", "Playwright: 2 residenciales sin gf_tenant → elegir residencial", v.ruta);
  await v.ctx.close();
  v = await visitar("multi", `${URL_ADMIN}/dashboard`, T.ACTIVO);
  ok("18", v.ruta === "/dashboard", "Playwright: gf_tenant = residencial activo → dashboard", v.ruta);
  await v.ctx.close();
  v = await visitar("multi", `${URL_ADMIN}/dashboard`, T.GRANDE);
  ok("18", v.ruta === "/suscripcion", "Playwright: gf_tenant = residencial vencido → /suscripcion de ESE residencial", v.ruta);
  await v.ctx.close();
  v = await visitar("multi", `${URL_ADMIN}/dashboard`, T.VENC);
  const cookies = await v.ctx.cookies(URL_ADMIN);
  ok("18", v.ruta === "/seleccionar-residencial" && !cookies.some((c) => c.name === "gf_tenant" && c.value === T.VENC), "Playwright: gf_tenant de un residencial ajeno → falla cerrado y se borra", v.ruta);
  await v.ctx.close();
}

main()
  .catch((e) => res("--", "FAIL", `error inesperado: ${String(e?.stack ?? e).split("\n").slice(0, 2).join(" ")}`))
  .finally(() => {
    detener();
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(fallas ? 1 : 0);
  });
