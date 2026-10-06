/**
 * Destinos de los CTAs "Probar gratis" de la landing V2.
 *   npx tsx apps/web/lib/v2/__tests__/links.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizarUrlAdmin, registroHref } from "../links";

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
}

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
