#!/usr/bin/env node
// ============================================================
// E2E LOCAL del onboarding autónomo, con datos ficticios (marca
// ZZ_AUTOTEST_ONB_) y sin salida a la red:
//   asistente que se deja («Seguir más tarde») y se retoma sin perder lo
//   configurado; progreso reconstruido desde los datos reales; tarjeta
//   «Primeros pasos» (estado real, enlaces, ocultar y volver a mostrar);
//   guías de primera visita (Unidades, Residentes, Usuarios, Bodega,
//   Paquetes y Guard) que se cierran y se reabren desde «Cómo funciona»;
//   ayuda por campo en /registro y en el asistente; página Ayuda (WhatsApp,
//   demostración opcional); aislamiento entre residenciales; celular,
//   tablet y escritorio; logs sin errores.
// Pila: Postgres local (base gf_legal_onb_e2e, creada con
// tests/legal/construir-base.sh y eliminada al final) + PostgREST +
// gateway + Admin y Guard compilados (next build/start).
//   export PGHOST=/tmp PGPORT=54329 PGUSER=postgres
//   GF_POSTGREST_BIN=/ruta/postgrest GF_PLAYWRIGHT_CORE_DIR=/ruta/con/playwright-core \
//     node tests/onboarding/run-local.mjs     # capturas en GF_OUT (o un directorio temporal)
// ============================================================
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cookieSesion, firmarJwt, iniciarGateway } from "../billing/e2e/gateway.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.GF_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "gf-onb-capturas-"));
fs.mkdirSync(OUT, { recursive: true });
const playwright = createRequire(path.join(process.env.GF_PLAYWRIGHT_CORE_DIR ?? RAIZ, "noop.js"))("playwright-core");
const DB = "gf_legal_onb_e2e";
const P = { postgrest: 3971, gateway: 3972, admin: 3973, guard: 3974 };
const URL_SUPABASE = `http://localhost:${P.gateway}`;
const ADMIN = `http://localhost:${P.admin}`;
const GUARD = `http://localhost:${P.guard}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gf-onb-"));
const sql = (q) => execFileSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", q], { encoding: "utf8" }).trim();
const procs = [];
const iniciar = (n, c, a, o) => { const l = fs.openSync(path.join(TMP, `${n}.log`), "a"); const p = spawn(c, a, { ...o, stdio: ["ignore", l, l], detached: true }); procs.push(p); return p; };
const esperar = async (u, ms = 90000) => { const t = Date.now() + ms; while (Date.now() < t) { try { const r = await fetch(u, { redirect: "manual" }); if (r.status < 500) return true; } catch {} await new Promise((r) => setTimeout(r, 300)); } return false; };
let gw;
const fin = () => { for (const p of procs) { try { process.kill(-p.pid, "SIGTERM"); } catch {} } gw?.close(); };
process.on("exit", fin);
let pasadas = 0, fallidas = 0;
const ok = (c, m, d = "") => { if (c) { pasadas++; console.log(`PASS ${m}`); } else { fallidas++; console.log(`FAIL ${m} ${String(d).slice(0, 300)}`); } };

// ── Base y fixtures ficticios ──
execFileSync("bash", [path.join(RAIZ, "tests/legal/construir-base.sh"), DB], { stdio: ["ignore", "ignore", "inherit"] });
const run = "ZZ_AUTOTEST_ONB_" + crypto.randomBytes(3).toString("hex");
const empresa = sql(`insert into public.empresas (nombre) values ('${run}') returning id`);
const tenant = (nombre, estado, onboarding) =>
  sql(`insert into public.tenants (nombre, tipo, pais, timezone, estado_servicio, onboarding_completado, empresa_id) values ('${nombre}', 'residencial', 'MX', 'America/Mexico_City', 'activo', ${onboarding}, '${empresa}') returning id`);
const T = {
  nuevo: tenant("ZZ Nuevo ficticio", "trial", false),
  lleno: tenant("ZZ Lleno ficticio", "activo", true),
  vacio: tenant("ZZ Vacio ficticio", "trial", true),
  guard: tenant("ZZ Porteria ficticio", "trial", true),
};
for (const t of [T.nuevo, T.vacio, T.guard]) {
  sql(`insert into public.suscripciones (tenant_id, estado, origen, trial_started_at, trial_ends_at, viviendas_declaradas) values ('${t}', 'trialing', 'registro_publico', now() - interval '1 day', now() + interval '29 days', 40)`);
}
sql(`insert into public.suscripciones (tenant_id, estado, origen, viviendas_declaradas) values ('${T.lleno}', 'active', 'alta_manual', null)`);
const usuario = (etiqueta, nombre) => {
  const id = crypto.randomUUID();
  const email = `zz_autotest+${run.toLowerCase()}_${etiqueta}@gateflow.invalid`;
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", "set role supabase_auth_admin", "-c", `insert into auth.users (id, email) values ('${id}', '${email}')`]);
  // Nombre como el que deja el registro (uno largo, para el encabezado en celular).
  sql(`insert into public.users (id, nombre_completo, email) values ('${id}', '${nombre}', '${email}') on conflict (id) do update set nombre_completo = excluded.nombre_completo`);
  return { id, email };
};
const membresia = (u, t, rol) => sql(`insert into public.user_tenants (user_id, tenant_id, rol_id) select '${u.id}', '${t}', id from public.roles where clave = '${rol}'`);
const U = {
  nuevo: usuario("admin_nuevo", "María Fernanda de los Ángeles Rodríguez Hernández"),
  multi: usuario("admin_multi", "Ana Pérez"),
  guardiaLleno: usuario("guardia_lleno", "Luis Gómez"),
  guardia: usuario("guardia", "Carlos Ruiz"),
};
membresia(U.nuevo, T.nuevo, "admin_residencial");
membresia(U.multi, T.lleno, "admin_residencial");
membresia(U.multi, T.vacio, "admin_residencial");
membresia(U.guardiaLleno, T.lleno, "guardia");
membresia(U.guardia, T.guard, "guardia");
// Residencial «lleno»: todos los pasos hechos (unidad con contacto, ubicación, guardia y un paquete).
for (const t of [T.lleno, T.guard]) {
  sql(`insert into public.unidades (tenant_id, tipo, identificador, contacto_nombre, contacto_telefono) values ('${t}', 'casa', 'ZZ 1', 'ZZ Residente', '5550000001')`);
  sql(`insert into public.ubicaciones (tenant_id, nombre, tipo_nodo) values ('${t}', 'ZZ Estante', 'estante')`);
}
sql(`insert into public.paquetes (tenant_id, unidad_id, ubicacion_id, recibido_por, estado_id)
     select '${T.lleno}', (select id from public.unidades where tenant_id = '${T.lleno}'), (select id from public.ubicaciones where tenant_id = '${T.lleno}'), '${U.multi.id}', 'recibido'`);
const huella = () => sql(`select md5(string_agg(x::text, '|' order by x::text)) from (
  select 'u' t, tenant_id::text, identificador, coalesce(contacto_telefono, '') c from public.unidades
  union all select 'b', tenant_id::text, nombre, tipo_nodo from public.ubicaciones
  union all select 'm', tenant_id::text, user_id::text, activo::text from public.user_tenants
  union all select 'p', tenant_id::text, id::text, estado_id from public.paquetes
  union all select 't', id::text, nombre, coalesce(telefono, '') || coalesce(correo, '') || coalesce(direccion, '') from public.tenants) x`);

// ── Pila local ──
const secreto = crypto.randomBytes(32).toString("hex");
const claveDb = crypto.randomBytes(16).toString("hex");
sql(`alter role authenticator password '${claveDb}'`);
iniciar("postgrest", process.env.GF_POSTGREST_BIN, [], { env: { ...process.env, PGRST_DB_URI: `postgres://authenticator:${claveDb}@127.0.0.1:${process.env.PGPORT}/${DB}`, PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_DB_EXTRA_SEARCH_PATH: "public, extensions", PGRST_JWT_SECRET: secreto, PGRST_SERVER_HOST: "127.0.0.1", PGRST_SERVER_PORT: String(P.postgrest), PGRST_LOG_LEVEL: "crit" } });
await esperar(`http://127.0.0.1:${P.postgrest}/`, 20000);
gw = await iniciarGateway({ puerto: P.gateway, postgrest: `http://127.0.0.1:${P.postgrest}`, secreto });
const anon = firmarJwt({ role: "anon", iss: "supabase" }, secreto);
const servicio = firmarJwt({ role: "service_role", iss: "supabase" }, secreto);
const envPublico = { NEXT_PUBLIC_SUPABASE_URL: URL_SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, NEXT_PUBLIC_ADMIN_APP_URL: ADMIN, NEXT_PUBLIC_GUARD_APP_URL: GUARD, NEXT_TELEMETRY_DISABLED: "1" };
for (const app of ["admin", "guard"]) {
  const b = spawnSync("npx", ["next", "build"], { cwd: path.join(RAIZ, "apps", app), env: { ...process.env, ...envPublico }, encoding: "utf8", timeout: 900000 });
  if (b.status !== 0) { console.log(`BUILD FAIL ${app}`, (b.stderr || b.stdout).slice(-3000)); process.exit(1); }
}
const envServidor = { ...process.env, ...envPublico, SUPABASE_SERVICE_ROLE_KEY: servicio, REGISTRO_HASH_PEPPER: crypto.randomBytes(24).toString("hex") };
iniciar("admin", "npx", ["next", "start", "-p", String(P.admin)], { cwd: path.join(RAIZ, "apps/admin"), env: envServidor });
iniciar("guard", "npx", ["next", "start", "-p", String(P.guard)], { cwd: path.join(RAIZ, "apps/guard"), env: envServidor });
await esperar(`${ADMIN}/login`);
await esperar(`${GUARD}/login`);

const nav = await playwright.chromium.launch({ args: ["--no-sandbox"] });
const VISTAS = { escritorio: { viewport: { width: 1366, height: 900 } }, tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, celular: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } };
async function contexto(base, u, vista = "escritorio") {
  const ctx = await nav.newContext(VISTAS[vista]);
  if (u) {
    const c = cookieSesion({ urlSupabase: URL_SUPABASE, secreto, userId: u.id, email: u.email });
    await ctx.addCookies([{ name: c.nombre, value: c.valor, url: base }]);
  }
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to fetch RSC payload/.test(m.text())) errores.push(m.text()); });
  return { ctx, page, errores };
}
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const texto = async (page) => (await page.locator("main, body").first().innerText().catch(() => "")).replace(/\s+/g, " ");
const elegirResidencial = (ctx, base, t) => ctx.request.post(`${base}/seleccionar-residencial/elegir`, { multipart: { tenant_id: t }, headers: { origin: base }, maxRedirects: 0 });
const huellaInicial = huella();

// ── A. Residencial nuevo: el asistente se impone la primera vez, se deja y se retoma ──
{
  const { ctx, page, errores } = await contexto(ADMIN, U.nuevo);
  await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
  ok(new URL(page.url()).pathname === "/onboarding", "A1 residencial nuevo → el asistente se muestra la primera vez", page.url());
  ok((await page.getByRole("button", { name: "Paso 1 de 6: Bienvenida" }).getAttribute("aria-current")) === "step", "A2 abre en la bienvenida");
  await page.getByRole("button", { name: /Comenzar/ }).click();
  await page.getByRole("button", { name: "Ayuda sobre Nombre comercial" }).click();
  ok(await page.getByText("Es el nombre que ven tus guardias en la app de portería").isVisible(), "A3 ayuda por campo: se abre al tocar «?»");
  await page.getByRole("button", { name: "Ayuda sobre Nombre comercial" }).click();
  ok(!(await page.getByText("Es el nombre que ven tus guardias en la app de portería").isVisible()), "A4 y se vuelve a cerrar");
  await page.getByRole("button", { name: "Paso 5 de 6: Bodega" }).click();
  ok(await page.getByText("Paso 5 de 6 — Configurar bodega").isVisible(), "A5 la barra de pasos permite saltar a cualquier paso");
  await Promise.all([page.waitForURL(`${ADMIN}/dashboard**`, { timeout: 20000 }).catch(() => null), page.getByRole("button", { name: "Seguir más tarde" }).click()]);
  ok(new URL(page.url()).pathname === "/dashboard", "A6 «Seguir más tarde» → Dashboard", page.url());
  ok(sql(`select onboarding_completado from public.tenants where id = '${T.nuevo}'`) === "t" && huella() === huellaInicial, "A7 solo deja de imponer el asistente: no cambia ni borra datos");
  await page.goto(`${ADMIN}/unidades`, { waitUntil: "networkidle" });
  ok(new URL(page.url()).pathname === "/unidades", "A8 la navegación ya no se bloquea");
  await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
  const tarjeta = page.locator("[data-primeros-pasos]");
  ok(await tarjeta.isVisible() && (await tarjeta.innerText()).includes("0 de 5 listos"), "A9 «Primeros pasos»: 0 de 5 con los datos reales");
  const enlaces = await tarjeta.locator("li a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  ok(JSON.stringify(enlaces) === JSON.stringify(["/unidades", "/residentes", "/configuracion/bodega", "/usuarios", "/paquetes/nuevo"]), "A10 cada paso enlaza a su sección", JSON.stringify(enlaces));
  // Datos reales nuevos → el avance cambia.
  sql(`insert into public.unidades (tenant_id, tipo, identificador, contacto_nombre, contacto_telefono) values ('${T.nuevo}', 'casa', 'ZZ N1', 'ZZ Contacto', '5550000002')`);
  sql(`insert into public.ubicaciones (tenant_id, nombre, tipo_nodo) values ('${T.nuevo}', 'ZZ Bodega', 'area')`);
  await page.reload({ waitUntil: "networkidle" });
  const listos = await tarjeta.locator("li[data-listo='1']").evaluateAll((ls) => ls.map((l) => l.getAttribute("data-paso")));
  ok((await tarjeta.innerText()).includes("3 de 5 listos") && JSON.stringify(listos) === JSON.stringify(["unidades", "residentes", "ubicaciones"]), "A11 tras cargar datos: 3 de 5 (unidades, residentes, bodega)", JSON.stringify(listos));
  await Promise.all([page.waitForURL(`${ADMIN}/onboarding**`, { timeout: 20000 }).catch(() => null), page.getByRole("link", { name: "Continuar con la configuración guiada" }).click()]);
  await page.waitForLoadState("networkidle");
  ok((await page.getByRole("button", { name: "Paso 4 de 6: Usuarios" }).getAttribute("aria-current")) === "step", "A12 se retoma en el primer paso pendiente (Usuarios), sin repetir la bienvenida");
  await page.getByRole("button", { name: "Paso 6 de 6: Resumen" }).click();
  await page.waitForTimeout(1500);
  const resumen = await page.locator("[data-resumen-asistente] li").evaluateAll((ls) => ls.map((l) => `${l.getAttribute("data-paso")}:${l.getAttribute("data-listo")}`));
  ok(JSON.stringify(resumen) === JSON.stringify(["unidades:1", "residentes:1", "ubicaciones:1", "guardias:0", "paquetes:0"]), "A13 el resumen usa los datos reales", JSON.stringify(resumen));
  await Promise.all([page.waitForURL(`${ADMIN}/dashboard**`, { timeout: 20000 }).catch(() => null), page.getByRole("button", { name: /Ir al Dashboard/ }).click()]);
  // Guía de primera visita (residencial en prueba): se abre sola una vez.
  await page.goto(`${ADMIN}/unidades`, { waitUntil: "networkidle" });
  ok(await page.locator("[data-guia-abierta='unidades']").isVisible(), "A14 guía de Unidades: se abre sola la primera vez");
  await page.getByRole("button", { name: "Entendido" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ok(!(await page.locator("[data-guia-abierta='unidades']").isVisible()) && (await page.locator("[data-guia='unidades']").isVisible()), "A15 no se repite en la siguiente visita; queda «Cómo funciona»");
  await page.locator("[data-guia='unidades']").click();
  ok(await page.locator("[data-guia-abierta='unidades']").isVisible(), "A16 «Cómo funciona» la vuelve a abrir");
  for (const [ruta, clave] of [["/residentes", "residentes"], ["/usuarios", "usuarios"], ["/configuracion/bodega", "bodega"], ["/paquetes", "paquetes"]]) {
    await page.goto(`${ADMIN}${ruta}`, { waitUntil: "networkidle" });
    ok(await page.locator(`[data-guia-abierta='${clave}']`).isVisible(), `A17 guía de ${clave} en su primera visita`);
  }
  // Ocultar «Primeros pasos» y volver a mostrarla desde Ayuda.
  await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
  await tarjeta.getByRole("button", { name: "Ocultar" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ok(!(await tarjeta.isVisible()), "A18 «Primeros pasos» oculta sigue oculta al volver");
  await page.goto(`${ADMIN}/ayuda`, { waitUntil: "networkidle" });
  const wa = await page.getByRole("link", { name: /Escribir por WhatsApp/ }).getAttribute("href");
  const demo = await page.getByRole("link", { name: "Pedir una demostración" }).getAttribute("href");
  ok(wa?.startsWith("https://wa.me/525523248345?text=") && demo?.startsWith("https://wa.me/525523248345?text=") && decodeURIComponent(demo).includes("demostración"), "A19 Ayuda: WhatsApp de soporte y demo", `${wa} ${demo}`);
  const ta = await texto(page);
  ok(ta.includes("+52 55 2324 8345") && ta.includes("Demostración personal (opcional)") && ta.includes("No es necesaria"), "A20 la demostración es opcional");
  ok(ta.includes("Cómo funciona Gate Flow") && ta.includes("Registrar y notificar un paquete") && ta.includes("Entregar un paquete"), "A21 procesos principales explicados");
  await page.getByRole("button", { name: "Volver a mostrar «Primeros pasos»" }).click();
  await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
  ok(await tarjeta.isVisible(), "A22 «Primeros pasos» se vuelve a mostrar desde Ayuda");
  ok(await page.locator("aside a[href='/ayuda'], nav a[href='/ayuda']").first().isVisible(), "A23 «Ayuda» en el menú lateral");
  ok(errores.length === 0, "A24 sin errores de JavaScript", JSON.stringify(errores.slice(0, 3)));
  await ctx.close();
}

// ── B. Residencial existente y completo: sin cambios en su flujo ──
{
  const { ctx, page, errores } = await contexto(ADMIN, U.multi);
  await elegirResidencial(ctx, ADMIN, T.lleno);
  await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
  ok(new URL(page.url()).pathname === "/dashboard", "B1 residencial existente entra directo al Dashboard", page.url());
  ok(!(await page.locator("[data-primeros-pasos]").isVisible()), "B2 configuración completa → sin «Primeros pasos»");
  await page.goto(`${ADMIN}/unidades`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ok(!(await page.locator("[data-guia-abierta='unidades']").isVisible()) && (await page.locator("[data-guia='unidades']").isVisible()), "B3 fuera de la prueba la guía no se abre sola, pero está «Cómo funciona»");
  // C. Aislamiento: mismo usuario en un residencial vacío (en prueba).
  await elegirResidencial(ctx, ADMIN, T.vacio);
  await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
  const t = page.locator("[data-primeros-pasos]");
  ok(await t.isVisible() && (await t.innerText()).includes("0 de 5 listos"), "C1 aislamiento: el otro residencial del mismo usuario muestra su propio avance (0 de 5)");
  ok(!(await texto(page)).includes("ZZ Lleno ficticio"), "C2 sin datos del otro residencial");
  await page.goto(`${ADMIN}/onboarding`, { waitUntil: "networkidle" });
  ok((await page.getByRole("button", { name: "Paso 3 de 6: Residentes" }).getAttribute("aria-current")) === "step", "C3 el asistente de ese residencial abre en su propio primer pendiente");
  ok(errores.length === 0, "B4 sin errores de JavaScript", JSON.stringify(errores.slice(0, 3)));
  await ctx.close();
}

// ── D. Guard: guías de registrar, entregar y página Ayuda ──
{
  const { ctx, page, errores } = await contexto(GUARD, U.guardia, "celular");
  await page.goto(`${GUARD}/guard`, { waitUntil: "networkidle" });
  ok(await page.getByRole("link", { name: /Ayuda: cómo registrar, avisar y entregar/ }).isVisible(), "D1 inicio de portería: acceso a Ayuda");
  await page.goto(`${GUARD}/guard/packages/register`, { waitUntil: "networkidle" });
  ok(await page.locator("[data-guia-abierta='guard-registrar']").isVisible(), "D2 guía «Cómo registrar un paquete» la primera vez");
  await page.getByRole("button", { name: "Entendido" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ok(!(await page.locator("[data-guia-abierta='guard-registrar']").isVisible()) && (await page.locator("[data-guia='guard-registrar']").isVisible()), "D3 no se repite; «Cómo funciona» disponible");
  await page.goto(`${GUARD}/guard/packages/deliver`, { waitUntil: "networkidle" });
  ok(await page.locator("[data-guia-abierta='guard-entregar']").isVisible(), "D4 guía «Cómo entregar un paquete»");
  await page.goto(`${GUARD}/guard/ayuda`, { waitUntil: "networkidle" });
  const tg = await texto(page);
  ok(tg.includes("Cómo registrar un paquete") && tg.includes("Cómo avisar al residente") && tg.includes("Cómo entregar un paquete") && tg.includes("+52 55 2324 8345"), "D5 Ayuda de Guard: registrar, avisar, entregar y WhatsApp");
  ok(await sinDesborde(page), "D6 Ayuda de Guard sin desborde horizontal en celular");
  ok(errores.length === 0, "D7 sin errores de JavaScript", JSON.stringify(errores.slice(0, 3)));
  await ctx.close();
}

// ── E. Registro: ayuda por campo (sin enviar el formulario) ──
{
  const { ctx, page, errores } = await contexto(ADMIN, null, "celular");
  await page.goto(`${ADMIN}/registro`, { waitUntil: "networkidle" });
  let abiertas = 0;
  for (const etiqueta of ["Correo", "Contraseña", "Nombre del residencial", "País", "Viviendas (aprox.)"]) {
    const boton = page.getByRole("button", { name: `Ayuda sobre ${etiqueta}` });
    await boton.click();
    const id = await boton.getAttribute("aria-controls");
    if (id && (await page.locator(`#${id}`).isVisible()) && (await boton.getAttribute("aria-expanded")) === "true") abiertas++;
  }
  ok(abiertas === 5, "E1 registro: las 5 ayudas se abren al tocarlas", String(abiertas));
  ok(sql(`select count(*) from public.registro_intentos`) === "0" && sql(`select count(*) from public.tenants`) === "4", "E2 abrir ayudas no envía el formulario ni crea nada");
  ok(await sinDesborde(page), "E3 registro sin desborde horizontal en celular");
  ok(errores.length === 0, "E4 sin errores de JavaScript", JSON.stringify(errores.slice(0, 3)));
  await ctx.close();
}

// ── F. Celular, tablet y escritorio ──
for (const vista of ["celular", "tablet", "escritorio"]) {
  const { ctx, page, errores } = await contexto(ADMIN, U.nuevo, vista);
  const desbordes = [];
  for (const ruta of ["/dashboard", "/onboarding", "/ayuda", "/unidades", "/usuarios", "/configuracion/bodega"]) {
    await page.goto(`${ADMIN}${ruta}`, { waitUntil: "networkidle" });
    if (!(await sinDesborde(page))) desbordes.push(ruta);
  }
  // Pasos del asistente con formularios: datos (2) y usuarios (4).
  await page.goto(`${ADMIN}/onboarding`, { waitUntil: "networkidle" });
  for (const n of [2, 4]) {
    await page.getByRole("button", { name: new RegExp(`^Paso ${n} de 6`) }).click();
    await page.waitForTimeout(300);
    if (!(await sinDesborde(page))) desbordes.push(`/onboarding paso ${n}`);
    await page.screenshot({ path: path.join(OUT, `asistente-paso${n}-${vista}.png`), fullPage: true });
  }
  if (vista === "celular") {
    const correo = await page.locator("#ob-invitar-correo").boundingBox();
    const rol = await page.locator("#ob-invitar-rol").boundingBox();
    ok(correo && rol && rol.y > correo.y + correo.height - 1 && correo.width > 250, "F1 celular: correo y rol apilados a todo el ancho", JSON.stringify({ correo, rol }));
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    ok(await page.getByRole("link", { name: "Ayuda" }).isVisible(), "F2 celular: «Ayuda» en el menú");
  }
  await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, `dashboard-${vista}.png`), fullPage: false });
  ok(desbordes.length === 0, `F3 ${vista}: sin desborde horizontal`, desbordes.join(", "));
  ok(errores.length === 0, `F4 ${vista}: sin errores de JavaScript`, JSON.stringify(errores.slice(0, 3)));
  await ctx.close();
}
{
  const { ctx, page, errores } = await contexto(GUARD, U.guardia, "tablet");
  const desbordes = [];
  for (const ruta of ["/guard", "/guard/packages/register", "/guard/packages/deliver", "/guard/ayuda"]) {
    await page.goto(`${GUARD}${ruta}`, { waitUntil: "networkidle" });
    if (!(await sinDesborde(page))) desbordes.push(ruta);
  }
  ok(desbordes.length === 0 && errores.length === 0, "F5 Guard en tablet: sin desborde ni errores", desbordes.join(", ") + JSON.stringify(errores.slice(0, 2)));
  await ctx.close();
}

ok(sql(`select count(*) from public.tenants where onboarding_completado = false`) === "0", "G1 los únicos cambios de estado fueron cerrar el asistente");
const log = ["admin", "guard"].map((a) => fs.readFileSync(path.join(TMP, `${a}.log`), "utf8")).join("\n").split("\n").filter((l) => /Error|rror:/.test(l));
ok(log.length === 0, "G2 logs de Admin y Guard sin errores", log.slice(0, 4).join(" / "));
await nav.close();
fin();
spawnSync("dropdb", ["--if-exists", DB]);
console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
process.exit(fallidas ? 1 : 0);
