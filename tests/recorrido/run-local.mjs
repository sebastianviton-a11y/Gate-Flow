#!/usr/bin/env node
// ============================================================
// Recorrido de PRUEBA GRATUITA (Argentina) de punta a punta, LOCAL y con
// datos sintéticos, en navegador desktop y móvil:
//   landing V2 → "Probar gratis" → /registro (país Argentina) → correo de
//   confirmación → /confirmar-cuenta → onboarding (residentes, guardia,
//   bodega) → panel con 30 días de prueba → el guardia acepta la
//   invitación y opera en Guard (WhatsApp con +54 9) → la prueba vence:
//   bloqueo sin contratación falsa, información conservada.
// Stripe configurado como en staging (claves ficticias; la salida a
// stripe.com está bloqueada y se registra): Argentina no puede contratar
// ni desde la interfaz ni llamando a la server action del checkout.
//
// Pila: Postgres local (gf_recorrido_e2e) con el Auth REAL de Supabase
// (GoTrue compilado localmente: GF_GOTRUE_BIN + GF_GOTRUE_MIGRACIONES)
// + PostgREST + gateway + buzón SMTP local (solo @gateflow.invalid; nada
// sale de la máquina) + Admin, Guard y la landing (apps/web del repo, o
// GF_LANDING_DIR) compilados (next build/start). Fixtures con marca ZZ_AUTOTEST_ y
// borrados por ids; la base se elimina al final.
// Salida: RESULT|C-prueba|<esc>|PASS/FAIL/SKIP|caso.
// ============================================================
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firmarJwt, iniciarGateway } from "../billing/e2e/gateway.mjs";
import { enlaces, iniciarSmtpLocal } from "./smtp-local.mjs";

const CAPA = "C-prueba";
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const DB = process.env.GF_RECORRIDO_DB ?? "gf_recorrido_e2e";
const P = { postgrest: 3961, gateway: 3962, admin: 3963, guard: 3964, web: 3965, auth: 3966, smtp: 3967 };
const URL_SUPABASE = `http://localhost:${P.gateway}`;
const URL_ADMIN = `http://localhost:${P.admin}`;
const URL_GUARD = `http://localhost:${P.guard}`;
const URL_WEB = `http://localhost:${P.web}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gf-recorrido-"));
const BLOQUEOS_STRIPE = path.join(TMP, "stripe-bloqueos.txt");
const intentosStripe = () => (fs.existsSync(BLOQUEOS_STRIPE) ? fs.readFileSync(BLOQUEOS_STRIPE, "utf8").split("\n").filter(Boolean).length : 0);
/** Id de la server action elegirPlanAction en el build de Admin (para llamarla como lo haría un formulario). */
function idElegirPlan() {
  const pagina = path.join(RAIZ, "apps/admin/.next/server/app/suscripcion/page.js");
  if (!fs.existsSync(pagina)) return null;
  // La clave va entre comillas o no, según el minificador ("01af…" / ce8e…).
  return /[{,]"?([0-9a-f]{40})"?:\(\)=>Promise\.resolve\(\)\.then\([^)]*\)\)\.then\(\w+=>\w+\.elegirPlanAction\)/.exec(fs.readFileSync(pagina, "utf8"))?.[1] ?? null;
}
const LANDING = process.env.GF_LANDING_DIR
  ? path.resolve(process.env.GF_LANDING_DIR)
  : fs.existsSync(path.join(RAIZ, "apps/web/package.json"))
    ? RAIZ
    : null;
// Diagnóstico opcional: capturas (PNG + texto) en puntos clave.
const CAPTURAS = process.env.GF_RECORRIDO_CAPTURAS ? path.resolve(process.env.GF_RECORRIDO_CAPTURAS) : null;
async function captura(page, nombre) {
  if (!CAPTURAS) return;
  fs.mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), fullPage: true }).catch(() => null);
  fs.writeFileSync(path.join(CAPTURAS, `${nombre}.txt`), `${page.url()}\n${await page.locator("body").innerText().catch(() => "")}`);
  fs.writeFileSync(path.join(CAPTURAS, `${nombre}.html`), await page.content().catch(() => ""));
}

let fallas = 0;
function res(e, estado, texto) {
  if (estado === "FAIL") fallas++;
  console.log(`RESULT|${CAPA}|${e}|${estado}|${String(texto).replace(/[|\n]/g, " ")}`);
}
const ok = (e, cond, texto, detalle = "") => res(e, cond ? "PASS" : "FAIL", cond ? texto : `${texto} — ${String(detalle).slice(0, 900)}`);

// ── Salvaguardas: solo local ──
if (!/^gf_recorrido_/.test(DB)) {
  res("--", "FAIL", "GF_RECORRIDO_DB debe llamarse gf_recorrido_*");
  process.exit(1);
}
for (const v of [process.env.PGHOST, process.env.DATABASE_URL, process.env.PGDATABASE]) {
  if (/supabase|pooler/.test(v ?? "")) {
    res("--", "FAIL", "rechazado: el entorno apunta a Supabase; el recorrido es solo local");
    process.exit(1);
  }
}
const quien = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
const PGRST = process.env.GF_POSTGREST_BIN || quien("postgrest");
const GOTRUE = process.env.GF_GOTRUE_BIN;
const GOTRUE_MIG = process.env.GF_GOTRUE_MIGRACIONES;
const faltan = [
  !quien("psql") || spawnSync("psql", ["-X", "-At", "-d", "postgres", "-c", "select 1"]).status !== 0 ? "Postgres local" : null,
  !PGRST || !fs.existsSync(PGRST) ? "PostgREST (GF_POSTGREST_BIN)" : null,
  !GOTRUE || !fs.existsSync(GOTRUE) || !GOTRUE_MIG || !fs.existsSync(GOTRUE_MIG) ? "Auth de Supabase (GF_GOTRUE_BIN, GF_GOTRUE_MIGRACIONES)" : null,
].filter(Boolean);
if (faltan.length) {
  res("--", "SKIP", `recorrido omitido: falta ${faltan.join(", ")}`);
  process.exit(0);
}
let playwright = null;
try {
  const base = process.env.GF_PLAYWRIGHT_CORE_DIR ? path.resolve(process.env.GF_PLAYWRIGHT_CORE_DIR) : RAIZ;
  playwright = createRequire(path.join(base, "noop.js"))("playwright-core");
} catch {
  res("--", "SKIP", "recorrido omitido: falta playwright-core (GF_PLAYWRIGHT_CORE_DIR)");
  process.exit(0);
}

// ── Procesos ──
const procesos = [];
const generados = ["apps/admin/next-env.d.ts", "apps/guard/next-env.d.ts"].filter((f) => !fs.existsSync(path.join(RAIZ, f)));
let gateway = null;
let smtp = null;
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
  smtp?.cerrar();
  smtp = null;
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
function construir(dir, env) {
  const b = spawnSync("npx", ["next", "build"], { cwd: dir, env: { ...process.env, ...env }, encoding: "utf8", timeout: 900_000 });
  return b.status === 0 ? null : (b.stderr || b.stdout || "").split("\n").filter(Boolean).slice(-4).join(" ");
}

async function main() {
  const inicio = Date.now();
  const desde = new Date().toISOString();
  const secreto = crypto.randomBytes(32).toString("hex");
  const claveAuthDb = crypto.randomBytes(16).toString("hex");
  execFileSync("bash", [path.join(AQUI, "construir-base-auth.sh"), DB], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, GF_GOTRUE_BIN: GOTRUE, GF_GOTRUE_MIGRACIONES: GOTRUE_MIG, GF_AUTH_DB_PASSWORD: claveAuthDb },
  });
  const claveDb = crypto.randomBytes(16).toString("hex");
  sql(`alter role authenticator password '${claveDb}'`);
  iniciar("postgrest", PGRST, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator:${claveDb}@127.0.0.1:${process.env.PGPORT ?? 5432}/${DB}`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      // Como Supabase: pgcrypto (gen_random_bytes) vive en "extensions".
      PGRST_DB_EXTRA_SEARCH_PATH: "public, extensions",
      PGRST_JWT_SECRET: secreto,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(P.postgrest),
      PGRST_LOG_LEVEL: "crit",
    },
  });
  smtp = await iniciarSmtpLocal({ puerto: P.smtp });
  // Auth real con la configuración de producción que importa aquí:
  // registro público desactivado, correo obligatorio, sin auto-confirmación.
  iniciar("auth", GOTRUE, ["serve"], {
    env: {
      ...process.env,
      GOTRUE_API_HOST: "127.0.0.1",
      PORT: String(P.auth),
      API_EXTERNAL_URL: `${URL_SUPABASE}/auth/v1`,
      GOTRUE_DB_DRIVER: "postgres",
      DATABASE_URL: `postgres://supabase_auth_admin:${claveAuthDb}@127.0.0.1:${process.env.PGPORT ?? 5432}/${DB}?search_path=auth&sslmode=disable`,
      GOTRUE_DB_MIGRATIONS_PATH: GOTRUE_MIG,
      GOTRUE_SITE_URL: URL_ADMIN,
      GOTRUE_URI_ALLOW_LIST: `${URL_ADMIN}/**,${URL_GUARD}/**`,
      GOTRUE_DISABLE_SIGNUP: "true",
      GOTRUE_JWT_SECRET: secreto,
      GOTRUE_JWT_EXP: "3600",
      GOTRUE_JWT_AUD: "authenticated",
      GOTRUE_JWT_ADMIN_ROLES: "service_role",
      GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
      GOTRUE_MAILER_AUTOCONFIRM: "false",
      GOTRUE_SMTP_HOST: "127.0.0.1",
      GOTRUE_SMTP_PORT: String(P.smtp),
      GOTRUE_SMTP_ADMIN_EMAIL: "no-reply@gateflow.invalid",
      GOTRUE_SMTP_SENDER_NAME: "Gate Flow",
      GOTRUE_MAILER_URLPATHS_CONFIRMATION: "/auth/v1/verify",
      GOTRUE_MAILER_URLPATHS_INVITE: "/auth/v1/verify",
      GOTRUE_MAILER_URLPATHS_RECOVERY: "/auth/v1/verify",
      GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000",
      GOTRUE_LOG_LEVEL: "warn",
    },
  });
  if (!(await esperar(`http://127.0.0.1:${P.postgrest}/`, 20_000)) || !(await esperar(`http://127.0.0.1:${P.auth}/health`, 20_000))) {
    res("--", "FAIL", `no arrancó PostgREST o Auth: ${leerLog("auth").split("\n").slice(-3).join(" ")}`);
    return;
  }
  gateway = await iniciarGateway({ puerto: P.gateway, postgrest: `http://127.0.0.1:${P.postgrest}`, secreto, auth: `http://127.0.0.1:${P.auth}` });
  const anon = firmarJwt({ role: "anon", iss: "supabase" }, secreto);
  const servicio = firmarJwt({ role: "service_role", iss: "supabase" }, secreto);
  const hashAntes = sql("select md5(string_agg(t::text, '|' order by id)) from public.tenants t");

  // ── Builds ──
  const envPublico = {
    NEXT_PUBLIC_SUPABASE_URL: URL_SUPABASE,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    NEXT_PUBLIC_ADMIN_APP_URL: URL_ADMIN,
    NEXT_PUBLIC_GUARD_APP_URL: URL_GUARD,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (process.env.GF_RECORRIDO_SIN_BUILD !== "1") {
    for (const app of ["admin", "guard"]) {
      const error = construir(path.join(RAIZ, "apps", app), envPublico);
      if (error) return res("--", "FAIL", `next build de ${app} falló: ${error}`);
    }
    if (LANDING) {
      const error = construir(path.join(LANDING, "apps/web"), { NEXT_PUBLIC_ADMIN_APP_URL: URL_ADMIN, NEXT_TELEMETRY_DISABLED: "1" });
      if (error) return res("--", "FAIL", `next build de la landing falló: ${error}`);
    }
  }
  const envServidor = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("STRIPE_") && !k.startsWith("MP_"))),
    ...envPublico,
    SUPABASE_SERVICE_ROLE_KEY: servicio,
    REGISTRO_HASH_PEPPER: crypto.randomBytes(24).toString("hex"),
  };
  // Admin con Stripe configurado como en staging (claves ficticias): el
  // checkout está "disponible", así que el bloqueo de Argentina se prueba
  // de verdad. Ninguna petición sale a stripe.com: sin-red-stripe.cjs la
  // rechaza y la anota en BLOQUEOS_STRIPE (debe quedar vacío).
  fs.writeFileSync(BLOQUEOS_STRIPE, "");
  const envAdmin = {
    ...envServidor,
    STRIPE_SECRET_KEY: "sk_test_" + "ZZAUTOTEST".repeat(3),
    STRIPE_WEBHOOK_SECRET: "whsec_test_" + crypto.randomBytes(12).toString("hex"),
    STRIPE_PORTAL_CONFIGURATION_ID: "bpc_test_ZZAUTOTEST",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${path.join(RAIZ, "tests/billing/e2e/sin-red-stripe.cjs")}`.trim(),
    GF_STRIPE_BLOQUEOS: BLOQUEOS_STRIPE,
  };
  iniciar("admin", "npx", ["next", "start", "-p", String(P.admin)], { cwd: path.join(RAIZ, "apps/admin"), env: envAdmin });
  iniciar("guard", "npx", ["next", "start", "-p", String(P.guard)], { cwd: path.join(RAIZ, "apps/guard"), env: envServidor });
  if (LANDING) iniciar("web", "npx", ["next", "start", "-p", String(P.web)], { cwd: path.join(LANDING, "apps/web"), env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  for (const u of [`${URL_ADMIN}/login`, `${URL_GUARD}/login`, ...(LANDING ? [`${URL_WEB}/`] : [])]) {
    if (!(await esperar(u, 90_000))) return res("--", "FAIL", `no arrancó ${u}`);
  }
  if (!LANDING) res("31", "SKIP", "landing no incluida (GF_LANDING_DIR): el recorrido empieza en /registro");

  const run = `ZZ_AUTOTEST_${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}_${crypto.randomBytes(3).toString("hex")}`;
  const correo = (perfil, rol) => `zz_autotest+${run.toLowerCase()}-${perfil}-${rol}@gateflow.invalid`;
  const tenants = [];
  const navegador = await playwright.chromium.launch({ ...(process.env.GF_CHROMIUM ? { executablePath: process.env.GF_CHROMIUM } : {}), args: ["--no-sandbox"] });
  try {
    const perfiles = [
      // Como un cliente en Argentina: el registro toma la zona horaria del navegador.
      { id: "desktop", contexto: { viewport: { width: 1366, height: 900 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" } },
      { id: "movil", contexto: { ...playwright.devices["iPhone 13"], locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" } },
    ];
    for (const perfil of perfiles) {
      await recorrido(navegador, perfil, { run, correo, servicio, desde, tenants });
    }
  } catch (e) {
    res("--", "FAIL", `excepción en el recorrido: ${String(e?.stack ?? e).split("\n").slice(0, 3).join(" ")}`);
  } finally {
    await navegador.close();
    ok("35", smtp.rechazados.length === 0 && smtp.mensajes.every((m) => m.para.every((x) => x.endsWith("@gateflow.invalid"))), "ningún correo a un dominio real (buzón local, solo @gateflow.invalid)", JSON.stringify(smtp.rechazados));
    // ── Teardown por ids (marca del run) ──
    const lista = (xs) => xs.map((x) => `'${x}'`).join(",") || "null";
    const users = sql(`select coalesce(string_agg(id::text, ','), '') from auth.users where email like 'zz_autotest+${run.toLowerCase()}-%@gateflow.invalid'`).split(",").filter(Boolean);
    const conteo = () =>
      Number(
        sql(`select (select count(*) from public.tenants where id in (${lista(tenants)}))
          + (select count(*) from public.suscripciones where tenant_id in (${lista(tenants)}))
          + (select count(*) from public.unidades where tenant_id in (${lista(tenants)}))
          + (select count(*) from public.ubicaciones where tenant_id in (${lista(tenants)}))
          + (select count(*) from public.paquetes where tenant_id in (${lista(tenants)}))
          + (select count(*) from public.user_tenants where tenant_id in (${lista(tenants)}) or user_id in (${lista(users)}))
          + (select count(*) from auth.users where id in (${lista(users)}))`),
      );
    const creados = conteo();
    try {
      if (Number(sql(`select count(*) from public.tenants where id in (${lista(tenants)}) and left(nombre, ${run.length}) <> '${run}'`)) > 0) throw new Error("tenant sin marca del run");
      sql(`begin;
        delete from public.audit_log where tenant_id in (${lista(tenants)}) or user_id in (${lista(users)});
        delete from public.notificaciones where tenant_id in (${lista(tenants)});
        delete from public.paquete_historial where paquete_id in (select id from public.paquetes where tenant_id in (${lista(tenants)}));
        delete from public.paquetes where tenant_id in (${lista(tenants)});
        delete from public.paquete_grupos_entrega where tenant_id in (${lista(tenants)});
        delete from public.ubicaciones where tenant_id in (${lista(tenants)});
        delete from public.unidades where tenant_id in (${lista(tenants)});
        delete from public.suscripciones where tenant_id in (${lista(tenants)});
        delete from public.user_tenants where tenant_id in (${lista(tenants)}) or user_id in (${lista(users)});
        create temp table zz_emp on commit drop as select empresa_id from public.tenants where id in (${lista(tenants)});
        delete from public.tenants where id in (${lista(tenants)});
        delete from public.empresas where id in (select empresa_id from zz_emp);
        delete from public.registro_intentos where created_at >= '${desde}';
        delete from public.users where id in (${lista(users)});
        delete from auth.users where id in (${lista(users)});
        commit;`);
    } catch (e) {
      res("20", "FAIL", `teardown: ${String(e.stderr ?? e).split("\n")[0]}`);
    }
    const residuos = conteo();
    ok("20", residuos === 0, "teardown local por ids: 0 residuos", `residuos ${residuos}`);
    ok("20", sql("select coalesce(md5(string_agg(t::text, '|' order by id)), '') from public.tenants t") === (hashAntes ?? ""), "tenants iguales a antes del recorrido");
    console.log(`FIXTURES|${CAPA}|run=${run}|creados=${creados}|eliminados=${creados - residuos}|residuos=${residuos}`);
    detener();
    spawnSync("dropdb", ["--if-exists", DB]);
    // Logs de PostgREST, Auth y las apps: se conservan solo si algo falló.
    if (fallas === 0) fs.rmSync(TMP, { recursive: true, force: true });
    else console.log(`INFO|${CAPA}|logs en ${TMP}`);
    console.log(`DURACION|${CAPA}|${Math.round((Date.now() - inicio) / 1000)}s`);
  }
}

// ── Un recorrido completo (un dispositivo) ──
async function recorrido(navegador, perfil, { run, correo, servicio, desde, tenants }) {
  const p = perfil.id;
  const e = (n) => `${n}`;
  const nuevo = async () => {
    const ctx = await navegador.newContext(perfil.contexto);
    // WhatsApp: se captura el enlace sin salir a internet.
    await ctx.route("https://wa.me/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html>wa</html>" }));
    return ctx;
  };
  const texto = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const admin = { email: correo(p, "admin"), password: `Zz-${crypto.randomBytes(6).toString("hex")}` };
  const guardia = { email: correo(p, "guardia"), password: `Zz-${crypto.randomBytes(6).toString("hex")}` };
  const nombreResidencial = `${run}_${p}`;

  // 01 · landing → "Probar gratis"
  let ctx = await nuevo();
  let page = await ctx.newPage();
  if (LANDING) {
    await page.goto(`${URL_WEB}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const t = await texto(page);
    ok(e("31"), page.url() === `${URL_WEB}/` && /30 d[ií]as/i.test(t) && !/7 d[ií]as|una semana/i.test(t), `[${p}] landing publicada (V2): 30 días, sin "7 días"`, t.slice(0, 160));
    const html = await page.content();
    ok(e("31"), !/7 d[ií]as|7 D[IÍ]AS|una semana/i.test(html), `[${p}] el HTML de "/" no contiene "7 días"`);
    const enlaceIngresar = page.locator(`a[href="${URL_ADMIN}/login"]`);
    ok(e("31"), (await enlaceIngresar.count()) >= 1 && (await page.locator(`a[href="${URL_ADMIN}/privacidad"]`).count()) >= 1, `[${p}] Ingresar / Privacidad apuntan al panel`);
    await captura(page, `${p}-00-landing`);
    const robotsMeta = (await page.locator('meta[name="robots"]').getAttribute("content").catch(() => null)) ?? "";
    const robotsTxt = await (await fetch(`${URL_WEB}/robots.txt`)).text();
    const cabecera = (await fetch(`${URL_WEB}/`)).headers.get("x-robots-tag") ?? "";
    ok(e("31"), /noindex/.test(robotsMeta) && /Disallow: \//.test(robotsTxt) && /noindex/.test(cabecera), `[${p}] preview sin indexar (meta robots, robots.txt y X-Robots-Tag)`, `${robotsMeta} | ${robotsTxt.replace(/\s+/g, " ")} | ${cabecera}`);
    const cta = page.locator(`a[href^="${URL_ADMIN}/registro"]:visible`).first();
    ok(e("31"), (await cta.count()) === 1, `[${p}] CTA "Probar gratis" visible y hacia /registro`);
    await Promise.all([page.waitForURL(`${URL_ADMIN}/registro**`, { timeout: 30_000 }), cta.click()]);
    await page.waitForLoadState("networkidle");
  } else {
    await page.goto(`${URL_ADMIN}/registro`, { waitUntil: "networkidle" });
  }

  // 21 · registro con país explícito
  ok(e("32"), new URL(page.url()).pathname === "/registro" && (await page.locator("select#pais").inputValue()) === "", `[${p}] /registro sin país preseleccionado`, page.url());
  await page.locator("#nombreCompleto").fill("Ana Prueba Sintética");
  await page.locator("#email").fill(admin.email);
  await page.locator("#password").fill(admin.password);
  await page.locator("#nombreResidencial").fill(nombreResidencial);
  await page.locator("#viviendas").fill("40");
  await page.locator('input[name="aceptaTerminos"]').check();
  // Sin país: el servidor (y el navegador) no dejan avanzar.
  await page.waitForTimeout(4_500); // tiempo mínimo antibot del formulario
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1_500);
  ok(e("32"), Number(sql(`select count(*) from public.tenants where nombre = '${nombreResidencial}'`)) === 0, `[${p}] sin elegir país no se crea nada`);
  await page.locator("select#pais").selectOption("AR");
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => /Revisa tu correo/i.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => null);
  let t = await texto(page);
  ok(e("32"), /Revisa tu correo/i.test(t), `[${p}] alta enviada → "Revisa tu correo"`, t.slice(0, 200));
  await captura(page, `${p}-01-registro-enviado`);
  const fila = sql(`select concat_ws('|', t.id, t.pais, t.timezone, s.estado, s.origen, (s.trial_ends_at - s.trial_started_at) = interval '30 days', s.provider is null, u.email_confirmed_at is null)
    from public.tenants t join public.suscripciones s on s.tenant_id = t.id join public.user_tenants ut on ut.tenant_id = t.id join auth.users u on u.id = ut.user_id
    where t.nombre = '${nombreResidencial}'`);
  const [tenantId, ...resto] = fila.split("|");
  if (tenantId) tenants.push(tenantId); // entra al teardown aunque el recorrido falle después
  ok(e("32"), /^AR\|America\/(Argentina\/)?Buenos_Aires\|trialing\|registro_publico\|t\|t\|t$/.test(resto.join("|")), `[${p}] residencial AR (zona Buenos Aires), prueba de 30 días, sin proveedor, correo sin confirmar`, fila);

  // Login antes de confirmar: mensaje claro, sin detalle técnico.
  await page.goto(`${URL_ADMIN}/login`, { waitUntil: "networkidle" });
  await page.locator("#email").fill(admin.email);
  await page.locator("#password").fill(admin.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => /Tu correo todavía|Correo o contraseña|No pudimos iniciar/.test(document.body.innerText), null, { timeout: 15_000 }).catch(() => null);
  t = await texto(page);
  ok(e("32"), t.includes("Tu correo todavía no está confirmado") && !t.includes("[DEBUG]") && !/email_not_confirmed|status: 400/.test(t), `[${p}] login antes de confirmar: mensaje para personas`, t.slice(0, 200));
  await ctx.close();

  // 21 · correo de confirmación → /confirmar-cuenta → onboarding
  const mConfirmacion = await smtp.esperar(admin.email, { ms: 20_000 });
  const enlaceConfirmar = mConfirmacion ? enlaces(mConfirmacion).find((l) => l.includes("/verify") && l.includes("type=signup")) : null;
  ok(e("32"), Boolean(enlaceConfirmar) && enlaceConfirmar.includes(encodeURIComponent(`${URL_ADMIN}/confirmar-cuenta`).replace(/%2F/g, "/")) || (enlaceConfirmar ?? "").includes(`${URL_ADMIN}/confirmar-cuenta`), `[${p}] correo de confirmación (buzón local) con enlace a /confirmar-cuenta`, enlaceConfirmar);
  if (!enlaceConfirmar) return;
  ctx = await nuevo();
  page = await ctx.newPage();
  const erroresConsola = [];
  page.on("console", (m) => m.type() === "error" && erroresConsola.push(m.text().slice(0, 200)));
  await page.goto(enlaceConfirmar, { waitUntil: "domcontentloaded" });
  await page.waitForURL(`${URL_ADMIN}/onboarding**`, { timeout: 30_000 }).catch(() => null);
  ok(e("32"), new URL(page.url()).pathname === "/onboarding" && !page.url().includes("access_token"), `[${p}] confirmación → sesión → /onboarding (sin tokens en la URL)`, page.url());
  ok(e("32"), sql(`select (email_confirmed_at is not null)::text from auth.users where email = '${admin.email}'`) === "true", `[${p}] correo confirmado en Auth`);

  // Onboarding: datos, residentes (CSV con teléfonos de Argentina), guardia, bodega, fin.
  await page.getByRole("button", { name: /Comenzar/ }).click();
  await page.locator("#ob-telefono").fill("11 4000-0000");
  await page.locator("#ob-correo").fill(correo(p, "residencial"));
  await page.locator("#ob-direccion").fill("Calle Falsa 123, CABA");
  await page.getByRole("button", { name: /Continuar/ }).first().click();
  await page.waitForSelector("text=Paso 3 de 6", { timeout: 20_000 });
  const csv = path.join(TMP, `residentes-${p}.csv`);
  fs.writeFileSync(csv, "Tipo,Identificador,Nombre del residente,Teléfono\nCasa,ZZ Lote 1,Residente Uno,11 2345-6789\nDepartamento,ZZ Torre A 3B,Residente Dos,0351 15 123-4567\n");
  const entradasArchivo = await page.locator('input[type="file"]').count();
  await page.locator('input[type="file"]').first().setInputFiles(csv);
  await page.waitForTimeout(500);
  const trasArchivo = (await texto(page)).slice(-600);
  await page.getByRole("button", { name: /Importar 2 unidades/ }).click({ timeout: 20_000 });
  await page.waitForFunction(() => /unidad(es)? importadas?|omitida/i.test(document.body.innerText), null, { timeout: 20_000 }).catch(() => null);
  await captura(page, `${p}-03-importacion`);
  t = await texto(page);
  ok(e("33"), sql(`select count(*) || '/' || coalesce(string_agg(contacto_telefono, ',' order by identificador), '') from public.unidades where tenant_id = '${tenantId}'`) === "2/11 2345-6789,0351 15 123-4567", `[${p}] residentes importados (2 unidades con teléfono de Argentina)`, `inputs=${entradasArchivo} · tras el archivo: ${trasArchivo} · final: ${t.slice(-400)} · consola: ${erroresConsola.join(" / ")}`);
  await page.getByRole("button", { name: /^Continuar/ }).click();
  await page.waitForSelector("text=Paso 4 de 6", { timeout: 20_000 });
  await page.getByPlaceholder("correo@residencial.com").fill(guardia.email);
  await page.getByRole("button", { name: /^Invitar$/ }).click();
  await page.waitForFunction(() => /1 invitado/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => null);
  ok(e("33"), sql(`select r.clave from public.user_tenants ut join public.roles r on r.id = ut.rol_id join auth.users u on u.id = ut.user_id where u.email = '${guardia.email}' and ut.tenant_id = '${tenantId}'`) === "guardia", `[${p}] guardia invitado con membresía en el residencial`);
  await page.getByRole("button", { name: /^Continuar/ }).click();
  await page.waitForSelector("text=Paso 5 de 6", { timeout: 20_000 });
  await page.getByRole("button", { name: /Crear primera ubicación/ }).click();
  await page.locator("#b-nombre").fill("Estante A");
  await page.getByRole("button", { name: /^Guardar/ }).click();
  await page.waitForFunction(() => /Estante A/.test(document.body.innerText), null, { timeout: 20_000 }).catch(() => null);
  await page.getByRole("button", { name: /^Continuar/ }).click();
  await page.waitForSelector("text=GateFlow está listo", { timeout: 20_000 });
  await Promise.all([page.waitForURL(`${URL_ADMIN}/dashboard**`, { timeout: 30_000 }).catch(() => null), page.getByRole("button", { name: /Ir al Dashboard/ }).click()]);
  t = await texto(page);
  ok(e("32"), new URL(page.url()).pathname === "/dashboard" && /Prueba gratuita · 30 días restantes|30 días/.test(t), `[${p}] panel operativo con la prueba de 30 días en curso`, `${page.url()} ${t.slice(0, 160)}`);
  // mv_dashboard_diario: sin SELECT para authenticated (como en staging) → gráfico vacío, dashboard usable.
  await page.waitForFunction(() => /Volumen de paquetes/.test(document.body.innerText), null, { timeout: 20_000 }).catch(() => null);
  t = await texto(page);
  await captura(page, `${p}-02-dashboard`);
  ok(e("32"), t.includes("Volumen de paquetes — últimos 30 días") && t.includes("Todavía no hay datos para mostrar.") && !t.includes("supabase/README"), `[${p}] dashboard de un admin nuevo: carga completo, gráfico vacío sin texto técnico`, t.slice(0, 300));

  // 21/30 · /suscripcion durante la prueba: sin cobro, sin planes que no funcionan
  await page.goto(`${URL_ADMIN}/suscripcion`, { waitUntil: "domcontentloaded" });
  t = await texto(page);
  await captura(page, `${p}-02b-suscripcion-en-prueba`);
  ok(e("34"), t.includes("Estás en tu prueba gratuita") && t.includes("Durante la prueba no se cobra nada ni se pide tarjeta.") && !t.includes("Activar plan") && !t.includes("Precio"), `[${p}] /suscripcion en prueba: sin tarjeta, sin contratación ofrecida`, t.slice(0, 200));
  await ctx.close();

  // 22 · el guardia acepta la invitación y opera en Guard (móvil)
  const mInvitacion = await smtp.esperar(guardia.email, { ms: 20_000 });
  const enlaceInvitacion = mInvitacion ? enlaces(mInvitacion).find((l) => l.includes("type=invite")) : null;
  ok(e("33"), Boolean(enlaceInvitacion), `[${p}] correo de invitación al guardia (buzón local)`);
  if (enlaceInvitacion) {
    const ctxG = await navegador.newContext({ ...playwright.devices["Pixel 7"], locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
    await ctxG.route("https://wa.me/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html>wa</html>" }));
    const pg = await ctxG.newPage();
    const consola = [];
    pg.on("console", (m) => consola.push(m.text()));
    await pg.goto(enlaceInvitacion, { waitUntil: "domcontentloaded" });
    await pg.waitForURL(`${URL_ADMIN}/aceptar-invitacion**`, { timeout: 30_000 }).catch(() => null);
    await pg.waitForSelector('input[type="password"]', { timeout: 20_000 }).catch(() => null);
    const tg = await texto(pg);
    ok(e("33"), !/STEP \d|access_token|refresh_token/.test(tg) && !consola.some((l) => /access_token|refresh_token|STEP \d/.test(l)), `[${p}] aceptar invitación: sin consola de diagnóstico ni tokens visibles`, consola.find((l) => /access_token|STEP/.test(l)) ?? "");
    await pg.locator("#ai-nombre").fill("Guardia Sintético");
    await pg.locator("#ai-password").fill(guardia.password);
    await pg.locator("#ai-password2").fill(guardia.password);
    await pg.locator('input[type="checkbox"]').check();
    await Promise.all([pg.waitForURL(`${URL_GUARD}/login**`, { timeout: 30_000 }).catch(() => null), pg.getByRole("button", { name: /Crear contraseña y continuar/ }).click()]);
    await captura(pg, `${p}-04-invitacion-aceptada`);
    ok(e("33"), sql(`select concat_ws('|', p.nombre_completo, p.terminos_aceptados_en is not null) from public.users p join auth.users u on u.id = p.id where u.email = '${guardia.email}'`) === "Guardia Sintético|t", `[${p}] invitación: nombre y aceptación de términos del guardia guardados`);
    ok(e("33"), pg.url().startsWith(`${URL_GUARD}/login`), `[${p}] guardia → login de la app Guard`, `${pg.url()} · consola: ${consola.filter((l) => /GateFlow|rror/.test(l)).join(" / ")}`);
    await pg.waitForLoadState("networkidle");
    await pg.locator('input[type="email"]').fill(guardia.email);
    await pg.locator('input[type="password"]').fill(guardia.password);
    await Promise.all([pg.waitForURL(`${URL_GUARD}/guard**`, { timeout: 30_000 }).catch(() => null), pg.locator('button[type="submit"]').click()]);
    ok(e("33"), new URL(pg.url()).pathname === "/guard", `[${p}] guardia opera en Guard durante la prueba`, pg.url());
    // Registrar un paquete para "ZZ Lote 1" y avisar por WhatsApp (+54 9).
    await pg.goto(`${URL_GUARD}/guard/packages/register`, { waitUntil: "networkidle" });
    await pg.getByPlaceholder("Buscar unidad, residente o teléfono…").fill("ZZ Lote 1");
    await pg.getByRole("button", { name: /ZZ Lote 1/ }).first().click({ timeout: 20_000 });
    await pg.getByRole("button", { name: /Estante A/ }).click({ timeout: 20_000 });
    await captura(pg, `${p}-06a-guard-antes-de-confirmar`);
    await pg.getByRole("button", { name: /Confirmar recepción/ }).click();
    await pg.getByRole("button", { name: /Guardar y enviar notificación/ }).waitFor({ timeout: 30_000 }).catch(() => null);
    const [ventana] = await Promise.all([pg.waitForEvent("popup", { timeout: 20_000 }).catch(() => null), pg.getByRole("button", { name: /Guardar y enviar notificación/ }).click().catch(() => null)]);
    await captura(pg, `${p}-06b-guard-tras-notificar`);
    const urlWa = ventana?.url() ?? "";
    ok(e("33"), urlWa.startsWith("https://wa.me/5491123456789?text="), `[${p}] aviso por WhatsApp al residente con +54 9 (no +52)`, urlWa.slice(0, 60));
    ok(e("33"), Number(sql(`select count(*) from public.paquetes where tenant_id = '${tenantId}'`)) === 1, `[${p}] paquete registrado en la prueba`);
    await ctxG.close();
  }

  // Login del administrador con contraseña (después de confirmar).
  ctx = await nuevo();
  page = await ctx.newPage();
  await page.goto(`${URL_ADMIN}/login`, { waitUntil: "networkidle" });
  await captura(page, `${p}-05-login`);
  ok(e("32"), (await page.locator('a[href="/registro"]').count()) === 1, `[${p}] el login ofrece la prueba gratis a quien no tiene cuenta`);
  await page.locator("#email").fill(admin.email);
  await page.locator("#password").fill("contraseña-equivocada");
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => /Tu correo todavía|Correo o contraseña|No pudimos iniciar/.test(document.body.innerText), null, { timeout: 15_000 }).catch(() => null);
  t = await texto(page);
  ok(e("32"), t.includes("Correo o contraseña incorrectos.") && !t.includes("[DEBUG]"), `[${p}] contraseña incorrecta: mensaje para personas`, t.slice(0, 160));
  await page.locator("#password").fill(admin.password);
  await Promise.all([page.waitForURL(`${URL_ADMIN}/dashboard**`, { timeout: 30_000 }).catch(() => null), page.locator('button[type="submit"]').click()]);
  ok(e("32"), new URL(page.url()).pathname === "/dashboard", `[${p}] el administrador vuelve a entrar con su contraseña`, page.url());

  // 30 · vence la prueba: bloqueo, sin contratación falsa, información conservada
  sql(`update public.suscripciones set trial_started_at = now() - interval '31 days', trial_ends_at = now() - interval '1 hour' where tenant_id = '${tenantId}'`);
  await page.goto(`${URL_ADMIN}/dashboard`, { waitUntil: "domcontentloaded" });
  t = await texto(page);
  await captura(page, `${p}-08-suscripcion-vencida`);
  ok(e("34"), new URL(page.url()).pathname === "/suscripcion" && t.includes("Tu prueba gratuita de 30 días terminó") && t.includes("La contratación en línea todavía no está disponible") && t.includes("Tu información se conserva"), `[${p}] prueba vencida → /suscripcion con aviso honesto`, `${page.url()} ${t.slice(0, 200)}`);
  ok(e("34"), (await page.locator('button:has-text("Activar plan")').count()) === 0 && !/Mercado Pago|Stripe|tarjeta/i.test(t), `[${p}] sin botones de pago ni medio alternativo`);
  ok(e("34"), sql(`select count(*) from public.unidades where tenant_id = '${tenantId}'`) === "2" && sql(`select count(*) from public.paquetes where tenant_id = '${tenantId}'`) !== "0", `[${p}] la información del residencial se conserva`);
  // Servidor: la server action del checkout, invocada como la invoca un
  // formulario ("Next-Action"), rechaza Argentina aunque Stripe esté
  // configurado: ni billing_checkout ni petición a Stripe.
  const idAccion = idElegirPlan();
  const intentosAntes = intentosStripe();
  const llamada = idAccion
    ? await page.evaluate(async (id) => {
        const datos = new FormData();
        datos.append("1_plan", "hasta-50");
        datos.append("0", JSON.stringify(["$K1"]));
        // El servidor responde 303 a /suscripcion?error=…; se sigue la redirección.
        const r = await fetch("/suscripcion", { method: "POST", headers: { "Next-Action": id, Accept: "text/x-component" }, body: datos });
        return { status: r.status, redireccion: r.headers.get("x-action-redirect") ?? (r.redirected ? new URL(r.url).pathname + new URL(r.url).search : null) };
      }, idAccion)
    : null;
  ok(
    e("34"),
    Boolean(llamada?.redireccion?.includes("error=pais")) && sql(`select count(*) from public.billing_checkouts where tenant_id = '${tenantId}'`) === "0" && intentosStripe() === intentosAntes,
    `[${p}] servidor: checkout de Stripe rechazado para Argentina (sin billing_checkout ni llamada a Stripe)`,
    `${idAccion ?? "sin id de acción"} ${JSON.stringify(llamada)} intentos=${intentosStripe() - intentosAntes}`,
  );
  await page.goto(`${URL_ADMIN}/suscripcion?error=pais`, { waitUntil: "domcontentloaded" });
  t = await texto(page);
  ok(e("34"), t.includes("La contratación en línea todavía no está disponible para tu residencial.") && (await page.locator('button:has-text("Activar plan")').count()) === 0, `[${p}] el rechazo del servidor se explica sin ofrecer otro pago`, t.slice(0, 200));
  const ctxG2 = await navegador.newContext({ ...playwright.devices["Pixel 7"], locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  const pg2 = await ctxG2.newPage();
  const diag2 = [];
  pg2.on("console", (m) => m.type() === "error" && diag2.push(`consola: ${m.text().slice(0, 160)}`));
  pg2.on("requestfailed", (r) => diag2.push(`falló ${r.method()} ${r.url().slice(0, 80)}: ${r.failure()?.errorText}`));
  pg2.on("response", (r) => r.status() >= 400 && diag2.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 80)}`));
  await pg2.goto(`${URL_GUARD}/login`, { waitUntil: "networkidle" });
  await pg2.locator('input[type="email"]').fill(guardia.email);
  await pg2.locator('input[type="password"]').fill(guardia.password);
  await Promise.all([pg2.waitForURL(/:\d+\/(guard|servicio-inactivo)/, { timeout: 30_000 }).catch(() => null), pg2.locator('button[type="submit"]').click()]);
  await captura(pg2, `${p}-07a-guard-vencida-login`);
  await pg2.goto(`${URL_GUARD}/guard`, { waitUntil: "networkidle" });
  await captura(pg2, `${p}-07-guard-vencida`);
  ok(e("34"), new URL(pg2.url()).pathname === "/servicio-inactivo", `[${p}] Guard bloqueado al vencer la prueba`, `${pg2.url()} · ${diag2.join(" / ")}`);
  await ctxG2.close();
  await ctx.close();
  void desde;
  void servicio;
}

main()
  .catch((e) => res("--", "FAIL", `excepción: ${String(e?.stack ?? e).split("\n").slice(0, 2).join(" ")}`))
  .finally(() => process.exit(fallas > 0 ? 1 : 0));
