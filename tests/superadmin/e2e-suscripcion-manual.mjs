// ============================================================
// Recorrido E2E LOCAL de la suscripción manual de Super Admin (opt-in;
// sin red externa, sin Stripe, sin staging):
//   Postgres local gf_billing_sm_e2e (todas las migraciones, grants de
//   staging) + PostgREST + gateway (tests/billing/e2e/gateway.mjs)
//   + Admin REAL (next build + next start) con Stripe bloqueado
//   + Playwright (desktop y móvil).
//
//   1. residencial AR con prueba vencida → su admin queda bloqueado
//   2. Super Admin entra al detalle → pestaña «Suscripción»
//   3. extiende la prueba → el residencial vuelve a operar
//   4. activa manualmente (plan, confirmación sin cobro) → sigue operativo
//   5. extiende la vigencia con doble clic → una sola acción
//   6. la fecha llega al límite (se mueve el reloj en la base) → bloqueado
//   7. ningún billing_checkout ni billing_evento creado
//   8. residencial MX con Stripe: «gestionada por Stripe», sin acciones, intacto
//   9. auditoría: tres acciones del Super Admin, sin datos personales
//  10. teardown: la base queda idéntica (hash)
//
// Uso (mismos requisitos que tests/billing/e2e/run-local.mjs):
//   PGHOST=/tmp PGPORT=54329 PGUSER=postgres GF_POSTGREST_BIN=… \
//   GF_PLAYWRIGHT_CORE_DIR=… GF_CHROMIUM=… node tests/superadmin/e2e-suscripcion-manual.mjs
// Salida: RESULT|SM-e2e|…; código 1 si hay algún FAIL.
// ============================================================
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cookieSesion, firmarJwt, iniciarGateway } from "../billing/e2e/gateway.mjs";

const CAPA = "SM-e2e";
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const DB = process.env.GF_SM_E2E_DB ?? "gf_billing_sm_e2e";
const P = { postgrest: 3931, gateway: 3932, admin: 3933 };
const URL_SUPABASE = `http://localhost:${P.gateway}`;
const URL_ADMIN = `http://localhost:${P.admin}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gf-sm-e2e-"));
const CAPTURAS = process.env.GF_SM_CAPTURAS ?? null;
const BSAS = "America/Argentina/Buenos_Aires";

let fallas = 0;
function res(e, estado, texto) {
  if (estado === "FAIL") fallas++;
  console.log(`RESULT|${CAPA}|${e}|${estado}|${String(texto).replace(/[|\n]/g, " ")}`);
}
const ok = (e, cond, texto, detalle = "") => res(e, cond ? "PASS" : "FAIL", cond ? texto : `${texto} — ${detalle}`);

// ── Salvaguardas: solo local ──
if (!/^gf_billing_/.test(DB)) {
  res("--", "FAIL", "la base debe llamarse gf_billing_* (construir-base.sh lo exige)");
  process.exit(1);
}
for (const v of [process.env.PGHOST, process.env.DATABASE_URL, process.env.PGDATABASE]) {
  if (/supabase|pooler/.test(v ?? "")) {
    res("--", "FAIL", "rechazado: el entorno apunta a Supabase");
    process.exit(1);
  }
}
if (process.env.PGHOST && !/^(\/|localhost$|127\.0\.0\.1$)/.test(process.env.PGHOST)) {
  res("--", "FAIL", "rechazado: PGHOST no es local");
  process.exit(1);
}

const quien = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
const PGRST = process.env.GF_POSTGREST_BIN || quien("postgrest");
if (!quien("psql") || spawnSync("psql", ["-X", "-At", "-d", "postgres", "-c", "select 1"]).status !== 0) {
  res("--", "SKIP", "omitido: no hay Postgres local");
  process.exit(0);
}
if (!PGRST || !fs.existsSync(PGRST)) {
  res("--", "SKIP", "omitido: falta PostgREST (GF_POSTGREST_BIN)");
  process.exit(0);
}
let playwright = null;
try {
  const base = process.env.GF_PLAYWRIGHT_CORE_DIR ? path.resolve(process.env.GF_PLAYWRIGHT_CORE_DIR) : RAIZ;
  playwright = createRequire(path.join(base, "noop.js"))("playwright-core");
} catch {
  res("--", "SKIP", "omitido: falta playwright-core (GF_PLAYWRIGHT_CORE_DIR)");
  process.exit(0);
}

const procesos = [];
const generados = ["apps/admin/next-env.d.ts"].filter((f) => !fs.existsSync(path.join(RAIZ, f)));
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

  // Fixtures confirmados (solo esta base local), marcados ZZ_AUTOTEST_.
  const hashAntes = sql(HASH_TODO);
  const run = `ZZ_AUTOTEST_SM_${crypto.randomBytes(3).toString("hex")}`;
  const marca = `gf-autotest:${run}`;
  const fx = JSON.parse(
    sql(`with
      e as (insert into public.empresas (nombre, observaciones) values ('${run}', '${marca}') returning id),
      t as (insert into public.tenants (nombre, tipo, timezone, pais, plan, estado_servicio, onboarding_completado, empresa_id, observaciones)
            select '${run}_' || k, 'residencial', tz, p, 'trial', 'activo', true, (select id from e), '${marca}'
            from (values ('PLAT', 'America/Mexico_City', 'MX'), ('AR', '${BSAS}', 'AR'), ('MX', 'America/Mexico_City', 'MX')) v(k, tz, p)
            returning id, nombre)
      select json_object_agg(split_part(nombre, '_', 5), id)::text from t`),
  );
  const T = { PLAT: fx.PLAT, AR: fx.AR, MX: fx.MX };
  sql(`insert into public.suscripciones (tenant_id, estado, origen) values ('${T.PLAT}', 'active', 'alta_manual');
       insert into public.suscripciones (tenant_id, estado, origen, trial_started_at, trial_ends_at, viviendas_declaradas)
         values ('${T.AR}', 'trialing', 'registro_publico', now() - interval '31 days', now() - interval '1 hour', 30);
       insert into public.suscripciones (tenant_id, estado, origen, viviendas_declaradas, plan, provider, provider_customer_id,
                                         provider_subscription_id, current_period_end, cancel_at_period_end, provider_version_at)
         values ('${T.MX}', 'active', 'registro_publico', 20, 'hasta-50', 'stripe', 'cus_${run}', 'sub_${run}',
                 now() + interval '20 days', false, now() - interval '1 hour');
       insert into public.unidades (tenant_id, tipo, identificador)
         select t, 'casa', 'ZZ ' || g from unnest(array['${T.AR}', '${T.MX}']::uuid[]) t, generate_series(1, 3) g`);
  const U = {};
  for (const k of ["super", "admin_ar", "admin_mx"]) {
    U[k] = sql(`insert into auth.users (id, email, raw_user_meta_data)
                values (gen_random_uuid(), 'zz_autotest+${run.toLowerCase()}-${k}@gateflow.invalid', '{"nombre_completo": "${run}"}')
                returning id`);
  }
  sql(`insert into public.user_tenants (user_id, tenant_id, rol_id) values
         ('${U.super}', '${T.PLAT}', (select id from public.roles where clave = 'super_admin')),
         ('${U.admin_ar}', '${T.AR}', (select id from public.roles where clave = 'admin_residencial')),
         ('${U.admin_mx}', '${T.MX}', (select id from public.roles where clave = 'admin_residencial'))`);
  const email = (k) => `zz_autotest+${run.toLowerCase()}-${k}@gateflow.invalid`;
  const SUS_AR = sql(`select id from public.suscripciones where tenant_id = '${T.AR}'`);
  const huellaMx = () => sql(`select md5(row(s.*)::text) from public.suscripciones s where tenant_id = '${T.MX}'`);
  const huellaMxAntes = huellaMx();
  const billingAntes = sql("select (select count(*) from public.billing_checkouts) || '/' || (select count(*) from public.billing_eventos)");
  // tenant_operativo con el JWT del usuario (como PostgREST), en una transacción revertida.
  const operativo = (uid, tenant) =>
    execFileSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB,
      "-c", "begin",
      "-c", `select set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true)`,
      "-c", "set local role authenticated",
      "-c", `select public.tenant_operativo('${tenant}')`,
      "-c", "rollback"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).at(-1);
  const hoyAr = (dias) => sql(`select ((now() at time zone '${BSAS}')::date + ${dias})::text`);
  const corta = (clave) => clave.split("-").reverse().join("/");

  try {
    const b = spawnSync("npx", ["next", "build"], {
      cwd: path.join(RAIZ, "apps/admin"),
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: URL_SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, NEXT_PUBLIC_ADMIN_APP_URL: URL_ADMIN, NEXT_TELEMETRY_DISABLED: "1" },
      encoding: "utf8",
      timeout: 600_000,
    });
    if (b.status !== 0) {
      res("--", "FAIL", `next build de admin falló: ${(b.stderr || b.stdout || "").split("\n").filter(Boolean).slice(-3).join(" ")}`);
      return;
    }
    iniciar("admin", "npx", ["next", "start", "-p", String(P.admin)], {
      cwd: path.join(RAIZ, "apps/admin"),
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: URL_SUPABASE,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
        NEXT_PUBLIC_ADMIN_APP_URL: URL_ADMIN,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${path.join(RAIZ, "tests/billing/e2e/sin-red-stripe.cjs")}`.trim(),
        GF_STRIPE_BLOQUEOS: path.join(TMP, "stripe-bloqueos.txt"),
      },
    });
    if (!(await esperar(`${URL_ADMIN}/login`, 60_000))) {
      res("--", "FAIL", "no arrancó Admin");
      return;
    }

    const navegador = await playwright.chromium.launch({ ...(process.env.GF_CHROMIUM ? { executablePath: process.env.GF_CHROMIUM } : {}), args: ["--no-sandbox"] });
    const contexto = async (usuario, viewport = { width: 1280, height: 900 }) => {
      const ctx = await navegador.newContext({ viewport, locale: "es-AR", timezoneId: BSAS });
      const { nombre, valor } = cookieSesion({ urlSupabase: URL_SUPABASE, secreto, userId: U[usuario], email: email(usuario) });
      await ctx.addCookies([{ name: nombre, value: valor, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }]);
      return ctx;
    };
    const ruta = async (usuario, url) => {
      const ctx = await contexto(usuario);
      const page = await ctx.newPage();
      await page.goto(`${URL_ADMIN}${url}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const r = { ruta: new URL(page.url()).pathname, texto: (await page.locator("body").innerText()).replace(/\s+/g, " ") };
      await ctx.close();
      return r;
    };
    const captura = async (page, nombre) => {
      if (CAPTURAS) {
        fs.mkdirSync(CAPTURAS, { recursive: true });
        await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), fullPage: true });
      }
    };
    const abrirSuscripcion = async (page, tenant) => {
      await page.goto(`${URL_ADMIN}/superadmin/residenciales/${tenant}`, { waitUntil: "networkidle", timeout: 60_000 });
      await page.getByRole("button", { name: "Suscripción", exact: true }).click();
      await page.getByTestId("suscripcion-superadmin").waitFor({ timeout: 15_000 });
    };
    try {
      // 1. Prueba vencida → bloqueado
      let r = await ruta("admin_ar", "/dashboard");
      ok("01", r.ruta === "/suscripcion" && operativo(U.admin_ar, T.AR) === "f", "prueba vencida: el admin del residencial AR queda en /suscripcion (bloqueado)", `${r.ruta} op=${operativo(U.admin_ar, T.AR)}`);
      r = await ruta("admin_ar", `/superadmin/residenciales/${T.AR}`);
      ok("01", r.ruta !== `/superadmin/residenciales/${T.AR}` && !r.texto.includes("Extender prueba"), "el admin del residencial no entra a Super Admin", r.ruta);

      // 2–3. Super Admin extiende la prueba
      const ctx = await contexto("super");
      const page = await ctx.newPage();
      await abrirSuscripcion(page, T.AR);
      let t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      ok("02", t.includes("En prueba gratuita") && t.includes("Bloqueado por la suscripción") && t.includes("Extender prueba") && t.includes("Activar manualmente") && !t.includes("Extender vigencia"),
        "Super Admin: bloque «Suscripción» con estado y las dos acciones de una prueba", t.slice(0, 300));
      ok("02", t.includes("Ninguno (manual)") && t.includes("Viviendas declaradas") && t.includes("30") && t.includes(BSAS), "muestra proveedor, viviendas y la zona del residencial");
      await captura(page, "01-superadmin-prueba-vencida");
      const dPrueba = hoyAr(10);
      const bloqueP = page.getByTestId("accion-extender_prueba");
      await bloqueP.locator('input[type="date"]').fill(dPrueba);
      await bloqueP.getByRole("button", { name: "Extender prueba" }).click();
      const confP = await bloqueP.getByTestId("texto-confirmacion").innerText();
      ok("03", confP === `La prueba gratuita de este residencial se extiende hasta el ${corta(dPrueba)}. No se cobra nada.`, "confirmación antes de extender la prueba", confP);
      await bloqueP.getByRole("button", { name: "Confirmar" }).click();
      await page.locator('[data-operativa="true"]').waitFor({ timeout: 15_000 }).catch(() => null);
      const sP = sql(`select estado || '|' || (trial_ends_at = (('${dPrueba}'::date + 1)::timestamp at time zone '${BSAS}'))::text from public.suscripciones where tenant_id = '${T.AR}'`);
      ok("03", sP === "trialing|true" && (await page.locator('[data-operativa="true"]').count()) === 1, "prueba extendida: sigue trialing hasta el fin del día elegido; la pantalla dice «Puede usar Gate Flow hoy»", sP);
      ok("03", (await page.locator('[data-dato="fin-prueba"]').innerText()) === `${corta(dPrueba)} (incluido)`, "la pantalla muestra el último día de la prueba (incluido)",
        await page.locator('[data-dato="fin-prueba"]').innerText());
      r = await ruta("admin_ar", "/dashboard");
      ok("03", r.ruta === "/dashboard" && operativo(U.admin_ar, T.AR) === "t", "el residencial vuelve a operar (dashboard)", r.ruta);

      // 4. Activación manual
      const dActiva = hoyAr(30);
      const bloqueA = page.getByTestId("accion-activar");
      await bloqueA.locator('input[type="date"]').fill(dActiva);
      await bloqueA.locator("select").selectOption("hasta-50");
      await bloqueA.getByRole("button", { name: "Activar manualmente" }).click();
      const confA = (await bloqueA.locator('[role="alertdialog"]').innerText()).replace(/\s+/g, " ");
      ok("04", confA.includes(`Este residencial podrá usar Gate Flow hasta el ${corta(dActiva)}. Esta acción no genera ningún cobro automático.`) && confA.includes("No usa Stripe ni Mercado Pago"),
        "confirmación: hasta la fecha elegida, sin cobro, sin Stripe ni Mercado Pago", confA);
      await captura(page, "02-superadmin-confirmar-activacion");
      await bloqueA.getByRole("button", { name: "Confirmar" }).click();
      await page.getByTestId("accion-extender_vigencia").waitFor({ timeout: 15_000 }).catch(() => null);
      t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const sA = sql(`select concat_ws('|', estado, origen, plan, cancel_at_period_end, coalesce(provider, '-'),
                       (current_period_end = (('${dActiva}'::date + 1)::timestamp at time zone '${BSAS}'))) from public.suscripciones where tenant_id = '${T.AR}'`);
      ok("04", sA === "active|alta_manual|hasta-50|t|-|t", "activada: active, alta_manual, plan, vence al fin del día elegido, sin proveedor", sA);
      ok("04", t.includes("Activa") && t.includes(`${corta(dActiva)} (incluido)`) && t.includes("Extender vigencia") && !t.includes("Activar manualmente"), "la pantalla muestra la vigencia y solo «Extender vigencia»", t.slice(0, 300));
      r = await ruta("admin_ar", "/dashboard");
      ok("04", r.ruta === "/dashboard" && operativo(U.admin_ar, T.AR) === "t", "sigue operativo con la activación manual", r.ruta);
      r = await ruta("admin_ar", "/suscripcion");
      ok("04", r.texto.includes("Tu suscripción está activa") && r.texto.includes("Activa hasta el") && !r.texto.includes("cancelada"), "el residencial ve «Activa hasta el …», nunca «cancelada»", r.texto.slice(0, 200));

      // 5. Extender vigencia con doble clic
      const dExt = hoyAr(60);
      const bloqueV = page.getByTestId("accion-extender_vigencia");
      await bloqueV.locator('input[type="date"]').fill(dExt);
      await bloqueV.getByRole("button", { name: "Extender vigencia" }).click();
      await bloqueV.getByRole("button", { name: "Confirmar" }).dblclick();
      await page.waitForTimeout(2500);
      const aud = sql(`select count(*) filter (where accion = 'superadmin.suscripcion_vigencia_extendida') || '/' ||
                              (select (current_period_end = (('${dExt}'::date + 1)::timestamp at time zone '${BSAS}'))::text from public.suscripciones where tenant_id = '${T.AR}')
                       from public.audit_log where entidad_id = '${SUS_AR}'`);
      ok("05", aud === "1/true", "doble clic en «Confirmar» → una sola extensión auditada; nueva fecha", aud);

      // Móvil: el bloque se apila sin desbordar.
      const ctxM = await contexto("super", { width: 390, height: 844 });
      const pm = await ctxM.newPage();
      await abrirSuscripcion(pm, T.AR);
      const desborda = await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      const cajaFecha = await pm.getByTestId("accion-extender_vigencia").locator('input[type="date"]').boundingBox();
      ok("05", !desborda && Boolean(cajaFecha) && cajaFecha.x >= 0 && cajaFecha.x + cajaFecha.width <= 391, "móvil (390 px): sin desborde horizontal y el formulario cabe", `desborda=${desborda} ${JSON.stringify(cajaFecha)}`);
      await captura(pm, "03-superadmin-movil");
      await ctxM.close();

      // 6. La fecha llega al límite: se mueve el reloj (la fecha de corte pasa a "ahora").
      sql(`update public.suscripciones set current_period_end = now() - interval '1 second' where tenant_id = '${T.AR}'`);
      r = await ruta("admin_ar", "/dashboard");
      ok("06", r.ruta === "/suscripcion" && operativo(U.admin_ar, T.AR) === "f", "al llegar al vencimiento deja de operar sin cron ni webhook", `${r.ruta} op=${operativo(U.admin_ar, T.AR)}`);
      await abrirSuscripcion(page, T.AR);
      ok("06", (await page.locator('[data-operativa="false"]').count()) === 1 && (await page.getByTestId("accion-extender_vigencia").count()) === 1,
        "Super Admin ve «Bloqueado por la suscripción» y puede extender la vigencia");

      // 7–8. Billing y Stripe intactos
      ok("07", sql("select (select count(*) from public.billing_checkouts) || '/' || (select count(*) from public.billing_eventos)") === billingAntes, "ningún billing_checkout ni billing_evento creado");
      ok("07", !fs.existsSync(path.join(TMP, "stripe-bloqueos.txt")), "ninguna llamada de red a Stripe");
      await abrirSuscripcion(page, T.MX);
      t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      ok("08", t.includes("Esta suscripción está gestionada por Stripe") && (await page.locator('[data-testid^="accion-"]').count()) === 0,
        "residencial con Stripe: «gestionada por Stripe», sin acciones manuales", t.slice(0, 200));
      ok("08", huellaMx() === huellaMxAntes, "la suscripción de Stripe quedó idéntica");
      await captura(page, "04-superadmin-stripe");
      await ctx.close();

      // 9. Auditoría
      const filas = sql(`select string_agg(accion || ':' || (user_id = '${U.super}')::text || ':' || (tenant_id = '${T.AR}')::text, ',' order by created_at)
                         from public.audit_log where entidad_id = '${SUS_AR}'`);
      ok("09", filas === "superadmin.trial_extendido:true:true,superadmin.suscripcion_activada_manual:true:true,superadmin.suscripcion_vigencia_extendida:true:true",
        "auditoría: prueba extendida, activación y extensión, por el Super Admin, del residencial correcto", filas);
      const pii = sql(`select count(*) from public.audit_log where entidad_id = '${SUS_AR}' and (datos_anteriores::text || datos_nuevos::text) ~* '@|correo|nombre|telefono|token'`);
      ok("09", pii === "0", "auditoría sin datos personales ni tokens");
    } finally {
      await navegador.close();
    }
  } finally {
    // 10. Teardown por ids (siempre)
    sql(`delete from public.audit_log where tenant_id in ('${T.PLAT}', '${T.AR}', '${T.MX}');
         delete from public.user_tenants where tenant_id in ('${T.PLAT}', '${T.AR}', '${T.MX}');
         delete from public.unidades where tenant_id in ('${T.AR}', '${T.MX}');
         delete from public.suscripciones where tenant_id in ('${T.PLAT}', '${T.AR}', '${T.MX}');
         delete from public.tenants where id in ('${T.PLAT}', '${T.AR}', '${T.MX}');
         delete from public.empresas where observaciones = '${marca}';
         delete from public.users where id in ('${U.super}', '${U.admin_ar}', '${U.admin_mx}');
         delete from auth.users where id in ('${U.super}', '${U.admin_ar}', '${U.admin_mx}')`);
    ok("10", sql(HASH_TODO) === hashAntes, "teardown: base local idéntica a antes (hash)");
    detener();
    spawnSync("dropdb", ["--if-exists", DB]);
    console.log(`DURACION|${CAPA}|${Math.round((Date.now() - inicio) / 1000)}s`);
  }
}

main()
  .catch((e) => res("--", "FAIL", `excepción: ${String(e?.stack ?? e).split("\n").slice(0, 3).join(" ")}`))
  .finally(() => process.exit(fallas > 0 ? 1 : 0));
