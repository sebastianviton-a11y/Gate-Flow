/**
 * Destinos de los CTAs "Probar gratis" de la landing V2.
 *   npx tsx apps/web/lib/v2/__tests__/links.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizarUrlAdmin, preventPendingLinkClick, registroHref } from "../links";
import { indexable } from "../../indexacion";

let pasadas = 0;
let fallidas = 0;

function assert(condicion: boolean, mensaje: string) {
  if (condicion) {
    pasadas++;
  } else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
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
  assert((s.match(new RegExp(`registroHref\\("${ancla}", "hasta-50"\\)`, "g")) ?? []).length === 1, `${archivo}: un CTA plan 50`);
  assert((s.match(new RegExp(`registroHref\\("${ancla}", "hasta-150"\\)`, "g")) ?? []).length === 1, `${archivo}: un CTA plan 150`);
  assert((s.match(new RegExp(`registroHref\\("${ancla}"\\)`, "g")) ?? []).length === 3, `${archivo}: header, hero y CTA final → /registro`);
  assert(!s.includes(`href="${ancla}"`), `${archivo}: ningún "Probar gratis" queda como ancla fija`);
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
assert(!/redirects\(/.test(readFileSync(join(APP, "..", "next.config.mjs"), "utf8")), "sin redirecciones solo-preview: lo mismo en preview y en producción");

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

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
