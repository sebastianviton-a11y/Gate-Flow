#!/usr/bin/env node
// Landing de lanzamiento compilada (next build + start) con la configuración
// del sitio público gateflow-web: NEXT_PUBLIC_ADMIN_APP_URL=https://app.gateflow.mx,
// GF_LANDING_INDEXAR=1 y sin modo demo. Navegador en escritorio, tablet y celular:
// CTAs «Probar 30 días gratis» → https://app.gateflow.mx/registro, contacto y
// soporte por WhatsApp, legales del panel, sin precios ni correos de prueba,
// redirecciones de las rutas viejas del panel e indexación. Nada sale de la máquina.
//   GF_PLAYWRIGHT_CORE_DIR=/ruta/con/playwright-core node tests/landing/produccion-local.mjs
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), WEB = path.join(RAIZ, "apps/web");
const OUT = process.env.GF_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "gf-landing-"));
const playwright = createRequire(path.join(process.env.GF_PLAYWRIGHT_CORE_DIR ?? RAIZ, "noop.js"))("playwright-core");
const PUERTO = 3995, BASE = `http://localhost:${PUERTO}`, ADMIN = "https://app.gateflow.mx", WA = "https://wa.me/525523248345?text=";
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_ADMIN_APP_URL: ADMIN, GF_LANDING_INDEXAR: "1" };
delete env.NEXT_PUBLIC_LANDING_MODO; delete env.NEXT_PUBLIC_LANDING_CONTACTO_DEMO;
let pasadas = 0, fallidas = 0;
const ok = (c, m, d = "") => { if (c) { pasadas++; console.log(`PASS ${m}`); } else { fallidas++; console.log(`FAIL ${m} ${String(d).slice(0, 400)}`); } };
const b = spawnSync("npx", ["next", "build"], { cwd: WEB, env, encoding: "utf8", timeout: 600000 });
if (b.status !== 0) { console.log("BUILD FAIL", (b.stderr || b.stdout).slice(-3000)); process.exit(1); }
const log = fs.openSync(path.join(OUT, "start.log"), "w");
const srv = spawn("npx", ["next", "start", "-p", String(PUERTO)], { cwd: WEB, env, stdio: ["ignore", log, log], detached: true });
const fin = () => { try { process.kill(-srv.pid, "SIGTERM"); } catch {} };
process.on("exit", fin);
for (let i = 0; i < 120; i++) { try { const r = await fetch(`${BASE}/`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const nav = await playwright.chromium.launch({ args: ["--no-sandbox"] });
for (const [vista, viewport, raiz, movil] of [["escritorio", { width: 1440, height: 900 }, ".gfv2-desktop", false], ["tablet", { width: 820, height: 1180 }, null, true], ["celular", { width: 390, height: 844 }, ".gfv2-mobile", true]]) {
  const ctx = await nav.newContext({ viewport, isMobile: movil, hasTouch: movil });
  const page = await ctx.newPage();
  const errores = [], fallos = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).origin === BASE) fallos.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const r = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const et = `[${vista}]`;
  ok(r.status() === 200, `${et} la landing responde 200`);
  const sel = raiz ?? (await page.locator(".gfv2-desktop").isVisible() ? ".gfv2-desktop" : ".gfv2-mobile");
  const visible = page.locator(sel);
  const ctas = await visible.locator("a.gf-btn").evaluateAll((as) => as.map((a) => ({ t: a.textContent.trim(), h: a.getAttribute("href"), l: a.getAttribute("aria-label"), desborda: a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 2 })));
  ok(ctas.length === 5 && ctas.every((c) => c.t === "Probar 30 días gratis"), `${et} los 5 CTAs dicen «Probar 30 días gratis»`, JSON.stringify(ctas));
  ok(ctas.every((c) => /^https:\/\/app\.gateflow\.mx\/registro(\?plan=hasta-(50|150))?$/.test(c.h)), `${et} todos los CTAs → https://app.gateflow.mx/registro`, JSON.stringify(ctas.map((c) => c.h)));
  ok(ctas.every((c) => !c.desborda), `${et} el texto cabe en cada botón`, JSON.stringify(ctas.filter((c) => c.desborda)));
  const enlaces = await visible.locator("a[href]").evaluateAll((as) => as.map((a) => ({ t: a.textContent.trim(), h: a.getAttribute("href") })));
  ok(enlaces.some((e) => e.t === "Ingresar" && e.h === `${ADMIN}/login`), `${et} «Ingresar» → ${ADMIN}/login`);
  const wa = enlaces.filter((e) => e.h.startsWith(WA));
  ok(wa.length >= 2 && wa.some((e) => /Contact/.test(e.t)) && wa.some((e) => /Soporte/.test(e.t)), `${et} Contacto y Soporte → WhatsApp +52 55 2324 8345`, JSON.stringify(wa));
  ok(enlaces.some((e) => e.h === `${ADMIN}/privacidad`) && enlaces.some((e) => e.h === `${ADMIN}/terminos`), `${et} Privacidad y Términos → páginas del panel de clientes`);
  ok(enlaces.every((e) => e.h.startsWith("#") || e.h.startsWith(WA) || e.h.startsWith(`${ADMIN}/`)), `${et} todo enlace es interno, al panel de clientes o a WhatsApp`, JSON.stringify(enlaces.filter((e) => !(e.h.startsWith("#") || e.h.startsWith(WA) || e.h.startsWith(ADMIN)))));
  ok(!enlaces.some((e) => e.h === "#"), `${et} ningún enlace sin destino`);
  const texto = (await visible.innerText()).replace(/\s+/g, " ");
  ok(!/\$\s?\d|\d[\d.,]*\s?(MXN|USD|ARS)\b|US\$|\/\s?mes\b/i.test(texto), `${et} sin importes ni precios`);
  ok(!/@gmail\.com|solicitar demo/i.test(texto), `${et} sin correos de prueba ni «Solicitar demo»`);
  ok(errores.length === 0 && fallos.length === 0, `${et} sin errores de consola ni recursos fallidos`, JSON.stringify([...errores, ...fallos].slice(0, 4)));
  await page.screenshot({ path: path.join(OUT, `landing-${vista}.png`), fullPage: false });
  await page.screenshot({ path: path.join(OUT, `landing-${vista}-completa.png`), fullPage: true });
  await ctx.close();
}
await nav.close();
const get = (p) => fetch(`${BASE}${p}`, { redirect: "manual" });
for (const [p, destino] of [["/login", `${ADMIN}/login`], ["/login?next=%2Fpaquetes", `${ADMIN}/login?next=%2Fpaquetes`], ["/aceptar-invitacion?code=abc", `${ADMIN}/aceptar-invitacion?code=abc`],
  ["/restablecer-password", `${ADMIN}/restablecer-password`], ["/registro", `${ADMIN}/registro`], ["/dashboard", `${ADMIN}/dashboard`], ["/ayuda", `${ADMIN}/ayuda`], ["/terminos", `${ADMIN}/terminos`]]) {
  const r = await get(p);
  ok([301, 308].includes(r.status) && r.headers.get("location") === destino, `${p} → ${destino}`, `${r.status} ${r.headers.get("location")}`);
}
const robots = await (await get("/robots.txt")).text(); const xrt = (await get("/")).headers.get("x-robots-tag");
ok(/Allow: \//.test(robots) && /Sitemap: https:\/\/gateflow\.mx\/sitemap\.xml/.test(robots) && !xrt, "indexable: robots permite, sitemap de gateflow.mx, sin X-Robots-Tag", `${robots.replace(/\n/g, " ")} · ${xrt}`);
fin();
console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
process.exit(fallidas ? 1 : 0);
