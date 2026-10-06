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

console.log("\n31. /privacidad y /terminos existen y son rutas públicas");
for (const ruta of ["/privacidad", "/terminos", "/confirmar-cuenta"]) {
  assert((RUTAS_SIEMPRE_PUBLICAS as readonly string[]).includes(ruta), `${ruta} está en RUTAS_SIEMPRE_PUBLICAS`);
  assert(esRutaPublica(ruta), `esRutaPublica(${ruta})`);
  assert(existsSync(join(APP, ruta.slice(1), "page.tsx")), `app${ruta}/page.tsx existe`);
}
assert((RUTAS_SOLO_INVITADOS as readonly string[]).includes("/registro") && esRutaPublica("/registro"), "/registro es pública (solo invitados)");
assert(!esRutaPublica("/dashboard") && !esRutaPublica("/onboarding") && !esRutaPublica("/superadmin"), "las rutas del panel siguen protegidas");

console.log("\n32. /registro enlaza /terminos y /privacidad por separado");
const form = readFileSync(join(APP, "registro", "registro-form.tsx"), "utf8");
const enlaceTerminos = /<a href="\/terminos"[^>]*>\s*Términos y Condiciones\s*<\/a>/.test(form);
const enlacePrivacidad = /<a href="\/privacidad"[^>]*>\s*Aviso de Privacidad\s*<\/a>/.test(form);
assert(enlaceTerminos, 'enlace "Términos y Condiciones" → /terminos');
assert(enlacePrivacidad, 'enlace "Aviso de Privacidad" → /privacidad');
assert(!/Términos y Condiciones y el Aviso de Privacidad\s*<\/a>/.test(form), "no queda un solo enlace combinado");
assert((form.match(/name="aceptaTerminos"/g) ?? []).length === 1, "un solo checkbox de aceptación");

console.log("\nLa página de privacidad no redacta texto legal nuevo (misma leyenda que /terminos)");
const terminos = readFileSync(join(APP, "terminos", "page.tsx"), "utf8");
const privacidad = readFileSync(join(APP, "privacidad", "page.tsx"), "utf8");
const leyenda = "Texto de referencia — pendiente de reemplazar por el texto legal definitivo antes de comercializar.";
assert(terminos.includes(leyenda) && privacidad.includes(leyenda), "ambas páginas llevan la leyenda de referencia pendiente");

console.log("\nAviso de staging en /terminos y /privacidad (solo staging)");
assert(esEntornoStaging({ NEXT_PUBLIC_SUPABASE_URL: "https://sfuckzzqejerrifuypby.supabase.co" }), "URL de staging → staging");
assert(!esEntornoStaging({ NEXT_PUBLIC_SUPABASE_URL: "https://xlozkpygubyiuxopmdxw.supabase.co" }), "URL de producción → no staging");
assert(!esEntornoStaging({}), "sin URL → no staging (el aviso no se muestra por defecto)");
const aviso = readFileSync(join(APP, "..", "components", "shared", "aviso-staging-legal.tsx"), "utf8");
assert(aviso.includes("Documento pendiente de texto legal definitivo. No usar en producción."), "texto exacto del aviso");
assert(aviso.includes("if (!esEntornoStaging()) return null;"), "el aviso no se renderiza fuera de staging");
assert(terminos.includes("<AvisoStagingLegal />") && privacidad.includes("<AvisoStagingLegal />"), "ambas páginas incluyen el aviso");

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
