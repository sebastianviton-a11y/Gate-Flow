// ============================================================
// Landing V2 · navegación y desplazamiento (escenario 38).
//
// Regresión del corte superior en iPad: al ir a una sección (ancla) y
// volver, el encabezado y el comienzo del hero quedaban fuera de pantalla
// sin poder subir. Causa: el lienzo de escritorio (1440 px escalado con
// transform) vivía en un contenedor overflow:hidden con área desplazable
// sobrante; la navegación por ancla (y el foco) lo desplazaba por dentro
// y el usuario no tenía forma de devolverlo.
//
// Recorridos, en cada perfil (iPad horizontal/vertical, iPhone, desktop):
//   1. "Ver cómo funciona" (ancla del hero) → logo → comienzo completo
//   2. enlace a una sección → Atrás → se puede subir hasta el inicio y
//      bajar hasta el pie (todo accesible)
//   3. botón que sale de la landing (Ingresar) → Atrás → comienzo completo
//   4. modal de video: abrir, desplazar sobre el fondo, cerrar → la página
//      queda donde estaba, sin bloqueo de scroll y con el foco de vuelta
//   5. móvil: el encabezado queda fijo arriba al desplazar (diseño)
// Invariante en cada paso: ningún contenedor que no sea el documento queda
// desplazado por dentro (fuera del modal).
//
// Navegadores: Chromium siempre; WebKit si está instalado (si no, SKIP
// explícito, nunca PASS). Es EMULACIÓN (viewport, touch, user agent): no
// reemplaza la prueba en un iPad real con Safari.
//
// Uso directo:
//   GF_LANDING_URL=http://localhost:3965 GF_PLAYWRIGHT_CORE_DIR=… GF_CHROMIUM=… \
//   node tests/recorrido/landing-navegacion.mjs
// Dentro del recorrido corre como escenario 38 (run-local.mjs).
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const E = "38";

/** Elementos (fuera del documento y del modal) desplazados por dentro. */
function desplazadosInternos() {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".gfv2-modal")) continue;
    if (el.scrollTop || el.scrollLeft) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} (${el.scrollTop},${el.scrollLeft})`);
  }
  return out;
}

/** Estado del comienzo de la landing visible (desktop o móvil). */
function comienzo() {
  const visible = (sel) => [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null);
  const cab = visible(".gfv2-desktop nav.gf-nav") || visible(".gfv2-mobile header.gf-hdr");
  const h1 = visible("h1");
  const rc = cab?.getBoundingClientRect();
  const rh = h1?.getBoundingClientRect();
  return {
    y: Math.round(scrollY),
    cabTop: rc ? Math.round(rc.top) : null,
    h1Top: rh ? Math.round(rh.top) : null,
    h1Bottom: rh ? Math.round(rh.bottom) : null,
    innerH: innerHeight,
    anchoDoc: document.scrollingElement.scrollWidth,
    anchoVista: document.scrollingElement.clientWidth,
  };
}

export async function navegacionLanding({ playwright, url, executablePath, res, ok, captura = null }) {
  const perfiles = [
    ["iPad horizontal", playwright.devices["iPad (gen 7) landscape"]],
    ["iPad vertical", playwright.devices["iPad (gen 7)"]],
    ["iPad Pro 11 horizontal", playwright.devices["iPad Pro 11 landscape"]],
    ["iPhone 13", playwright.devices["iPhone 13"]],
    ["desktop 1366", { viewport: { width: 1366, height: 900 } }],
  ];
  const navegadores = [["chromium", playwright.chromium, executablePath ? { executablePath } : {}]];
  let webkitDisponible = false;
  try {
    webkitDisponible = fs.existsSync(playwright.webkit.executablePath());
  } catch {
    webkitDisponible = false;
  }
  if (webkitDisponible) navegadores.push(["webkit", playwright.webkit, {}]);
  else res(E, "SKIP", "WebKit no está instalado en este entorno: la navegación se validó solo con Chromium (emulación)");

  for (const [nombreNav, tipo, opcionesLanzamiento] of navegadores) {
    const navegador = await tipo.launch({ ...opcionesLanzamiento, ...(nombreNav === "chromium" ? { args: ["--no-sandbox"] } : {}) });
    try {
      for (const [nombrePerfil, perfil] of perfiles) {
        const p = `${nombreNav} · ${nombrePerfil}`;
        const ctx = await navegador.newContext(perfil);
        // Los destinos fuera de la landing (panel) se simulan: solo importa volver.
        const origen = new URL(url).origin;
        await ctx.route((u) => u.origin !== origen, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html><body><h1>Fuera de la landing</h1></body></html>" }));
        const page = await ctx.newPage();
        const tocar = async (loc) => (perfil.hasTouch ? loc.tap({ timeout: 5_000 }) : loc.click({ timeout: 5_000 }));
        const estado = () => page.evaluate(comienzo);
        const internos = () => page.evaluate(desplazadosInternos);
        const esMovil = async () => page.locator(".gfv2-mobile").isVisible();
        const comienzoCompleto = (s) => s.y === 0 && s.cabTop === 0 && s.h1Top !== null && s.h1Top > 0 && s.h1Bottom <= s.innerH && s.anchoDoc <= s.anchoVista;
        const subirComoUsuario = async () => {
          // El usuario sube hasta el tope: rueda / gesto hacia arriba.
          for (let i = 0; i < 12 && (await page.evaluate(() => scrollY)) > 0; i++) {
            if (perfil.hasTouch) await page.evaluate(() => window.scrollBy(0, -2000));
            else await page.mouse.wheel(0, -4000);
            await page.waitForTimeout(80);
          }
          await page.waitForTimeout(250);
        };
        // Cada recorrido es independiente: una falla no oculta las demás.
        const paso = async (nombre, fn) => {
          try {
            await fn();
          } catch (e) {
            res(E, "FAIL", `[${p}] ${nombre}: excepción ${String(e?.message ?? e).split("\n")[0]}`);
          }
        };
        const inicio = async () => {
          await page.goto(`${url}/`, { waitUntil: "networkidle" });
          await page.waitForTimeout(300);
        };
        const detalle = async (s) => `${JSON.stringify(s)} ${(await internos()).join(" ")}`;
        // Diseño: la sección queda arriba (en móvil, debajo del encabezado fijo: scroll-margin-top 64).
        const seccionArriba = async (id, movil) => {
          const top = await page.evaluate((x) => Math.round(document.getElementById(x).getBoundingClientRect().top), id);
          return { top, ok: movil ? top === 64 : Math.abs(top) <= 1 };
        };
        try {
          await inicio();
          const movil = await esMovil();
          const pre = movil ? "m" : "d";
          const raiz = movil ? ".gfv2-mobile" : ".gfv2-desktop";
          const logo = page.locator(movil ? `.gfv2-mobile header a[href="#m-inicio"]` : `.gfv2-desktop nav a[href="#top"]`).first();

          await paso("Ver cómo funciona → logo", async () => {
            await tocar(page.locator(`#${pre}-inicio a[href="#${pre}-como"]`).first());
            await page.waitForTimeout(700);
            const enComo = await estado();
            const sc = await seccionArriba(`${pre}-como`, movil);
            ok(E, enComo.y > 0 && sc.ok && (await internos()).length === 0, `[${p}] "Ver cómo funciona" lleva a la sección sin desplazar contenedores internos`, `sección top=${sc.top} ${await detalle(enComo)}`);
            // Móvil: el logo está en el encabezado fijo; desktop: el usuario sube hasta la barra.
            if (movil) ok(E, enComo.cabTop === 0, `[${p}] en la sección, el encabezado (con el logo) sigue visible arriba`, await detalle(enComo));
            else await subirComoUsuario();
            ok(E, (await logo.count()) === 1, `[${p}] el logo es un enlace al inicio`);
            await tocar(logo);
            await page.waitForTimeout(700);
            const s = await estado();
            ok(E, comienzoCompleto(s) && (await internos()).length === 0, `[${p}] el logo muestra el comienzo completo (encabezado y título)`, await detalle(s));
          });

          await paso("sección → Atrás", async () => {
            await inicio();
            if (movil) {
              await tocar(page.locator(".gfv2-mobile .gf-menu-b"));
              await page.waitForTimeout(300);
              await tocar(page.locator(`.gfv2-mobile .gf-mi[href="#m-precios"]`));
            } else {
              await tocar(page.locator(`.gfv2-desktop nav a[href="#d-precios"]`));
            }
            await page.waitForTimeout(700);
            const enPlanes = await estado();
            const sp = await seccionArriba(`${pre}-precios`, movil);
            ok(E, new URL(page.url()).hash === `#${pre}-precios` && enPlanes.y > 0 && sp.ok && (await internos()).length === 0, `[${p}] Planes lleva a la sección sin desplazar contenedores internos`, `${page.url()} sección top=${sp.top} ${await detalle(enPlanes)}`);
            await page.goBack();
            await page.waitForTimeout(700);
            await subirComoUsuario();
            const s = await estado();
            ok(E, comienzoCompleto(s) && (await internos()).length === 0, `[${p}] Atrás tras ir a una sección: se puede subir hasta el comienzo completo`, await detalle(s));
            const pie = await page.evaluate(() => {
              window.scrollTo(0, document.scrollingElement.scrollHeight);
              const vis = [...document.querySelectorAll(".gfv2-desktop .gf-foot, .gfv2-mobile footer, .gfv2-desktop footer, .gfv2-mobile .gf-foot")].find((e) => e.offsetParent !== null);
              const r = vis?.getBoundingClientRect();
              return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), innerH: innerHeight, y: Math.round(scrollY) } : null;
            });
            ok(E, Boolean(pie) && pie.top < pie.innerH && pie.bottom <= pie.innerH + 1, `[${p}] todo el contenido sigue accesible hasta el pie`, JSON.stringify(pie));
          });

          await paso("Ingresar → Atrás", async () => {
            await inicio();
            if (movil) {
              await tocar(page.locator(".gfv2-mobile .gf-menu-b"));
              await page.waitForTimeout(300);
            }
            const ingresar = page.locator(`${raiz} a:has-text("Ingresar"):visible`).first();
            await Promise.all([page.waitForURL((u) => !u.href.startsWith(url), { timeout: 15_000 }), tocar(ingresar)]);
            await page.goBack();
            await page.waitForTimeout(800);
            await subirComoUsuario();
            const s = await estado();
            ok(E, comienzoCompleto(s) && (await internos()).length === 0, `[${p}] Atrás tras salir de la landing: comienzo completo`, await detalle(s));
          });

          await paso("modal de video", async () => {
            await inicio();
            await page.evaluate(() => {
              const b = [...document.querySelectorAll('a[href="#video"]')].find((e) => e.offsetParent !== null);
              const r = b.getBoundingClientRect();
              window.scrollTo(0, Math.max(0, scrollY + r.top - innerHeight / 2));
            });
            await page.waitForTimeout(400);
            // La posición de referencia es la del momento del toque: Playwright
            // puede reubicar el botón antes de tocarlo (reintentos de tap).
            await page.evaluate(() => addEventListener("pointerdown", () => (window.__yToque = scrollY), { capture: true, once: true }));
            await tocar(page.locator('a[href="#video"]:visible').first());
            await page.waitForTimeout(500);
            const yAntes = await page.evaluate(() => window.__yToque);
            const abierto = await page.evaluate(() => ({ modal: document.querySelectorAll(".gfv2-modal").length, y: scrollY, foco: document.activeElement?.className }));
            ok(E, abierto.modal === 1 && abierto.y === yAntes && abierto.foco === "gfv2-close", `[${p}] abrir el video no mueve la página y el foco va a Cerrar`, `antes=${yAntes} ${JSON.stringify(abierto)}`);
            // El usuario desplaza sobre el fondo oscuro (gesto o rueda).
            await page.mouse.move(8, 8);
            await page.mouse.wheel(0, 600);
            await page.waitForTimeout(500);
            const durante = await page.evaluate(() => scrollY);
            ok(E, durante === yAntes, `[${p}] con el video abierto, la página de fondo no se desplaza`, `antes=${yAntes} durante=${durante}`);
            await tocar(page.locator(".gfv2-close"));
            await page.waitForTimeout(500);
            const tras = await page.evaluate(() => ({
              y: scrollY,
              modal: document.querySelectorAll(".gfv2-modal").length,
              overflowHtml: getComputedStyle(document.documentElement).overflow,
              overflowBody: getComputedStyle(document.body).overflow,
              foco: document.activeElement?.getAttribute("href") ?? document.activeElement?.tagName,
            }));
            ok(E, tras.modal === 0 && tras.y === yAntes && tras.overflowHtml !== "hidden" && tras.overflowBody !== "hidden" && (await internos()).length === 0,
              `[${p}] cerrar el video deja la página donde estaba y sin bloqueo de scroll`, `antes=${yAntes} ${JSON.stringify(tras)} ${(await internos()).join(" ")}`);
            ok(E, tras.foco === "#video", `[${p}] al cerrar el video el foco vuelve al botón que lo abrió`, JSON.stringify(tras));
            const yLibre = await page.evaluate(async () => {
              window.scrollBy(0, 300);
              await new Promise((r) => setTimeout(r, 200));
              return scrollY;
            });
            ok(E, yLibre > tras.y, `[${p}] tras cerrar el video se puede seguir desplazando`, `${tras.y} → ${yLibre}`);
            // Escape también cierra y libera.
            await tocar(page.locator('a[href="#video"]:visible').first());
            await page.waitForTimeout(300);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
            const esc = await page.evaluate(() => ({ modal: document.querySelectorAll(".gfv2-modal").length, overflowHtml: getComputedStyle(document.documentElement).overflow }));
            ok(E, esc.modal === 0 && esc.overflowHtml !== "hidden", `[${p}] Esc cierra el video sin dejar bloqueo de scroll`, JSON.stringify(esc));
          });

          if (movil) {
            await paso("encabezado fijo", async () => {
              await inicio();
              await page.evaluate(() => window.scrollTo(0, 1500));
              await page.waitForTimeout(300);
              const s = await estado();
              ok(E, s.cabTop === 0, `[${p}] el encabezado queda fijo arriba al desplazar (diseño: sticky)`, JSON.stringify(s));
            });
          }
          if (captura) await captura(page, `nav-${nombreNav}-${nombrePerfil.replace(/\s+/g, "-").toLowerCase()}`);
        } catch (e) {
          res(E, "FAIL", `[${p}] excepción: ${String(e?.message ?? e).split("\n")[0]}`);
        } finally {
          await ctx.close();
        }
      }
    } finally {
      await navegador.close();
    }
  }
}

// ── Uso directo ──
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.GF_LANDING_URL;
  const dir = process.env.GF_PLAYWRIGHT_CORE_DIR;
  if (!url || !dir) {
    console.log(`RESULT|landing|${E}|SKIP|faltan GF_LANDING_URL o GF_PLAYWRIGHT_CORE_DIR`);
    process.exit(0);
  }
  const playwright = createRequire(path.join(dir, "noop.js"))("playwright-core");
  let fallas = 0;
  const res = (e, estado, caso) => {
    if (estado === "FAIL") fallas++;
    console.log(`RESULT|landing|${e}|${estado}|${caso}`);
  };
  const ok = (e, cond, texto, detalle = "") => res(e, cond ? "PASS" : "FAIL", cond ? texto : `${texto} — ${String(detalle).slice(0, 600)}`);
  await navegacionLanding({ playwright, url: url.replace(/\/$/, ""), executablePath: process.env.GF_CHROMIUM, res, ok });
  process.exit(fallas ? 1 : 0);
}
