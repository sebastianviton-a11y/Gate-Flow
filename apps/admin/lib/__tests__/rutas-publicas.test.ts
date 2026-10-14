/**
 * Rutas públicas del panel Admin y enlaces legales de /registro.
 *   npx tsx apps/admin/lib/__tests__/rutas-publicas.test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { esRutaPublica, RUTAS_SIEMPRE_PUBLICAS, RUTAS_SOLO_INVITADOS } from "../rutas-publicas";
import { esEntornoStaging } from "../entorno";

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

const APP = join(__dirname, "..", "..", "app");

console.log("\n31. /privacidad, /terminos y /acuerdo-datos existen y son rutas públicas");
for (const ruta of ["/privacidad", "/terminos", "/acuerdo-datos", "/confirmar-cuenta"]) {
  assert((RUTAS_SIEMPRE_PUBLICAS as readonly string[]).includes(ruta), `${ruta} está en RUTAS_SIEMPRE_PUBLICAS`);
  assert(esRutaPublica(ruta), `esRutaPublica(${ruta})`);
  assert(existsSync(join(APP, ruta.slice(1), "page.tsx")), `app${ruta}/page.tsx existe`);
}
assert((RUTAS_SOLO_INVITADOS as readonly string[]).includes("/registro") && esRutaPublica("/registro"), "/registro es pública (solo invitados)");
assert(!esRutaPublica("/dashboard") && !esRutaPublica("/onboarding") && !esRutaPublica("/superadmin"), "las rutas del panel siguen protegidas");
assert(
  esRutaPublica("/alta-residente") && (RUTAS_SIEMPRE_PUBLICAS as readonly string[]).includes("/alta-residente") && existsSync(join(APP, "alta-residente", "page.tsx")),
  "/alta-residente (formulario de residentes) es pública con o sin sesión y existe",
);
assert(!esRutaPublica("/residentes"), "/residentes (panel) sigue protegida");

console.log("\n32. /registro enlaza /terminos y /privacidad por separado");
const form = readFileSync(join(APP, "registro", "registro-form.tsx"), "utf8");
// El enlace lleva el país elegido (?pais=MX|AR); sin país, la ruta sola (lib/legal/documentos.ts).
const enlaceTerminos = /<a href=\{enlaceLegal\("terminos"\)\}[^>]*>\s*Términos y Condiciones\s*<\/a>/.test(form);
const enlacePrivacidad = /<a href=\{enlaceLegal\("privacidad"\)\}[^>]*>\s*Aviso de Privacidad\s*<\/a>/.test(form);
assert(enlaceTerminos, 'enlace "Términos y Condiciones" → /terminos');
assert(enlacePrivacidad, 'enlace "Aviso de Privacidad" → /privacidad');
assert(form.includes("DOCUMENTOS[clave].ruta") && form.includes("hrefDocumento(clave, pais)"), "sin país elegido el enlace es la ruta sola; con país, ?pais=");
assert(!/Términos y Condiciones y el Aviso de Privacidad\s*<\/a>/.test(form), "no queda un solo enlace combinado");
assert((form.match(/name="aceptaTerminos"/g) ?? []).length === 1, "un solo checkbox de aceptación");

console.log("\nLas páginas legales no redactan texto: solo muestran versiones publicadas (o el estado pendiente)");
const paginas = ["terminos", "privacidad", "acuerdo-datos"].map((r) => readFileSync(join(APP, r, "page.tsx"), "utf8"));
const comun = readFileSync(join(APP, "..", "components", "legal", "pagina-documento-legal.tsx"), "utf8");
assert(paginas.every((p) => p.includes("<PaginaDocumentoLegal clave=")), "las tres páginas usan el componente común");
assert(
  paginas.every((p) => p.includes('export const dynamic = "force-dynamic"') && p.includes('export const fetchCache = "force-no-store"')) && comun.includes("noStore();"),
  "ni las páginas ni sus lecturas se cachean (lo vigente cambia con el tiempo)",
);
assert(paginas.every((p) => !/<p[\s>]/.test(p)), "las páginas no contienen texto legal propio");
assert(comun.includes("Documento pendiente de publicación · no definitivo"), "estado pendiente claramente no definitivo");
assert(comun.includes("createAnonServerClient()") && !comun.includes("createServiceRoleClient") && !comun.includes(".from("), "lectura anónima, solo por RPC");

console.log("\nAviso de staging en /terminos, /privacidad y /acuerdo-datos (solo staging)");
assert(esEntornoStaging({ NEXT_PUBLIC_SUPABASE_URL: "https://sfuckzzqejerrifuypby.supabase.co" }), "URL de staging → staging");
assert(!esEntornoStaging({ NEXT_PUBLIC_SUPABASE_URL: "https://xlozkpygubyiuxopmdxw.supabase.co" }), "URL de producción → no staging");
assert(!esEntornoStaging({}), "sin URL → no staging (el aviso no se muestra por defecto)");
const aviso = readFileSync(join(APP, "..", "components", "shared", "aviso-staging-legal.tsx"), "utf8");
assert(aviso.includes("Documento pendiente de texto legal definitivo. No usar en producción."), "texto exacto del aviso");
assert(aviso.includes("if (!esEntornoStaging()) return null;"), "el aviso no se renderiza fuera de staging");
assert(comun.includes("<AvisoStagingLegal />"), "las páginas legales incluyen el aviso");

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
