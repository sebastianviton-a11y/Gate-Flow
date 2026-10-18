/**
 * /aceptar-invitacion: los documentos legales son los del país del
 * residencial de la invitación, decidido en el servidor. Datos ficticios.
 *   npx tsx apps/admin/lib/__tests__/legal-invitacion.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paisDeMembresias, reintentable } from "../legal/pais-invitacion";

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

const fila = (pais: string | null) => ({ tenant_id: "t", tenants: { pais } });
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("\nPaís de las membresías activas");
assert(igual(paisDeMembresias(null, [fila("MX")]), { estado: "ok", pais: "MX" }), "residencial de México → MX");
assert(igual(paisDeMembresias(null, [fila("AR")]), { estado: "ok", pais: "AR" }), "residencial de Argentina → AR");
assert(igual(paisDeMembresias(null, [fila("AR"), fila("AR")]), { estado: "ok", pais: "AR" }), "dos residenciales del mismo país → ese país");
assert(igual(paisDeMembresias(null, [{ tenant_id: "t", tenants: [{ pais: "AR" }] }]), { estado: "ok", pais: "AR" }), "relación como arreglo");
assert(igual(paisDeMembresias(null, [fila("MX"), fila("AR")]), { estado: "indeterminado", motivo: "varios_paises" }), "residenciales de países distintos → indeterminado (no se elige uno)");
assert(igual(paisDeMembresias(null, []), { estado: "indeterminado", motivo: "sin_membresia" }), "sin membresía activa → indeterminado (no México)");
assert(igual(paisDeMembresias({ code: "42501" }, null), { estado: "indeterminado", motivo: "error" }), "error de lectura → indeterminado");
assert(igual(paisDeMembresias(null, null), { estado: "indeterminado", motivo: "error" }), "respuesta vacía → indeterminado");
assert(igual(paisDeMembresias(null, [{ tenant_id: "t", tenants: null }]), { estado: "indeterminado", motivo: "sin_pais" }), "residencial ilegible → indeterminado");
assert(igual(paisDeMembresias(null, [fila("")]), { estado: "indeterminado", motivo: "sin_pais" }), "país vacío → indeterminado");
assert(igual(paisDeMembresias(null, [fila("BR")]), { estado: "indeterminado", motivo: "pais_no_admitido" }), "país no admitido → indeterminado");
assert(igual(paisDeMembresias(null, [fila("mx")]), { estado: "indeterminado", motivo: "pais_no_admitido" }), "sin normalizaciones que inventen un país");
assert(reintentable("error") && reintentable("sin_sesion") && !reintentable("varios_paises") && !reintentable("sin_membresia"), "solo lo pasajero ofrece reintentar");

console.log("\nEl país lo decide el servidor, no el navegador");
const APP = join(__dirname, "..", "..", "app", "aceptar-invitacion");
const accion = readFileSync(join(APP, "actions.ts"), "utf8");
const form = readFileSync(join(APP, "aceptar-invitacion-form.tsx"), "utf8");
assert(accion.startsWith('"use server";') && /export async function paisDeLaInvitacion\(\): Promise<PaisInvitacion>/.test(accion), "server action sin argumentos (no se le puede pasar país ni residencial)");
assert(accion.includes("supabase.auth.getUser()") && accion.includes("createServerSupabaseClient()") && !accion.includes("createServiceRoleClient"), "valida la sesión con getUser() y lee con RLS (sin clave de servicio)");
assert(/\.eq\("user_id", user\.id\)\.eq\("activo", true\)/.test(accion), "solo las membresías activas del usuario de la sesión");
assert(!/console\.error\([^)]*(user\.|email|id\b)/.test(accion), "el log no lleva datos de la persona");
assert(form.includes("await paisDeLaInvitacion()") && !/paisDeLaInvitacion\([^)]/.test(form), "el formulario pide el país sin enviar nada");
assert(!form.includes('href="/terminos"') && form.includes('hrefDocumento("terminos", paisLegal.pais)') && form.includes('hrefDocumento("terminos", paisLegal.pais, terminos.versionId)'), "el enlace usa el país del servidor y, si hay versión vigente, esa versión exacta");
assert(form.includes('disabled={paisLegal?.estado !== "ok"}'), "sin país, el checkbox no se puede marcar");
assert(form.includes('if (paisLegal?.estado !== "ok") {') && form.indexOf('if (paisLegal?.estado !== "ok") {') < form.indexOf("if (!aceptaTerminos) {"), "sin país, no se envía");
assert(form.includes('data-testid="invitacion-pais-indeterminado"') && form.includes("No pudimos confirmar el país de tu residencial."), "estado claro cuando no hay país");

console.log("\nAceptación (Fase 3): la fecha la fija el servidor");
assert(form.includes(".update({ nombre_completo: nombreCompleto.trim() })") && !form.includes("terminos_aceptados_en"), "el navegador guarda solo el nombre; la fecha de aceptación la fija el servidor (aceptar_documentos_invitacion)");
assert(form.includes("const resultado = await establecerPasswordInvitado(password);"), "la contraseña se sigue estableciendo igual");
assert((form.match(/type="checkbox"/g) ?? []).length === 1 && form.includes("if (!aceptaTerminos) {"), "un solo checkbox, obligatorio como antes");
assert(!/pais/i.test(form.slice(form.indexOf(".update({"), form.indexOf(".eq(\"id\", userData.user.id)"))), "el país no se guarda ni se envía con la aceptación");

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
