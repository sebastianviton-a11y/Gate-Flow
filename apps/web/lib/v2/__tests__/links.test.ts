/**
 * Destinos de los CTAs "Probar gratis" / "Solicitar demo" de la landing V2
 * y redirecciones de las rutas viejas del panel.
 *   npx tsx apps/web/lib/v2/__tests__/links.test.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MODO_DEMO, V2_LINKS, ctaHref, ctaTexto, normalizarContactoDemo, normalizarUrlAdmin, preventPendingLinkClick, registroHref } from "../links";
import { RUTAS_PANEL, urlPanel } from "../rutas-panel.mjs";
import { indexable } from "../../indexacion";

let pasadas = 0;
let fallidas = 0;

function assert(condicion: boolean, mensaje: string, detalle = "") {
  if (condicion) {
    pasadas++;
  } else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}${detalle ? ` (${detalle})` : ""}`);
  }
}

const STAGING = "https://gateflow-admin-staging.netlify.app";

console.log("\nnormalizarUrlAdmin");
assert(normalizarUrlAdmin(STAGING) === STAGING, "URL válida sin cambios");
assert(normalizarUrlAdmin(`${STAGING}/`) === STAGING, "quita la / final");
assert(normalizarUrlAdmin(`  ${STAGING}  `) === STAGING, "recorta espacios");
assert(normalizarUrlAdmin(undefined) === null, "sin variable → null");
assert(normalizarUrlAdmin("") === null, "vacía → null");
assert(normalizarUrlAdmin("gateflow-admin-staging.netlify.app") === null, "sin esquema → null");
assert(normalizarUrlAdmin("javascript:alert(1)") === null, "esquema no http(s) → null");

console.log("\nregistroHref");
assert(registroHref("#d-probar", undefined, STAGING) === `${STAGING}/registro`, "hero → /registro");
assert(registroHref("#d-probar", "hasta-50", STAGING) === `${STAGING}/registro?plan=hasta-50`, "plan 50");
assert(registroHref("#m-probar", "hasta-150", STAGING) === `${STAGING}/registro?plan=hasta-150`, "plan 150");
assert(registroHref("#d-probar", "hasta-50", null) === "#d-probar", "sin URL Admin → ancla interna");

console.log("\nComponentes V2");
const V2 = join(__dirname, "..", "..", "..", "components", "v2");
for (const [archivo, ancla] of [["DesktopLandingV2.tsx", "#d-probar"], ["MobileLandingV2.tsx", "#m-probar"]] as const) {
  const s = readFileSync(join(V2, archivo), "utf8");
  const texto = s.replace(/<[^>]+>/g, " ");
  assert(!/7 d[ií]as|7 D[IÍ]AS|una semana/i.test(texto), `${archivo}: sin menciones a 7 días`);
  assert((s.match(new RegExp(`ctaHref\\("${ancla}", "hasta-50"\\)`, "g")) ?? []).length === 1, `${archivo}: un CTA plan 50`);
  assert((s.match(new RegExp(`ctaHref\\("${ancla}", "hasta-150"\\)`, "g")) ?? []).length === 1, `${archivo}: un CTA plan 150`);
  assert((s.match(new RegExp(`ctaHref\\("${ancla}"\\)`, "g")) ?? []).length === 3, `${archivo}: header, hero y CTA final → /registro (o demo)`);
  assert(!s.includes("registroHref("), `${archivo}: todos los CTAs pasan por ctaHref (modo demo)`);
  assert(!s.includes(`href="${ancla}"`), `${archivo}: ningún "Probar gratis" queda como ancla fija`);
  assert(!/>(Probar gratis|Comenzar prueba gratis)[^<{]*</.test(s) && (s.match(/>\{ctaTexto\("/g) ?? []).length === 5, `${archivo}: los 5 textos de CTA pasan por ctaTexto`);
  assert(!/aria-label="Probar gratis/.test(s), `${archivo}: aria-label de los planes también cambia en modo demo`);
  const legales = s.match(/V2_LINKS\.(privacidad|terminos)/g) ?? [];
  const protegidos = s.match(/\{MOSTRAR_LEGALES && \(<><a href=\{V2_LINKS\.privacidad\}[^]*?Términos<\/a><\/>\)\}/g) ?? [];
  assert(legales.length > 0 && legales.length === protegidos.length * 2, `${archivo}: cada enlace a Privacidad/Términos depende de MOSTRAR_LEGALES`);
  assert(/href=\{V2_LINKS\.contacto\} onClick=\{preventPendingLinkClick\} className="gf-ghost2"[^>]*>Contactar/.test(s), `${archivo}: >150 sigue en "Contactar" (V2_LINKS.contacto)`);
  assert(!/registro[^"]*plan=(?!hasta-50|hasta-150)/.test(s), `${archivo}: sin otros valores de plan`);
  assert(!/href="[^"]*gateflow\.mx/.test(s), `${archivo}: ningún link al dominio de producción`);
  // Textos honestos para Argentina: sin contratación todavía, sin borrado automático.
  assert(!/elegir un plan/i.test(texto), `${archivo}: no promete contratar al terminar`);
  assert(!/USD|US\$|\/ mes|Precios? de referencia/i.test(texto), `${archivo}: sin importes en USD (Argentina no puede contratar; México se cobra en MXN)`);
  assert(texto.includes("Durante la prueba no se cobra nada. En Argentina, por ahora solo está disponible la prueba gratuita de 30 días: la contratación todavía no está habilitada."), `${archivo}: planes: en Argentina, solo la prueba`);
  assert(texto.includes("en Argentina, la contratación todavía no está disponible"), `${archivo}: "¿Qué pasa después de los 30 días?" sin promesa de contratación`);
  assert(!/se elimina|eliminamos|se borra después/i.test(texto) && texto.includes("No se borra: al terminar la prueba o la suscripción, la información del residencial se conserva."), `${archivo}: sin eliminación automática de datos (no está implementada)`);
  assert(/30 d[ií]as gratis/i.test(texto), `${archivo}: mantiene los 30 días gratis`);
}

console.log("\nLanding publicada: la V2 en \"/\" (prueba de 30 días)");
const APP = join(__dirname, "..", "..", "..", "app");
const pagina = readFileSync(join(APP, "page.tsx"), "utf8");
assert(/import GateFlowV2 from "@\/components\/v2\/GateFlowV2"/.test(pagina) && /return <GateFlowV2 \/>/.test(pagina), "\"/\" sirve la V2");
const preview = readFileSync(join(APP, "v2-preview", "page.tsx"), "utf8");
const rutas = [pagina, readFileSync(join(APP, "layout.tsx"), "utf8"), preview];
assert(rutas.every((r) => !/components\/(DesktopLanding|MobileLanding)"|lib\/faq"/.test(r)), "ninguna ruta usa la V1 (textos de 7 días) ni su FAQ");
assert(/redirect\("\/"\)/.test(preview), "/v2-preview lleva a \"/\"");
const config = readFileSync(join(APP, "..", "next.config.mjs"), "utf8");
assert(!/VERCEL|CONTEXT|DEPLOY_PRIME_URL|NETLIFY/.test(config), "redirecciones iguales en preview y en producción (no dependen del contexto)");

console.log("\nEnlaces secundarios");
const links = readFileSync(join(__dirname, "..", "links.ts"), "utf8");
assert(/ingresar: ADMIN_APP_URL \? `\$\{ADMIN_APP_URL\}\/login` : "#"/.test(links), "Ingresar → /login del panel");
assert(/privacidad: ADMIN_APP_URL \? `\$\{ADMIN_APP_URL\}\/privacidad` : "#"/.test(links) && /terminos: ADMIN_APP_URL \? `\$\{ADMIN_APP_URL\}\/terminos` : "#"/.test(links), "Privacidad y Términos → las páginas que se aceptan en /registro");
assert(/contacto: `mailto:\$\{CORREO_SOPORTE\}/.test(links) && /soporte: `mailto:\$\{CORREO_SOPORTE\}`/.test(links), "Contacto y Soporte → correo de soporte");
const evento = (href: string) => {
  let prevenido = false;
  preventPendingLinkClick({ currentTarget: { getAttribute: () => href }, preventDefault: () => (prevenido = true) } as never);
  return prevenido;
};
assert(evento("#") && !evento("https://admin.test/login") && !evento("mailto:x@y.z"), "solo un enlace sin destino (#) se queda quieto");

console.log("\nIndexación: noindex salvo GF_LANDING_INDEXAR=1 (previews y staging)");
assert(!indexable(undefined) && !indexable("") && !indexable("true") && indexable("1"), "solo GF_LANDING_INDEXAR=1 habilita la indexación");
const robots = readFileSync(join(APP, "robots.ts"), "utf8");
assert(/if \(!indexable\(\)\) return \{ rules: \{ userAgent: "\*", disallow: "\/" \} \};/.test(robots), "robots.txt bloquea todo por defecto");
assert(/if \(!indexable\(\)\) return \[\];/.test(readFileSync(join(APP, "sitemap.ts"), "utf8")), "sin sitemap por defecto");
assert(/indexable\(\) \? \{\} : \{ robots: \{ index: false, follow: false \} \}/.test(readFileSync(join(APP, "layout.tsx"), "utf8")), "meta robots noindex por defecto");
assert(/X-Robots-Tag", value: "noindex, nofollow"/.test(readFileSync(join(APP, "..", "next.config.mjs"), "utf8")), "cabecera X-Robots-Tag noindex por defecto");

console.log("\nModo demo (NEXT_PUBLIC_LANDING_MODO=demo)");
assert(MODO_DEMO === false, "sin variable: modo de registro (staging y previews sin cambios)");
assert(ctaHref("#d-probar", "hasta-50", false) === registroHref("#d-probar", "hasta-50"), "fuera de demo: igual que antes");
assert(ctaHref("#d-probar", undefined, true) === V2_LINKS.demo && ctaHref("#m-probar", "hasta-150", true) === V2_LINKS.demo, "en demo: todos los CTAs → contacto de demo");
assert(ctaTexto("Probar gratis 30 días", false) === "Probar gratis 30 días" && ctaTexto("Comenzar prueba gratis", true) === "Solicitar demo", "texto: «Solicitar demo» solo en demo");
assert(V2_LINKS.demo === "mailto:soporte@gateflow.mx?subject=Solicitud%20de%20demo%20-%20Gate%20Flow", "contacto por defecto: el correo de soporte con asunto");
assert(normalizarContactoDemo("mailto:ventas@gateflow.mx") === "mailto:ventas@gateflow.mx" && normalizarContactoDemo(" https://wa.me/5215500000000 ") === "https://wa.me/5215500000000", "acepta mailto: y https://");
for (const malo of [undefined, "", "soporte@gateflow.mx", "http://inseguro.test", "javascript:alert(1)", "mailto:sin-arroba", "tel:+5215500000000"]) {
  assert(normalizarContactoDemo(malo) === null, `rechaza ${JSON.stringify(malo)} (queda el correo de soporte)`);
}
const fuenteLinks = readFileSync(join(__dirname, "..", "links.ts"), "utf8");
assert(/export const MOSTRAR_LEGALES = !MODO_DEMO;/.test(fuenteLinks), "en demo no se muestran Privacidad ni Términos (no hay página publicada a la que llevar)");

console.log("\nRedirecciones de las rutas viejas del panel (gateflow.mx era el Admin)");
assert(urlPanel("https://app.gateflow.mx/") === "https://app.gateflow.mx" && urlPanel(undefined) === null && urlPanel("app.gateflow.mx") === null, "urlPanel = normalizarUrlAdmin");
for (const v of ["https://app.gateflow.mx", " https://app.gateflow.mx/ ", "", "x", "javascript:1"]) {
  assert(urlPanel(v) === normalizarUrlAdmin(v), `urlPanel y normalizarUrlAdmin coinciden (${JSON.stringify(v)})`);
}
const ADMIN_APP = join(__dirname, "..", "..", "..", "..", "admin", "app");
const directorios = (d: string) => readdirSync(d).filter((n) => statSync(join(d, n)).isDirectory());
const rutasAdmin = [...directorios(ADMIN_APP), ...directorios(join(ADMIN_APP, "(app)"))].filter((n) => !n.startsWith("(") && n !== "api");
const faltan = rutasAdmin.filter((r) => !RUTAS_PANEL.includes(r));
assert(faltan.length === 0, "toda ruta de página del panel se redirige", faltan.join(", "));
const rutasLanding = directorios(APP);
assert(!RUTAS_PANEL.some((r) => rutasLanding.includes(r) || r === "v2" || r === "v2-preview"), "ninguna redirección pisa una ruta de la landing");
assert(/source: `\/\$\{ruta\}\/:resto\*`, destination: `\$\{panel\}\/\$\{ruta\}\/:resto\*`, permanent: true/.test(config) && /if \(!panel\) return \[\];/.test(config), "misma ruta en el panel; sin URL del panel, ninguna redirección");

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
