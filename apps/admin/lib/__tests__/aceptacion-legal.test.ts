/**
 * Aceptación de documentos legales (Fase 3): qué se muestra, qué se
 * envía, cuándo se pide aceptar de nuevo y cómo se leen los errores de la
 * base. Más las garantías del código de /registro y /aceptar-invitacion.
 *   npx tsx apps/admin/lib/__tests__/aceptacion-legal.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOCUMENTOS_INVITACION,
  DOCUMENTOS_REGISTRO,
  documentosMostrados,
  errorDeAceptacion,
  leerVersionIds,
  mismasVersiones,
  type FilaVigente,
} from "../legal/aceptacion";
import { leerCampos, validarRegistro, type CamposCrudos } from "../registro/validacion";

let pasadas = 0;
let fallidas = 0;
function assert(condicion: boolean, mensaje: string) {
  if (condicion) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}

const T = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const R = "44444444-4444-4444-8444-444444444444";
const filas: FilaVigente[] = [
  { version_id: A, documento_clave: "acuerdo_tratamiento", titulo: "Acuerdo de Tratamiento de Datos", version: "1.0" },
  { version_id: R, documento_clave: "aviso_residentes", titulo: "Aviso para residentes", version: "1.0" },
  { version_id: P.toUpperCase(), documento_clave: "privacidad", titulo: "Aviso de Privacidad", version: "2.0" },
  { version_id: T, documento_clave: "terminos", titulo: "Términos y Condiciones", version: "1.1" },
];

console.log("\nQué se muestra");
const reg = documentosMostrados(filas, DOCUMENTOS_REGISTRO);
assert(reg.map((d) => d.clave).join(",") === "terminos,privacidad,acuerdo_tratamiento", "registro: Términos, Aviso y Acuerdo, en ese orden (sin el aviso de residentes)");
assert(reg[1]?.versionId === P, "los uuid se normalizan a minúsculas");
const inv = documentosMostrados(filas, DOCUMENTOS_INVITACION);
assert(inv.map((d) => d.clave).join(",") === "terminos,privacidad", "invitación: solo los personales (el Acuerdo es del residencial)");
assert(documentosMostrados(null, DOCUMENTOS_REGISTRO).length === 0 && documentosMostrados([], DOCUMENTOS_REGISTRO).length === 0, "sin documentos publicados: nada que mostrar");
assert(documentosMostrados([{ version_id: "x", documento_clave: "terminos", titulo: "T", version: "1" }], DOCUMENTOS_REGISTRO).length === 0, "una fila con id inválido se ignora");

console.log("\nQué se envía");
assert(leerVersionIds([T, P])?.join(",") === `${T},${P}`, "uuids válidos");
assert(leerVersionIds([])?.length === 0 && leerVersionIds(undefined)?.length === 0, "lista vacía o ausente → []");
assert(leerVersionIds([T, T]) === null, "repetidos → null");
assert(leerVersionIds(["no-uuid"]) === null && leerVersionIds([42]) === null, "valores que no son uuid → null");
assert(leerVersionIds(Array.from({ length: 11 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`)) === null, "más de 10 → null");

console.log("\nCuándo hay que aceptar de nuevo");
assert(mismasVersiones([T, P], [P, T]), "mismo conjunto en otro orden → iguales");
assert(!mismasVersiones([T], [T, P]), "se publicó un documento nuevo → distinto");
assert(!mismasVersiones([T, P], [T]), "se retiró uno → distinto");
assert(mismasVersiones([], []), "sin documentos ni ids → iguales (hoy)");
assert(mismasVersiones([T.toUpperCase()], [T]), "mayúsculas indiferentes");

console.log("\nErrores de la base");
assert(errorDeAceptacion("22023 crear_cuenta_prueba: documento_cambiado") === "actualizados", "documento_cambiado → actualizados");
assert(errorDeAceptacion("22023 aceptar_documentos_invitacion: aceptacion_faltante (privacidad)") === "actualizados", "aceptacion_faltante → actualizados");
assert(errorDeAceptacion("crear_cuenta_prueba: falta_declaracion_facultades") === "declaracion", "falta_declaracion_facultades → declaracion");
assert(errorDeAceptacion("crear_cuenta_prueba: documento_no_disponible (terminos)") === "no_disponible", "documento_no_disponible → no_disponible");
assert(errorDeAceptacion("23505 duplicate key") === null && errorDeAceptacion(null) === null, "otros errores → null");

console.log("\nEl formulario de registro manda versiones y declaración");
const form = new FormData();
for (const [k, v] of Object.entries({ nombreCompleto: "Ana Pérez", email: "ana@x.com", password: "contraseña-1", nombreResidencial: "Res X", pais: "MX", viviendas: "10", aceptaTerminos: "on", timezone: "", sitio_web: "", t: "x" })) form.set(k, v);
form.append("version_ids", T);
form.append("version_ids", P);
form.set("declaraFacultades", "on");
const crudos = leerCampos(form);
assert(crudos.version_ids?.join(",") === `${T},${P}` && crudos.declaraFacultades === "on", "leerCampos lee todas las version_ids y la declaración");
const val = validarRegistro(crudos);
assert(val.ok && val.datos.versionIds.join(",") === `${T},${P}` && val.datos.declaraFacultades, "validarRegistro las entrega normalizadas");
const sinNada = validarRegistro({ ...crudos, version_ids: undefined, declaraFacultades: undefined } as CamposCrudos);
assert(sinNada.ok && sinNada.datos.versionIds.length === 0 && !sinNada.datos.declaraFacultades, "sin version_ids ni declaración: [] y false (compatibilidad)");

console.log("\nGarantías del código");
const APP = join(__dirname, "..", "..", "app");
const regForm = readFileSync(join(APP, "registro", "registro-form.tsx"), "utf8");
const regPage = readFileSync(join(APP, "registro", "page.tsx"), "utf8");
const regAccion = readFileSync(join(APP, "registro", "actions.ts"), "utf8");
const invForm = readFileSync(join(APP, "aceptar-invitacion", "aceptar-invitacion-form.tsx"), "utf8");
const invAccion = readFileSync(join(APP, "aceptar-invitacion", "actions.ts"), "utf8");
assert(regForm.includes('name="version_ids" value={d.versionId}') && regForm.includes("mostrados.map("), "registro: cada versión mostrada viaja oculta en el formulario");
assert(regForm.includes('name="declaraFacultades"') && regForm.includes("{acuerdo && ("), "registro: la declaración de facultades solo aparece con el Acuerdo publicado");
assert(regForm.includes("hrefDocumento(clave, pais, doc.versionId)"), "registro: los enlaces abren exactamente la versión que se acepta");
assert(regForm.includes('case "documentos":') && regForm.includes("setRondaAceptacion((n) => n + 1)"), "registro: si cambian, se muestran los nuevos y las casillas se desmarcan");
assert(regPage.includes('rpc("documentos_legales_vigentes"') && regPage.includes("createAnonServerClient()"), "registro: la página lee lo vigente (lectura pública)");
assert(regAccion.includes("p_version_ids: versionIds") && regAccion.includes("p_declara_facultades: declaraFacultades"), "registro: la RPC del alta recibe versiones y declaración");
assert(!invForm.includes("terminos_aceptados_en"), "invitación: el navegador ya no escribe terminos_aceptados_en");
assert(invForm.includes(".update({ nombre_completo: nombreCompleto.trim() })"), "invitación: el navegador solo guarda el nombre");
assert(
  invForm.indexOf("await aceptarDocumentosDeLaInvitacion(") > 0 && invForm.indexOf("await aceptarDocumentosDeLaInvitacion(") < invForm.indexOf("await establecerPasswordInvitado(password)"),
  "invitación: la aceptación se registra ANTES de fijar la contraseña",
);
assert(/if \(!aceptacion\.ok\) \{[\s\S]*?setEstado\("lista"\);\s*return;/.test(invForm), "invitación: si no se registra, no continúa");
assert(invAccion.includes('rpc("aceptar_documentos_invitacion"') && invAccion.includes('.eq("user_id", user.id).eq("activo", true)') && !invAccion.includes("createServiceRoleClient"), "invitación: residenciales de la sesión (RLS) y RPC con la sesión, sin clave de servicio");
assert(/export async function aceptarDocumentosDeLaInvitacion\(versionIds: string\[\]\)/.test(invAccion), "invitación: el navegador solo envía versiones, nunca el residencial");

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
