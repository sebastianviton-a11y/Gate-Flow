/**
 * Prueba gratuita para Argentina (sin red, sin base):
 *   - WhatsApp con el código de país del residencial (AR: 54 9 …; MX: 52)
 *   - Argentina sin contratación paga (servidor e interfaz); México igual
 *   - registro sin dependencia de cobro
 *   - login, invitación y dashboard sin mensajes de diagnóstico
 * El comportamiento de punta a punta (Auth real, navegador) está en
 * tests/recorrido/run-local.mjs.
 *   npx tsx apps/admin/lib/__tests__/prueba-argentina.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { construirEnlaceWhatsAppGrupo, normalizarTelefonoWhatsApp } from "@gateflow/paquetes";
import { contratacionHabilitada } from "../billing/pais";

let pasadas = 0;
let fallidas = 0;
function assert(condicion: boolean, mensaje: string) {
  if (condicion) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}
const RAIZ = join(__dirname, "../../../..");
const fuente = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

console.log("\nWhatsApp: código de país del residencial");
const ar = (t: string) => normalizarTelefonoWhatsApp(t, "AR");
assert(ar("11 2345-6789") === "5491123456789", "AR 10 dígitos (área + número) → 54 9 …");
assert(ar("011 15 2345-6789") === "5491123456789", "AR con 0 y 15 → sin el 0 ni el 15");
assert(ar("0351 15 123-4567") === "5493511234567", "AR área de 3 dígitos con 15");
assert(ar("+54 11 2345 6789") === "5491123456789", "AR +54 sin el 9 → agrega el 9 de móviles");
assert(ar("+54 9 11 2345-6789") === "5491123456789", "AR ya completo → igual");
assert(ar("12345") === null && ar("") === null, "AR irreconocible → sin enlace (nunca a otro número)");
assert(normalizarTelefonoWhatsApp("998 123 4567", "MX") === "529981234567" && normalizarTelefonoWhatsApp("998 123 4567") === "529981234567", "MX sin cambios (52 + 10 dígitos)");
assert(normalizarTelefonoWhatsApp("+52 998 123 4567", "MX") === "529981234567", "MX con 52 se respeta");
assert(construirEnlaceWhatsAppGrupo("11 2345-6789", "hola", "AR")?.url.startsWith("https://wa.me/5491123456789?text=") === true, "Guard (grupos): AR con código de país");
assert(construirEnlaceWhatsAppGrupo("998 123 4567", "hola", "MX")?.url.startsWith("https://wa.me/529981234567?text=") === true, "Guard (grupos): MX con 52 (antes iba sin código de país)");
assert(construirEnlaceWhatsAppGrupo("123", "hola", "AR") === null && construirEnlaceWhatsAppGrupo(null, "hola", "AR") === null, "Guard (grupos): sin número válido → sin enlace");
const sesion = fuente("packages/auth/src/get-session.ts");
assert(/tenants\(id, nombre, tipo, plan, activo, configuracion, empresa_id, pais, timezone\)/.test(sesion) && /pais: tenantRow\.pais/.test(sesion), "la sesión lleva el país del residencial (servidor)");
assert(/construirEnlaceWhatsAppGrupo\([^)]*session\.tenant\.pais/.test(fuente("apps/guard/app/guard/packages/register/page.tsx")), "Guard usa el país del residencial");
assert(/construirEnlaceWhatsApp\([^)]*session\.tenant\.pais/.test(fuente("apps/admin/app/(app)/paquetes/nuevo/formulario-registro.tsx")), "Admin usa el país del residencial");

console.log("\nArgentina sin contratación paga; México sin cambios");
assert(!contratacionHabilitada("AR") && contratacionHabilitada("MX") && contratacionHabilitada(null), "solo Argentina queda sin contratación");
const pagina = fuente("apps/admin/app/suscripcion/page.tsx");
assert(/const contratacion = contratacionHabilitada\(tenantSeleccionado \? await paisDeTenantServidor\(tenantSeleccionado\) : null\) && montosPublicables\(process\.env\);/.test(pagina), "/suscripcion decide con tenants.pais del servidor (y con montos publicables en el entorno)");
assert(/\) : contratacion \? \(\s*<EncabezadoPlanes/.test(pagina) && /<SinContratacion etiqueta=/.test(pagina), "vencida sin contratación → aviso (no la elección de plan)");
assert(/contratacion \? <SeccionPlanes /.test(pagina) && /\{contratacion && decision\.tipo === "permitir" && suscripcion\?\.estado === "trialing" && <SeccionPlanes/.test(pagina), "planes solo con contratación (vencida y en prueba)");
assert(pagina.includes("La contratación en línea todavía no está disponible") && pagina.includes("Tu información se conserva."), "aviso AR: no disponible + la información se conserva");
assert(pagina.includes("Durante la prueba no se cobra nada ni se pide tarjeta.") && pagina.includes("Durante la prueba no se cobra nada. Al terminar podrás elegir un plan y continuar donde lo dejaste."), "en prueba: AR sin promesa de plan; MX con su texto de siempre");
assert(/paisDelTenant\(tenantId: string\): Promise<string \| null>;/.test(fuente("apps/admin/lib/billing/checkout.ts")), "el checkout exige el país del residencial");
const registro = fuente("apps/admin/lib/registro/alta.ts") + fuente("apps/admin/app/registro/actions.ts");
assert(!/billing|mercadopago|stripe|checkout/i.test(registro), "el registro no depende de Stripe ni de precios");
assert(/defaultValue=""/.test(fuente("apps/admin/app/registro/registro-form.tsx")) && !/defaultValue="MX"/.test(fuente("apps/admin/app/registro/registro-form.tsx")), "registro: país sin preselección");

console.log("\nSin diagnósticos visibles para clientes");
for (const ruta of ["apps/admin/components/shared/login-form.tsx", "apps/guard/components/guard-login-form.tsx"]) {
  const s = fuente(ruta);
  assert(!s.includes("[DEBUG]") && !/STEP \d/.test(s) && /function mensajeErrorLogin/.test(s), `${ruta}: mensajes para personas, sin detalle técnico ni correo en consola`);
}
const invitacion = fuente("apps/admin/app/aceptar-invitacion/aceptar-invitacion-form.tsx");
assert(!invitacion.includes("DebugConsole") && !/STEP \d/.test(invitacion) && !invitacion.includes("window.location.href"), "aceptar-invitacion: sin consola en pantalla ni URL con tokens en logs");
assert(/href="\/registro"/.test(fuente("apps/admin/components/shared/login-form.tsx")), "login → enlace a la prueba gratis");
assert(!/STEP [A-Z]|user\?\.email|emailDevuelto/.test(fuente("apps/admin/app/establecer-password-action.ts")), "establecer contraseña: sin logs de diagnóstico ni correos en el servidor");
assert(!fuente("apps/admin/components/dashboard/packages-chart.tsx").includes("supabase/README"), "dashboard: gráfico vacío sin referencia técnica");

console.log("\nInvitación: perfil y destino antes de cambiar la contraseña");
// Supabase Auth cierra todas las sesiones al cambiar la contraseña con
// admin.updateUserById: lo que necesita la sesión va antes.
const enviar = invitacion.slice(invitacion.indexOf("async function handleSubmit"));
const posContrasena = enviar.indexOf("await establecerPasswordInvitado(password)");
assert(posContrasena > 0, "handleSubmit fija la contraseña");
assert(enviar.indexOf("supabase.auth.getUser()") >= 0 && enviar.indexOf("supabase.auth.getUser()") < posContrasena, "lee el usuario con la sesión todavía válida");
assert(enviar.indexOf('.from("user_tenants")') >= 0 && enviar.indexOf('.from("user_tenants")') < posContrasena, "decide Admin/Guard antes (el guardia va al login de Guard)");
assert(enviar.indexOf('.from("users")') >= 0 && enviar.indexOf('.from("users")') < posContrasena, "guarda nombre y aceptación de términos antes");

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
