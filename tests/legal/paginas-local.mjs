#!/usr/bin/env node
// ============================================================
// Páginas legales públicas (/terminos, /privacidad, /acuerdo-datos) de
// punta a punta, LOCAL y con documentos FICTICIOS, en navegador de
// escritorio (1366×900) y móvil (iPhone 13, Chromium):
//   1. Base como staging hoy (Fase 1 sin 20261015) y documentos ya
//      publicados: las páginas muestran "pendiente · no definitivo" y no
//      exponen ningún texto (anon no tiene EXECUTE).
//   2. Con 20261015: vigente por país, historial (anterior, retirada,
//      programada), documento sin publicar → pendiente, borrador /
//      aprobado / versión de otro documento → no encontrada, país por
//      URL, sin sesión y con sesión de dos residenciales (mismo
//      contenido), /registro enlaza el país elegido, /aceptar-invitacion
//      el del residencial de la invitación (o un aviso si no se puede
//      determinar; nunca México por defecto), la API
//      no abre tablas ni funciones de escritura, leer no escribe nada.
//   3. Rollback de 20261015: vuelve el estado pendiente.
// Pila: Postgres local (gf_legal_paginas) + PostgREST + gateway +
// Admin compilado (next build/start). Los documentos se cargan con el
// cargador real (scripts/legal). La base se elimina al final.
// Salida: RESULT|L-paginas|<caso>|PASS/FAIL/SKIP|texto.
//
//   PGHOST=/tmp PGPORT=54329 PGUSER=postgres GF_POSTGREST_BIN=… \
//   GF_PLAYWRIGHT_CORE_DIR=… node tests/legal/paginas-local.mjs
//   GF_LEGAL_CAPTURAS=dir → capturas PNG por página y perfil.
// ============================================================
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cookieSesion, firmarJwt, iniciarGateway } from "../billing/e2e/gateway.mjs";

const CAPA = "L-paginas";
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const DB = process.env.GF_LEGAL_PAGINAS_DB ?? "gf_legal_paginas";
const P = { postgrest: 3971, gateway: 3972, admin: 3973 };
const URL_SUPABASE = `http://localhost:${P.gateway}`;
const URL_ADMIN = `http://localhost:${P.admin}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gf-legal-paginas-"));
const MIG_LP = path.join(RAIZ, "supabase/migrations/20261015000000_documentos_legales_lectura_publica.sql");
const DOWN_LP = path.join(RAIZ, "supabase/rollback/20261015000000_documentos_legales_lectura_publica.down.sql");
const CAPTURAS = process.env.GF_LEGAL_CAPTURAS ? path.resolve(process.env.GF_LEGAL_CAPTURAS) : null;

let fallas = 0;
function res(e, estado, texto) {
  if (estado === "FAIL") fallas++;
  console.log(`RESULT|${CAPA}|${e}|${estado}|${String(texto).replace(/[|\n]/g, " ")}`);
}
const ok = (e, cond, texto, detalle = "") => res(e, cond ? "PASS" : "FAIL", cond ? texto : `${texto} — ${String(detalle).slice(0, 700)}`);

// ── Salvaguardas: solo local ──
if (!/^gf_legal_/.test(DB)) {
  res("--", "FAIL", "GF_LEGAL_PAGINAS_DB debe llamarse gf_legal_*");
  process.exit(1);
}
for (const v of [process.env.PGHOST, process.env.DATABASE_URL, process.env.PGDATABASE]) {
  if (/supabase|pooler/.test(v ?? "")) {
    res("--", "FAIL", "rechazado: el entorno apunta a Supabase; la prueba es solo local");
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
  res("--", "SKIP", "omitida: no hay Postgres local accesible (PGHOST/PGPORT/PGUSER)");
  process.exit(0);
}
if (!PGRST || !fs.existsSync(PGRST)) {
  res("--", "SKIP", "omitida: falta PostgREST (GF_POSTGREST_BIN)");
  process.exit(0);
}
let playwright = null;
try {
  const base = process.env.GF_PLAYWRIGHT_CORE_DIR ? path.resolve(process.env.GF_PLAYWRIGHT_CORE_DIR) : RAIZ;
  playwright = createRequire(path.join(base, "noop.js"))("playwright-core");
} catch {
  res("--", "SKIP", "omitida: falta playwright-core (GF_PLAYWRIGHT_CORE_DIR)");
  process.exit(0);
}

// ── Procesos ──
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
const sqlArchivo = (f) => execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", f], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const leerLog = (nombre) => {
  try {
    return fs.readFileSync(path.join(TMP, `${nombre}.log`), "utf8");
  } catch {
    return "";
  }
};
/** Recarga el caché de esquema de PostgREST tras cambiar funciones o permisos. */
async function recargarEsquema(anon) {
  sql("notify pgrst, 'reload schema'");
  await new Promise((r) => setTimeout(r, 1500));
  // Espera a que el cambio se vea (la función nueva existe o deja de existir).
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${URL_SUPABASE}/rest/v1/rpc/documentos_legales_vigentes`, { method: "POST", headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" }, body: JSON.stringify({ p_pais: "MX" }) });
    if (r.status !== 503) return;
    await new Promise((x) => setTimeout(x, 500));
  }
}
const HUELLA = `select md5(concat_ws('#',
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.documentos_legales_versiones t),
  (select count(*)::text from public.aceptaciones_legales), (select count(*)::text from public.audit_log),
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.tenants t),
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.user_tenants t)))`;

// ── Documentos ficticios (con el cargador real) ──
const en = (min) => new Date(Date.now() + min * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
function escribirDocumentos(dir) {
  const ref = '"ZZ-REF-FICTICIA-JURIDICO-001"';
  const doc = (carpeta, nombre, cab, cuerpo) => {
    fs.mkdirSync(path.join(dir, carpeta), { recursive: true });
    const lineas = Object.entries(cab).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`);
    fs.writeFileSync(path.join(dir, carpeta, nombre), `---\n${lineas.join("\n")}\n---\n${cuerpo}`);
  };
  const pub = (id, version, desde, extra = {}) => ({ identificador: id, version: `"${version}"`, jurisdicciones: ["MX"], estado: "publicado", vigente_desde: desde, aprobacion: ref, ...extra });
  const cuerpo = (titulo, marca) =>
    `# ${titulo}\n\n## 1. Objeto\n\nTexto **ficticio** de prueba (${marca}). No es un documento legal.\n\n- Punto uno ficticio\n- Punto dos ficticio\n\n## 2. Contacto\n\nEscribir a [contacto ficticio](mailto:zz@gateflow.invalid). [Enlace peligroso](javascript:alert(1)).\n\n<script>window.__inyectado = true</script>\n`;
  doc("terminos", "v0.9-mx.md", pub("terminos", "0.9", en(-4), { estado: "retirado" }), cuerpo("Términos ficticios 0.9", "ZZ_TEXTO_RETIRADO"));
  doc("terminos", "v1.0.md", pub("terminos", "1.0", en(-3), { jurisdicciones: ["MX", "AR"], resumen_cambios: '"Versión inicial ficticia"' }), cuerpo("Términos ficticios 1.0", "ZZ_TEXTO_COMUN_MX_AR"));
  doc("terminos", "v1.1-mx.md", pub("terminos", "1.1", en(-2), { resumen_cambios: '"Cambio ficticio de redacción"' }), cuerpo("Términos ficticios 1.1", "ZZ_TEXTO_VIGENTE_MX"));
  doc("terminos", "v2.0-mx.md", pub("terminos", "2.0", en(60 * 24 * 10)), cuerpo("Términos ficticios 2.0", "ZZ_TEXTO_PROGRAMADO"));
  doc("terminos", "v3.0-mx.md", { identificador: "terminos", version: '"3.0"', jurisdicciones: ["MX"], estado: "borrador" }, "# ZZ_BORRADOR_NO_PUBLICO\n");
  doc("terminos", "v3.1-mx.md", { identificador: "terminos", version: '"3.1"', jurisdicciones: ["MX"], estado: "aprobado", aprobacion: ref }, "# ZZ_APROBADO_NO_PUBLICO\n");
  doc("privacidad", "v1.0-ar.md", pub("privacidad", "1.0", en(-2), { jurisdicciones: ["AR"] }), cuerpo("Aviso ficticio AR", "ZZ_PRIVACIDAD_AR"));
  doc("dpa", "v1.0-mx.md", { identificador: "acuerdo_tratamiento", version: '"1.0"', jurisdicciones: ["MX"], estado: "aprobado", aprobacion: ref }, "# ZZ_DPA_APROBADO_NO_PUBLICO\n");
}
const SECRETOS_DE_PAGINA = ["ZZ_BORRADOR_NO_PUBLICO", "ZZ_APROBADO_NO_PUBLICO", "ZZ_DPA_APROBADO_NO_PUBLICO", "ZZ-REF-FICTICIA", "aprobado_por"];

async function main() {
  const inicio = Date.now();
  // 1. Base como staging hoy (sin 20261015) + fixtures + documentos publicados.
  execFileSync("bash", [path.join(AQUI, "construir-base.sh"), DB], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, GF_LEGAL_OMITIR_DESDE: "20261015000000" } });
  const run = `ZZ_AUTOTEST_${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}_${crypto.randomBytes(3).toString("hex")}`;
  const fix = JSON.parse(
    sql(`with e as (insert into public.empresas (nombre) values ('${run}') returning id),
      ta as (insert into public.tenants (nombre, tipo, pais, timezone, onboarding_completado, empresa_id) select '${run}_MX', 'residencial', 'MX', 'America/Mexico_City', true, id from e returning id),
      tb as (insert into public.tenants (nombre, tipo, pais, timezone, onboarding_completado, empresa_id) select '${run}_AR', 'residencial', 'AR', 'America/Argentina/Buenos_Aires', true, id from e returning id)
      select json_build_object('a', (select id from ta), 'b', (select id from tb))`),
  );
  const ua = crypto.randomUUID();
  const ub = crypto.randomUUID();
  const uab = crypto.randomUUID(); // residenciales de México y de Argentina
  const usin = crypto.randomUUID(); // sin membresía activa
  const correo = (k) => `zz_autotest+${run.toLowerCase()}-${k}@gateflow.invalid`;
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", "set role supabase_auth_admin", "-c", `insert into auth.users (id, email) values ('${ua}', '${correo("a")}'), ('${ub}', '${correo("b")}'), ('${uab}', '${correo("ab")}'), ('${usin}', '${correo("sin")}')`]);
  sql(`insert into public.user_tenants (user_id, tenant_id, rol_id) select u, t, (select id from public.roles where clave = r) from (values ('${ua}'::uuid, '${fix.a}'::uuid, 'admin_residencial'), ('${ub}'::uuid, '${fix.b}'::uuid, 'guardia'), ('${uab}'::uuid, '${fix.a}'::uuid, 'guardia'), ('${uab}'::uuid, '${fix.b}'::uuid, 'guardia')) v(u, t, r)`);
  const docs = path.join(TMP, "legal");
  escribirDocumentos(docs);
  const carga = path.join(TMP, "carga.sql");
  execFileSync(process.execPath, [path.join(RAIZ, "scripts/legal/documentos-legales.mjs"), "sql-carga", "--dir", docs, "--publicar", "--salida", carga], { stdio: ["ignore", "ignore", "pipe"] });
  sqlArchivo(carga);
  const id = (clave, pais, version) => sql(`select id from public.documentos_legales_versiones where documento_clave = '${clave}' and jurisdiccion = '${pais}' and version = '${version}'`);
  const ID = {
    mx09: id("terminos", "MX", "0.9"), mx10: id("terminos", "MX", "1.0"), mx11: id("terminos", "MX", "1.1"), mx20: id("terminos", "MX", "2.0"),
    mx30: id("terminos", "MX", "3.0"), mx31: id("terminos", "MX", "3.1"), ar10: id("terminos", "AR", "1.0"), privAr: id("privacidad", "AR", "1.0"), dpa: id("acuerdo_tratamiento", "MX", "1.0"),
  };
  ok("00", ID.mx30 === "" && ID.mx31 !== "" && ID.dpa !== "" && ID.mx11 !== "", "documentos ficticios cargados con el cargador (borrador omitido, aprobados sin publicar)");

  // 2. PostgREST + gateway + Admin.
  const secreto = crypto.randomBytes(32).toString("hex");
  const claveDb = crypto.randomBytes(16).toString("hex");
  sql(`alter role authenticator password '${claveDb}'`);
  iniciar("postgrest", PGRST, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator:${claveDb}@127.0.0.1:${process.env.PGPORT ?? 5432}/${DB}`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_DB_EXTRA_SEARCH_PATH: "public, extensions",
      PGRST_JWT_SECRET: secreto,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(P.postgrest),
      PGRST_LOG_LEVEL: "crit",
    },
  });
  if (!(await esperar(`http://127.0.0.1:${P.postgrest}/`, 20_000))) return res("--", "FAIL", "PostgREST local no arrancó");
  gateway = await iniciarGateway({ puerto: P.gateway, postgrest: `http://127.0.0.1:${P.postgrest}`, secreto });
  const anon = firmarJwt({ role: "anon", iss: "supabase" }, secreto);
  const servicio = firmarJwt({ role: "service_role", iss: "supabase" }, secreto);
  const envPublico = { NEXT_PUBLIC_SUPABASE_URL: URL_SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, NEXT_PUBLIC_ADMIN_APP_URL: URL_ADMIN, NEXT_TELEMETRY_DISABLED: "1" };
  // Siempre se compila: la clave anónima (firmada con el secreto de esta corrida) queda en el build.
  const b = spawnSync("npx", ["next", "build"], { cwd: path.join(RAIZ, "apps/admin"), env: { ...process.env, ...envPublico }, encoding: "utf8", timeout: 900_000 });
  if (b.status !== 0) return res("--", "FAIL", `next build de admin falló: ${(b.stderr || b.stdout || "").split("\n").filter(Boolean).slice(-4).join(" ")}`);
  const inicioServidor = Date.now();
  const envAdmin = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("STRIPE_") && !k.startsWith("MP_") && !k.startsWith("TURNSTILE_"))),
    ...envPublico,
    SUPABASE_SERVICE_ROLE_KEY: servicio,
    REGISTRO_HASH_PEPPER: crypto.randomBytes(24).toString("hex"),
  };
  iniciar("admin", "npx", ["next", "start", "-p", String(P.admin)], { cwd: path.join(RAIZ, "apps/admin"), env: envAdmin });
  if (!(await esperar(`${URL_ADMIN}/login`, 90_000))) return res("--", "FAIL", "Admin no arrancó");

  const huellaInicial = sql(HUELLA);
  const navegador = await playwright.chromium.launch({ ...(process.env.GF_CHROMIUM ? { executablePath: process.env.GF_CHROMIUM } : {}), args: ["--no-sandbox"] });
  try {
    // ── 1. Como staging hoy: sin la lectura pública ──
    for (const ruta of ["/terminos", "/privacidad", "/acuerdo-datos"]) {
      const r = await fetch(`${URL_ADMIN}${ruta}?pais=MX`, { redirect: "manual" });
      const html = await r.text();
      ok(`10${ruta}`, r.status === 200 && html.includes('data-estado="no_disponible"') && html.includes("Documento pendiente de publicación · no definitivo"), `${ruta} sin 20261015: estado pendiente, sin redirigir a /login`, `${r.status} ${r.headers.get("location") ?? ""}`);
      ok(`11${ruta}`, !/ZZ_TEXTO_|ZZ_PRIVACIDAD|ZZ_BORRADOR|ZZ_APROBADO|ZZ_DPA/.test(html), `${ruta} sin 20261015: ningún texto aunque haya versiones publicadas en la base`);
    }
    // Sin 20261015 la función de historial no existe: PostgREST responde PGRST202.
    const logSinLp = leerLog("admin");
    ok("12", /lectura legal no disponible \(historial\): PGRST202/.test(logSinLp) && !/ZZ_TEXTO|ZZ_AUTOTEST|zz_autotest/.test(logSinLp), "el servidor registra solo el código (PGRST202), sin contenido ni datos", logSinLp.split("\n").filter((l) => l.includes("GateFlow")).slice(-3).join(" | "));

    // ── 2. Con 20261015 ──
    sqlArchivo(MIG_LP);
    await recargarEsquema(anon);
    const perfiles = [
      { id: "escritorio", contexto: { viewport: { width: 1366, height: 900 }, locale: "es-MX", timezoneId: "America/Mexico_City" } },
      { id: "movil", contexto: { ...playwright.devices["iPhone 13"], locale: "es-MX", timezoneId: "America/Mexico_City" } },
    ];
    for (const perfil of perfiles) await paginas(navegador, perfil, ID);
    await sesiones(navegador, { secreto, ua, ub, ua_correo: correo("a"), ub_correo: correo("b") });
    await registroEInvitacion(navegador);
    await invitacion(navegador, { secreto, usuarios: { mx: [ua, correo("a")], ar: [ub, correo("b")], ab: [uab, correo("ab")], sin: [usin, correo("sin")] } });
    await api(anon, ID);
    ok("80", sql(HUELLA) === huellaInicial, "leer páginas y API no escribió nada (versiones, aceptaciones, auditoría, residenciales y membresías intactos)");

    // ── 3. Rollback de 20261015 ──
    sqlArchivo(DOWN_LP);
    await recargarEsquema(anon);
    const r = await fetch(`${URL_ADMIN}/terminos?pais=MX`);
    const html = await r.text();
    ok("91", lecturasEnCache(inicioServidor) === 0, "ninguna lectura legal quedó en la caché de datos de Next (lo vigente se decide en cada petición)", `${lecturasEnCache(inicioServidor)} entradas`);
    ok("90", r.status === 200 && html.includes('data-estado="no_disponible"') && !html.includes("ZZ_TEXTO_"), "tras el rollback de 20261015 la página vuelve a pendiente, sin texto", `${r.status} ${/data-estado="([a-z_]+)"/.exec(html)?.[1] ?? "?"} ${leerLog("admin").split("\n").filter((l) => l.includes("GateFlow")).slice(-2).join(" | ")}`);
  } catch (e) {
    res("--", "FAIL", `excepción: ${String(e?.stack ?? e).split("\n").slice(0, 3).join(" ")}`);
  } finally {
    await navegador.close();
    detener();
    spawnSync("dropdb", ["--if-exists", DB]);
    ok("99", spawnSync("psql", ["-X", "-At", "-d", "postgres", "-c", `select count(*) from pg_database where datname = '${DB}'`], { encoding: "utf8" }).stdout.trim() === "0", "base local eliminada");
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`# ${Math.round((Date.now() - inicio) / 1000)} s`);
  }
}

/** Entradas de la caché de datos de Next (apps/admin/.next/cache/fetch-cache) con lecturas legales, escritas desde `desde`. */
function lecturasEnCache(desde) {
  const dir = path.join(RAIZ, "apps/admin/.next/cache/fetch-cache");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => {
    const ruta = path.join(dir, f);
    const st = fs.statSync(ruta);
    return st.isFile() && st.mtimeMs >= desde && /documentos?_legal/.test(fs.readFileSync(ruta, "utf8"));
  }).length;
}

async function captura(page, nombre) {
  if (!CAPTURAS) return;
  fs.mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), fullPage: true }).catch(() => null);
}
const sinScrollHorizontal = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const textoDe = (page, sel) => page.locator(sel).first().innerText().catch(() => "");
const sinSecretos = (html) => SECRETOS_DE_PAGINA.every((s) => !html.includes(s));

async function paginas(navegador, perfil, ID) {
  const e = (n) => `${n}-${perfil.id}`;
  const ctx = await navegador.newContext(perfil.contexto);
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (err) => errores.push(err.message));
  try {
    // Vigente de México (sin parámetros).
    let r = await page.goto(`${URL_ADMIN}/terminos`);
    ok(e("20"), r?.status() === 200 && new URL(page.url()).pathname === "/terminos", "/terminos sin sesión: 200, sin redirigir");
    ok(e("21"), (await page.locator('[data-testid="legal-documento"]').getAttribute("data-estado")) === "publicado", "documento publicado");
    const meta = await textoDe(page, '[data-testid="legal-meta"]');
    ok(e("22"), /Versión\s+1\.1/.test(meta) && /Vigente desde el/.test(meta) && /México/.test(meta), "título, versión, vigencia y país visibles", meta);
    ok(e("23"), (await textoDe(page, "h1")) === "Términos y Condiciones" && (await textoDe(page, '[data-testid="legal-contenido"]')).includes("ZZ_TEXTO_VIGENTE_MX"), "contenido de la vigente (1.1), no de la programada");
    const situaciones = await page.locator('[data-testid="legal-historial"] li').evaluateAll((lis) => lis.map((li) => li.getAttribute("data-situacion")));
    ok(e("24"), situaciones.join(",") === "programada,vigente,anterior,retirada", "historial: programada, vigente, anterior, retirada", situaciones.join(","));
    const html = await page.content();
    ok(e("25"), sinSecretos(html), "ni el borrador, ni los aprobados sin publicar, ni la referencia de aprobación aparecen");
    ok(e("26"), !(await page.evaluate(() => "__inyectado" in window)) && (await page.locator('[data-testid="legal-contenido"] script').count()) === 0 && (await page.locator('[data-testid="legal-contenido"] a[href^="javascript"]').count()) === 0, "el texto no inyecta HTML ni enlaces javascript:");
    ok(e("27"), (await page.locator('[data-testid="legal-contenido"] a[href="mailto:zz@gateflow.invalid"]').count()) === 1 && (await page.locator('[data-testid="legal-contenido"] h2').count()) === 1 && (await page.locator('[data-testid="legal-contenido"] h3').count()) === 2 && (await page.locator('[data-testid="legal-contenido"] li').count()) === 2, "Markdown seguro: # → h2 (el h1 es el de la página), ## → h3, listas y enlace mailto");
    ok(e("28"), await sinScrollHorizontal(page), "sin scroll horizontal");
    ok(e("29"), (await page.locator('[data-testid="legal-paises"] a[aria-current="true"]').innerText()) === "México", "selector de país: México marcado");
    await captura(page, `terminos-mx-${perfil.id}`);

    // Historial: versión retirada → aviso y vuelta a la vigente.
    await page.locator('[data-testid="legal-historial"] li[data-situacion="retirada"] a').click();
    await page.waitForURL(/version=/);
    ok(e("30"), page.url().includes(`version=${ID.mx09}`) && (await page.locator('[data-testid="legal-aviso-retirada"]').isVisible()) && (await textoDe(page, '[data-testid="legal-contenido"]')).includes("ZZ_TEXTO_RETIRADO"), "versión retirada consultada desde el historial, marcada como retirada");
    ok(e("31"), /Versión\s+0\.9/.test(await textoDe(page, '[data-testid="legal-meta"]')) && (await textoDe(page, '[data-testid="legal-aviso-retirada"]')).includes("no es la vigente"), "la retirada dice que no es la vigente");
    await captura(page, `terminos-retirada-${perfil.id}`);
    await page.locator('[data-testid="legal-aviso-retirada"] a').click();
    await page.waitForURL((u) => !u.searchParams.has("version"));
    ok(e("32"), /Versión\s+1\.1/.test(await textoDe(page, '[data-testid="legal-meta"]')), "«Ver la versión vigente» vuelve a la 1.1");

    await page.goto(`${URL_ADMIN}/terminos?pais=MX&version=${ID.mx10}`);
    ok(e("33"), await page.locator('[data-testid="legal-aviso-anterior"]').isVisible(), "versión anterior marcada como anterior");
    await page.goto(`${URL_ADMIN}/terminos?pais=MX&version=${ID.mx20}`);
    ok(e("34"), (await page.locator('[data-testid="legal-aviso-programada"]').isVisible()) && /Entra en vigor el/.test(await textoDe(page, '[data-testid="legal-meta"]')), "versión programada: publicada pero todavía no vigente");

    // País.
    await page.goto(`${URL_ADMIN}/terminos?pais=AR`);
    ok(e("40"), /Versión\s+1\.0/.test(await textoDe(page, '[data-testid="legal-meta"]')) && /Argentina/.test(await textoDe(page, '[data-testid="legal-meta"]')) && (await textoDe(page, '[data-testid="legal-contenido"]')).includes("ZZ_TEXTO_COMUN_MX_AR"), "?pais=AR: la vigente de Argentina (1.0)");
    ok(e("41"), (await page.locator('[data-testid="legal-historial"] li').count()) === 1 && (await page.locator('[data-testid="legal-paises"] a[aria-current="true"]').innerText()) === "Argentina", "historial y selector de Argentina");
    await page.locator('[data-testid="legal-paises"] a', { hasText: "México" }).click();
    await page.waitForURL(/pais=MX/);
    ok(e("42"), /Versión\s+1\.1/.test(await textoDe(page, '[data-testid="legal-meta"]')), "el selector cambia a México");
    await page.goto(`${URL_ADMIN}/terminos?pais=MX&version=${ID.ar10}`);
    ok(e("43"), (await page.locator('[data-testid="legal-paises"] a[aria-current="true"]').innerText()) === "Argentina" && (await page.locator('[data-testid="legal-historial"] li').count()) === 1, "una versión de Argentina pedida con ?pais=MX se muestra como de Argentina");
    await page.goto(`${URL_ADMIN}/terminos?pais=BR`);
    ok(e("44"), /México/.test(await textoDe(page, '[data-testid="legal-meta"]')), "país no admitido → México");

    // Pendientes y versiones que no deben verse.
    await page.goto(`${URL_ADMIN}/acuerdo-datos`);
    ok(e("50"), (await page.locator('[data-testid="legal-documento"]').getAttribute("data-estado")) === "pendiente" && (await textoDe(page, '[data-testid="legal-pendiente"]')).includes("no definitivo") && sinSecretos(await page.content()), "/acuerdo-datos (solo aprobado) → pendiente · no definitivo, sin texto");
    ok(e("51"), (await page.locator('[data-testid="legal-historial"]').count()) === 0 && (await textoDe(page, "h1")) === "Acuerdo de Tratamiento de Datos", "sin historial; título del acuerdo");
    ok(e("52"), await sinScrollHorizontal(page), "pendiente sin scroll horizontal");
    await captura(page, `acuerdo-pendiente-${perfil.id}`);
    await page.goto(`${URL_ADMIN}/privacidad?pais=MX`);
    ok(e("53"), (await page.locator('[data-testid="legal-documento"]').getAttribute("data-estado")) === "pendiente", "/privacidad MX (solo publicado en AR) → pendiente; no usa el de otro país");
    await page.goto(`${URL_ADMIN}/privacidad?pais=AR`);
    ok(e("54"), (await textoDe(page, '[data-testid="legal-contenido"]')).includes("ZZ_PRIVACIDAD_AR"), "/privacidad AR → publicado");
    for (const [caso, version, texto] of [
      ["55", ID.mx31, "aprobado sin publicar"],
      ["56", ID.dpa, "acuerdo aprobado"],
      ["57", ID.privAr, "versión de otro documento"],
      ["58", crypto.randomUUID(), "id inexistente"],
    ]) {
      await page.goto(`${URL_ADMIN}/terminos?pais=MX&version=${version}`);
      ok(e(caso), (await page.locator('[data-testid="legal-documento"]').getAttribute("data-estado")) === "version_no_encontrada" && sinSecretos(await page.content()) && !(await page.content()).includes("ZZ_PRIVACIDAD_AR"), `?version= de un ${texto} → no encontrada, sin texto`);
    }
    await page.goto(`${URL_ADMIN}/terminos?version=no-es-un-uuid`);
    ok(e("59"), /Versión\s+1\.1/.test(await textoDe(page, '[data-testid="legal-meta"]')), "?version= mal formado → la vigente");

    // Navegación entre documentos conserva el país.
    await page.goto(`${URL_ADMIN}/terminos?pais=AR`);
    const hrefs = await page.locator('nav[aria-label="Documentos legales"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    ok(e("60"), hrefs.join(",") === "/terminos?pais=AR,/privacidad?pais=AR,/acuerdo-datos?pais=AR", "pie: los tres documentos, con el país", hrefs.join(","));
    ok(e("61"), errores.length === 0, "sin errores de JavaScript", errores.join(" | "));
  } finally {
    await ctx.close();
  }
}

/** Con sesión (admin de un residencial, guardia de otro) se ve exactamente lo mismo que sin sesión. */
async function sesiones(navegador, { secreto, ua, ub, ua_correo, ub_correo }) {
  const contenido = async (cookie) => {
    const ctx = await navegador.newContext({ viewport: { width: 1366, height: 900 } });
    if (cookie) await ctx.addCookies([{ name: cookie.nombre, value: cookie.valor, url: URL_ADMIN }]);
    const page = await ctx.newPage();
    const r = await page.goto(`${URL_ADMIN}/terminos?pais=MX`);
    const salida = {
      status: r?.status(),
      ruta: new URL(page.url()).pathname,
      articulo: await page.locator('[data-testid="legal-documento"]').innerHTML(),
      historial: await page.locator('[data-testid="legal-historial"]').innerHTML(),
    };
    await ctx.close();
    return salida;
  };
  const sin = await contenido(null);
  const a = await contenido(cookieSesion({ urlSupabase: URL_SUPABASE, secreto, userId: ua, email: ua_correo }));
  const b = await contenido(cookieSesion({ urlSupabase: URL_SUPABASE, secreto, userId: ub, email: ub_correo }));
  ok("70", a.status === 200 && b.status === 200 && a.ruta === "/terminos" && b.ruta === "/terminos", "con sesión (residencial MX y residencial AR) la página se abre sin redirigir");
  ok("71", sin.articulo === a.articulo && a.articulo === b.articulo && sin.historial === a.historial && a.historial === b.historial, "sin sesión, admin del residencial MX y guardia del residencial AR ven exactamente el mismo documento e historial");
  ok("72", ![ua, ub].some((u) => a.articulo.includes(u) || b.articulo.includes(u)) && !/ZZ_AUTOTEST_\d/.test(a.articulo + b.articulo), "la página no muestra datos de la sesión ni del residencial");
}

async function registroEInvitacion(navegador) {
  for (const perfil of [
    { id: "escritorio", contexto: { viewport: { width: 1366, height: 900 } } },
    { id: "movil", contexto: { ...playwright.devices["iPhone 13"] } },
  ]) {
    const ctx = await navegador.newContext(perfil.contexto);
    const page = await ctx.newPage();
    try {
      await page.goto(`${URL_ADMIN}/registro`);
      const terminos = page.locator("label", { has: page.locator('input[name="aceptaTerminos"]') }).locator("a", { hasText: "Términos y Condiciones" });
      const privacidad = page.locator("label", { has: page.locator('input[name="aceptaTerminos"]') }).locator("a", { hasText: "Aviso de Privacidad" });
      ok(`75-${perfil.id}`, (await terminos.getAttribute("href")) === "/terminos" && (await privacidad.getAttribute("href")) === "/privacidad" && (await page.locator('input[name="aceptaTerminos"]').count()) === 1, "/registro: sin país elegido, enlaces a /terminos y /privacidad; un solo checkbox");
      await page.selectOption("#pais", "AR");
      ok(`76-${perfil.id}`, (await terminos.getAttribute("href")) === "/terminos?pais=AR" && (await privacidad.getAttribute("href")) === "/privacidad?pais=AR", "/registro con Argentina: los enlaces llevan ?pais=AR");
      const [nueva] = await Promise.all([ctx.waitForEvent("page"), terminos.click()]);
      await nueva.waitForLoadState();
      ok(`77-${perfil.id}`, /Argentina/.test(await textoDe(nueva, '[data-testid="legal-meta"]')) && (await textoDe(nueva, '[data-testid="legal-contenido"]')).includes("ZZ_TEXTO_COMUN_MX_AR"), "el enlace abre (pestaña nueva) los Términos de Argentina");
      await nueva.close();
      await page.selectOption("#pais", "MX");
      ok(`78-${perfil.id}`, (await terminos.getAttribute("href")) === "/terminos?pais=MX", "/registro con México: ?pais=MX");
      ok(`79-${perfil.id}`, await sinScrollHorizontal(page), "/registro sin scroll horizontal");
    } finally {
      await ctx.close();
    }
  }
}

/** Id de una server action en el build de Admin (como la llamaría el formulario). */
function idAccion(ruta, nombre) {
  const pagina = path.join(RAIZ, `apps/admin/.next/server/app/${ruta}/page.js`);
  if (!fs.existsSync(pagina)) return null;
  return new RegExp(`[{,]"?([0-9a-f]{40})"?:\\(\\)=>Promise\\.resolve\\(\\)\\.then\\([^)]*\\)\\)\\.then\\(\\w+=>\\w+\\.${nombre}\\)`).exec(fs.readFileSync(pagina, "utf8"))?.[1] ?? null;
}

/**
 * /aceptar-invitacion: los Términos son los del país del residencial de la
 * invitación (membresías activas de la sesión, leídas en el servidor). Sin
 * país determinado: estado claro, sin enlace y sin poder aceptar.
 */
async function invitacion(navegador, { secreto, usuarios }) {
  const abrir = async ([id, email], perfil = { viewport: { width: 1366, height: 900 } }) => {
    const ctx = await navegador.newContext(perfil);
    const c = cookieSesion({ urlSupabase: URL_SUPABASE, secreto, userId: id, email });
    await ctx.addCookies([{ name: c.nombre, value: c.valor, url: URL_ADMIN }]);
    const page = await ctx.newPage();
    await page.goto(`${URL_ADMIN}/aceptar-invitacion`);
    await page.locator('input[type="checkbox"]').waitFor({ timeout: 15_000 });
    // Espera a que el servidor responda (enlace o aviso).
    await page.locator('label a:has-text("términos y condiciones"), [data-testid="invitacion-pais-indeterminado"]').first().waitFor({ timeout: 15_000 });
    return { ctx, page };
  };
  const terminosAceptados = (id) => sql(`select terminos_aceptados_en is not null from public.users where id = '${id}'`);

  for (const [caso, clave, pais, nombre, version, marca, perfil] of [
    ["7A", "mx", "MX", "México", "1.1", "ZZ_TEXTO_VIGENTE_MX", { ...playwright.devices["iPhone 13"] }],
    ["7B", "ar", "AR", "Argentina", "1.0", "ZZ_TEXTO_COMUN_MX_AR", { viewport: { width: 1366, height: 900 } }],
  ]) {
    const { ctx, page } = await abrir(usuarios[clave], perfil);
    try {
      const enlace = page.locator('label a:has-text("términos y condiciones")');
      ok(`${caso}a`, (await enlace.getAttribute("href")) === `/terminos?pais=${pais}` && (await page.locator("label").filter({ has: page.locator('input[type="checkbox"]') }).innerText()).includes(`(${nombre})`), `/aceptar-invitacion, residencial de ${nombre}: enlace a los Términos de ${nombre}`);
      ok(`${caso}b`, await page.locator('input[type="checkbox"]').isEnabled(), "el checkbox se puede marcar");
      const [nueva] = await Promise.all([ctx.waitForEvent("page"), enlace.click()]);
      await nueva.waitForLoadState();
      ok(`${caso}c`, new RegExp(`Versión\\s+${version.replace(".", "\\.")}`).test(await textoDe(nueva, '[data-testid="legal-meta"]')) && (await textoDe(nueva, '[data-testid="legal-contenido"]')).includes(marca), `se abren los Términos vigentes de ${nombre} (${version})`);
      ok(`${caso}d`, await sinScrollHorizontal(page), "sin scroll horizontal");
      await captura(page, `invitacion-${clave}-${perfil.viewport.width < 800 ? "movil" : "escritorio"}`);
    } finally {
      await ctx.close();
    }
  }

  // El navegador no puede cambiar el país: la acción no tiene argumentos y los que se le envíen se ignoran.
  const id = idAccion("aceptar-invitacion", "paisDeLaInvitacion");
  if (!id) {
    ok("7E", false, "no se encontró la server action paisDeLaInvitacion en el build");
  } else {
    const c = cookieSesion({ urlSupabase: URL_SUPABASE, secreto, userId: usuarios.mx[0], email: usuarios.mx[1] });
    const r = await fetch(`${URL_ADMIN}/aceptar-invitacion`, {
      method: "POST",
      headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", cookie: `${c.nombre}=${c.valor}` },
      body: JSON.stringify(["AR", { pais: "AR", tenant_id: crypto.randomUUID() }]),
    });
    const cuerpo = await r.text();
    ok("7E", r.status === 200 && cuerpo.includes('"pais":"MX"') && !cuerpo.includes('"pais":"AR"'), "llamar la acción con un país o residencial falsificado no cambia nada (sigue México)", `${r.status} ${cuerpo.slice(-160)}`);
    const sinSesion = await fetch(`${URL_ADMIN}/aceptar-invitacion`, { method: "POST", headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, body: "[]" });
    ok("7F", (await sinSesion.text()).includes('"motivo":"sin_sesion"'), "sin sesión, la acción no devuelve ningún país");
  }

  // Residenciales de dos países: no se elige uno.
  {
    const { ctx, page } = await abrir(usuarios.ab, { ...playwright.devices["iPhone 13"] });
    try {
      const aviso = page.locator('[data-testid="invitacion-pais-indeterminado"]');
      ok("7G", (await aviso.isVisible()) && (await page.locator('label a:has-text("términos y condiciones")').count()) === 0 && (await page.locator('input[type="checkbox"]').isDisabled()), "residenciales de México y Argentina → aviso claro, sin enlace y sin poder marcar el checkbox (no se supone México)");
      ok("7H", (await aviso.innerText()).includes("Pide a quien te invitó") && (await aviso.locator("button").count()) === 0, "no es pasajero: sin «Reintentar», con a quién acudir");
      await page.locator("#ai-nombre").fill("Persona Ficticia");
      await page.locator("#ai-password").fill("ZzFicticia-123");
      await page.locator("#ai-password2").fill("ZzFicticia-123");
      await page.getByRole("button", { name: /Crear contraseña y continuar/ }).click();
      await page.waitForTimeout(800);
      ok("7I", new URL(page.url()).pathname === "/aceptar-invitacion" && (await page.locator(".text-destructive").innerText()).includes("No pudimos confirmar el país") && terminosAceptados(usuarios.ab[0]) === "f", "enviar igual no hace nada: ni aceptación guardada ni contraseña");
      await captura(page, "invitacion-indeterminado-movil");
    } finally {
      await ctx.close();
    }
  }
  {
    const { ctx, page } = await abrir(usuarios.sin);
    try {
      ok("7J", (await page.locator('[data-testid="invitacion-pais-indeterminado"]').isVisible()) && (await page.locator('label a:has-text("términos y condiciones")').count()) === 0, "sin membresía activa → aviso claro, sin enlace");
    } finally {
      await ctx.close();
    }
  }

  // Error al leer (permiso retirado un momento) → «Reintentar»; al volver, el enlace correcto.
  sql("revoke select on public.user_tenants from authenticated");
  try {
    const { ctx, page } = await abrir(usuarios.ar);
    try {
      const boton = page.locator('[data-testid="invitacion-pais-indeterminado"] button', { hasText: "Reintentar" });
      ok("7K", (await boton.isVisible()) && (await page.locator('input[type="checkbox"]').isDisabled()), "error de lectura → aviso con «Reintentar», sin poder aceptar");
      sql("grant select on public.user_tenants to authenticated");
      await boton.click();
      await page.locator('label a:has-text("términos y condiciones")').waitFor({ timeout: 15_000 });
      ok("7L", (await page.locator('label a:has-text("términos y condiciones")').getAttribute("href")) === "/terminos?pais=AR" && (await page.locator('input[type="checkbox"]').isEnabled()), "tras «Reintentar», el enlace de Argentina y el checkbox habilitado");
    } finally {
      await ctx.close();
    }
  } finally {
    sql("grant select on public.user_tenants to authenticated");
  }
  ok("7M", ["mx", "ar", "ab", "sin"].every((k) => terminosAceptados(usuarios[k][0]) === "f"), "abrir la invitación no registra ninguna aceptación");
  ok("7N", /aceptar-invitacion: país del residencial no determinado \((varios_paises|sin_membresia|error)\)/.test(leerLog("admin")) && !Object.values(usuarios).some(([u, e]) => leerLog("admin").includes(u) || leerLog("admin").includes(e)), "el servidor registra solo el motivo, sin ids ni correos");
}

/** La API pública solo expone las tres lecturas; nada de tablas ni escrituras. */
async function api(anon, ID) {
  const h = { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" };
  const rpc = (fn, body) => fetch(`${URL_SUPABASE}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  let r = await rpc("documentos_legales_historial", { p_clave: "terminos", p_pais: "MX" });
  const filas = await r.json();
  ok("81", r.status === 200 && Array.isArray(filas) && filas.length === 4 && !JSON.stringify(filas).includes("ZZ_") && !("aprobado_por" in (filas[0] ?? {})), "anon: historial por la API, sin borradores, aprobados ni quién aprobó");
  r = await rpc("documento_legal_publicado", { p_version_id: ID.mx31 });
  ok("82", r.status === 200 && (await r.json()).length === 0, "anon: un aprobado sin publicar no se devuelve ni pidiéndolo por id");
  for (const [caso, tabla] of [["83", "documentos_legales_versiones"], ["84", "aceptaciones_legales"], ["85", "requisitos_legales"], ["86", "documentos_legales"]]) {
    r = await fetch(`${URL_SUPABASE}/rest/v1/${tabla}?select=*`, { headers: h });
    const cuerpo = await r.text();
    ok(caso, r.status >= 400 && !cuerpo.includes("ZZ_"), `anon no lee la tabla ${tabla} (${r.status})`, cuerpo);
  }
  r = await fetch(`${URL_SUPABASE}/rest/v1/documentos_legales_versiones?id=eq.${ID.mx31}`, { method: "PATCH", headers: h, body: JSON.stringify({ estado: "publicado" }) });
  ok("87", r.status >= 400 && sql(`select estado from public.documentos_legales_versiones where id = '${ID.mx31}'`) === "aprobado", "anon no puede publicar modificando la tabla");
  for (const [caso, fn, body] of [
    ["88", "documentos_pendientes", { p_tenant_id: crypto.randomUUID() }],
    ["89", "registrar_aceptaciones", { p_tenant_id: crypto.randomUUID(), p_version_ids: [ID.mx11], p_origen: "registro" }],
  ]) {
    r = await rpc(fn, body);
    ok(caso, r.status >= 400, `anon no llama ${fn} (${r.status})`);
  }
}

main()
  .catch((e) => res("--", "FAIL", `excepción: ${String(e?.stack ?? e).split("\n").slice(0, 3).join(" ")}`))
  .finally(() => {
    detener();
    process.exitCode = fallas > 0 ? 1 : 0;
  });
