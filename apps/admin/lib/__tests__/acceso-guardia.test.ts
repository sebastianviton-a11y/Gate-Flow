/**
 * Destino por rol al autenticarse en Admin: guardia → app Guard, sin
 * abrirle el panel. Sin framework:
 *   npx tsx apps/admin/lib/__tests__/acceso-guardia.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  destinoPanelAdmin,
  destinoTrasAutenticar,
  mostrarCtaGuard,
  redirigeAGuard,
  urlAppGuard,
} from "../acceso-panel";

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

function seccion(nombre: string, fn: () => void) {
  console.log(`\n${nombre}`);
  fn();
}

const GUARD = "https://gateflow-guard-staging.netlify.app";
const ADMIN = "https://gateflow-admin-staging.netlify.app";
const TENANT_OK = { onboarding_completado: true, estado_servicio: "piloto" };
const SUSPENDIDO = { onboarding_completado: true, estado_servicio: "suspendido" };
const membresia = (clave: unknown, tenants: unknown = TENANT_OK) => ({ roles: clave === undefined ? null : { clave }, tenants });
/** Igual que el middleware: NextResponse.redirect(new URL(destino, request.url)). */
const resolver = (destino: string, desde = `${ADMIN}/dashboard`) => new URL(destino, desde).href;

const ADMIN_DIR = join(__dirname, "..", "..");
const fuente = (ruta: string) => readFileSync(join(ADMIN_DIR, ruta), "utf8");

seccion("urlAppGuard (NEXT_PUBLIC_GUARD_APP_URL)", () => {
  assert(urlAppGuard(GUARD) === GUARD, "URL válida");
  assert(urlAppGuard(`${GUARD}/`) === GUARD, "quita la / final");
  assert(urlAppGuard(undefined) === null && urlAppGuard("") === null, "sin variable → null");
  assert(urlAppGuard("gateflow-guard-staging.netlify.app") === null, "sin esquema → null");
  assert(urlAppGuard("javascript:alert(1)") === null, "esquema no http(s) → null");
  assert(urlAppGuard(`${GUARD}/guard`) === null, "con ruta → null (debe ser solo el origen)");
});

seccion("1. guardia autenticado entrando a Admin → Guard", () => {
  const destino = destinoPanelAdmin(null, membresia("guardia"), GUARD);
  assert(destino === `${GUARD}/guard`, `middleware → ${destino}`);
  for (const ruta of ["/", "/dashboard", "/paquetes", "/configuracion", "/usuarios"]) {
    assert(resolver(destino!, `${ADMIN}${ruta}`) === `${GUARD}/guard`, `desde ${ruta} el redirect es absoluto a Guard`);
  }
  // /login y /superadmin, /onboarding: la sesión activa en /login va a
  // /dashboard (y de ahí a Guard); requireRole manda a /dashboard.
  const mw = fuente("middleware.ts");
  assert(mw.includes('if (user && esSoloInvitados) {\n    return NextResponse.redirect(new URL("/dashboard", request.url));'), "con sesión, /login → /dashboard → Guard");
  assert(mw.includes("const destino = destinoPanelAdmin(error, membership);") && mw.includes("NextResponse.redirect(new URL(destino, request.url))"), "el middleware usa destinoPanelAdmin");
  const layout = fuente("app/(app)/layout.tsx");
  assert(layout.includes('redirect(destinoPanelAdmin(error, membership) ?? "/sin-acceso?motivo=rol");'), "el layout de (app) usa destinoPanelAdmin (mismo orden que el middleware)");
  assert(layout.includes(".select(SELECT_MEMBRESIA_PANEL)") && /\.eq\("activo", true\)/.test(layout), "el layout lee la misma membresía activa");
});

seccion("2/3. admin_residencial y super_admin permanecen en Admin", () => {
  for (const rol of ["admin_residencial", "super_admin"]) {
    assert(destinoPanelAdmin(null, membresia(rol), GUARD) === null, `${rol} pasa el middleware`);
    assert(!redirigeAGuard(null, membresia(rol), GUARD), `${rol} no va a Guard`);
    const tras = destinoTrasAutenticar(null, membresia(rol), { admin: "/dashboard", guard: "/login" }, GUARD);
    assert(!tras.enGuard && tras.url === "/dashboard", `${rol} tras login → /dashboard`);
  }
});

seccion("4. sin membresía → /sin-acceso", () => {
  assert(destinoPanelAdmin(null, null, GUARD) === "/sin-acceso", "null → /sin-acceso");
  assert(destinoPanelAdmin(null, undefined, GUARD) === "/sin-acceso", "undefined → /sin-acceso");
  assert(!redirigeAGuard(null, null, GUARD), "sin membresía no va a Guard");
});

seccion("5. guardia inactivo → /sin-acceso", () => {
  // La consulta filtra activo=true: una membresía inactiva llega como null.
  for (const archivo of ["middleware.ts", "app/sin-acceso/page.tsx", "components/shared/login-form.tsx", "app/aceptar-invitacion/aceptar-invitacion-form.tsx"]) {
    assert(/\.eq\("activo", true\)/.test(fuente(archivo)), `${archivo} filtra activo=true`);
  }
  assert(destinoPanelAdmin(null, null, GUARD) === "/sin-acceso", "guardia inactivo → /sin-acceso");
});

seccion("4b. rol desconocido, error o URL de Guard sin configurar → /sin-acceso", () => {
  for (const rol of ["supervisor", "recepcion", "residente", "admin_empresa", "rol_desconocido", "GUARDIA", " guardia"]) {
    assert(destinoPanelAdmin(null, membresia(rol), GUARD) === "/sin-acceso?motivo=rol", `${JSON.stringify(rol)} → /sin-acceso?motivo=rol`);
  }
  assert(destinoPanelAdmin({ code: "42501" }, membresia("guardia"), GUARD) === "/sin-acceso?motivo=error", "error de lectura → /sin-acceso?motivo=error");
  assert(destinoPanelAdmin(null, membresia("guardia", null), GUARD) === "/sin-acceso?motivo=error", "tenant ilegible → /sin-acceso?motivo=error");
  assert(destinoPanelAdmin(null, membresia("guardia"), null) === "/sin-acceso?motivo=rol", "sin NEXT_PUBLIC_GUARD_APP_URL → /sin-acceso?motivo=rol");
});

seccion("6. /sin-acceso?motivo=rol muestra el CTA a Guard solo a un guardia real", () => {
  assert(mostrarCtaGuard("rol", null, membresia("guardia"), GUARD), "guardia activo → CTA");
  assert(!mostrarCtaGuard("rol", null, membresia("residente"), GUARD), "otro rol → sin CTA");
  assert(!mostrarCtaGuard("rol", null, membresia("admin_residencial"), GUARD), "admin → sin CTA");
  assert(!mostrarCtaGuard("rol", null, null, GUARD), "sin membresía / inactivo → sin CTA");
  assert(!mostrarCtaGuard("rol", { code: "PGRST" }, membresia("guardia"), GUARD), "error → sin CTA");
  assert(!mostrarCtaGuard("rol", null, membresia("guardia"), null), "sin URL de Guard → sin CTA");
  assert(!mostrarCtaGuard(undefined, null, membresia("guardia"), GUARD) && !mostrarCtaGuard("error", null, membresia("guardia"), GUARD), "otro motivo → sin CTA");
  const pagina = fuente("app/sin-acceso/page.tsx");
  assert(pagina.includes("Ir a la app de Guardia") && pagina.includes("{ctaGuard && ("), "la página condiciona el CTA");
  assert(pagina.includes("<CerrarSesionButton />"), "Cerrar sesión se mantiene");
  assert(!/redirect\(/.test(pagina), "/sin-acceso nunca redirige (sin bucles)");
  assert(pagina.includes("} catch {\n    return false;"), "cualquier error al leer la sesión → sin CTA");
});

seccion("7. aceptación de invitación de guardia termina en Guard", () => {
  const rutas = { admin: "/login?password_created=1", guard: "/login?password_created=1" };
  const g = destinoTrasAutenticar(null, membresia("guardia"), rutas, GUARD);
  assert(g.enGuard && g.url === `${GUARD}/login?password_created=1`, `guardia → ${g.url}`);
  const a = destinoTrasAutenticar(null, membresia("admin_residencial"), rutas, GUARD);
  assert(!a.enGuard && a.url === "/login?password_created=1", "admin → login de Admin (sin cambios)");
  const e = destinoTrasAutenticar({ code: "x" }, membresia("guardia"), rutas, GUARD);
  assert(!e.enGuard, "error → flujo de Admin (el middleware decide /sin-acceso)");
  const form = fuente("app/aceptar-invitacion/aceptar-invitacion-form.tsx");
  assert(/destino = destinoTrasAutenticar\(errorMembresia, membership, \{\s*admin: "\/login\?password_created=1",\s*guard: "\/login\?password_created=1",/.test(form), "el formulario usa destinoTrasAutenticar");
  assert(form.indexOf("destinoTrasAutenticar(") < form.indexOf("await supabase.auth.signOut();"), "el rol se lee antes de cerrar la sesión de invitación");
  assert(form.includes("window.location.assign(destino.url);"), "navega a Guard (otro dominio)");
});

seccion("8. login normal de guardia termina en Guard", () => {
  const rutas = { admin: "/dashboard", guard: "/login" };
  const g = destinoTrasAutenticar(null, membresia("guardia"), rutas, GUARD);
  assert(g.enGuard && g.url === `${GUARD}/login`, `guardia → ${g.url}`);
  assert(!destinoTrasAutenticar(null, null, rutas, GUARD).enGuard, "sin membresía → Admin (/sin-acceso vía middleware)");
  assert(!destinoTrasAutenticar(null, membresia("rol_x"), rutas, GUARD).enGuard, "rol desconocido → Admin (/sin-acceso vía middleware)");
  const form = fuente("components/shared/login-form.tsx");
  assert(form.includes('destinoTrasAutenticar(errorMembresia, membership, { admin: next, guard: "/login" })'), "el login usa destinoTrasAutenticar");
  assert(form.includes('await supabase.auth.signOut({ scope: "local" });'), "cierra solo la sesión local de Admin (no la de Guard)");
  assert(form.indexOf('signOut({ scope: "local" })') < form.indexOf("window.location.assign(destino.url);"), "cierra la sesión antes de ir a Guard");
});

seccion("9. guardia + tenant suspendido → NO Guard", () => {
  assert(destinoPanelAdmin(null, membresia("guardia", SUSPENDIDO), GUARD) === "/residencial-suspendido", "middleware/layout → /residencial-suspendido");
  assert(!redirigeAGuard(null, membresia("guardia", SUSPENDIDO), GUARD), "redirigeAGuard = false");
  const login = destinoTrasAutenticar(null, membresia("guardia", SUSPENDIDO), { admin: "/dashboard", guard: "/login" }, GUARD);
  assert(!login.enGuard && login.url === "/dashboard", "login → flujo de Admin (el middleware manda a /residencial-suspendido)");
  const inv = destinoTrasAutenticar(null, membresia("guardia", SUSPENDIDO), { admin: "/login?password_created=1", guard: "/login?password_created=1" }, GUARD);
  assert(!inv.enGuard && inv.url === "/login?password_created=1", "invitación → login de Admin, no Guard");
  assert(destinoPanelAdmin(null, membresia("guardia", { onboarding_completado: false, estado_servicio: "suspendido" }), GUARD) === "/residencial-suspendido", "suspendido también con onboarding pendiente");
});

seccion("10. admin_residencial + tenant suspendido → comportamiento anterior", () => {
  assert(destinoPanelAdmin(null, membresia("admin_residencial", SUSPENDIDO), GUARD) === "/residencial-suspendido", "admin_residencial → /residencial-suspendido");
  assert(destinoPanelAdmin(null, membresia("super_admin", SUSPENDIDO), GUARD) === null, "super_admin sigue entrando (soporte)");
  assert(destinoPanelAdmin(null, membresia("admin_residencial", { onboarding_completado: false, estado_servicio: "suspendido" }), GUARD) === "/residencial-suspendido", "la suspensión sigue antes que el onboarding");
});

seccion("11. /sin-acceso de tenant suspendido → sin CTA a Guard", () => {
  assert(!mostrarCtaGuard("rol", null, membresia("guardia", SUSPENDIDO), GUARD), "guardia de residencial suspendido → sin CTA");
  assert(!mostrarCtaGuard(undefined, null, membresia("guardia", SUSPENDIDO), GUARD), "sin motivo → sin CTA");
  for (const estado of ["cancelado", "", "otro"]) {
    const t = { onboarding_completado: true, estado_servicio: estado };
    assert(!redirigeAGuard(null, membresia("guardia", t), GUARD), `estado ${JSON.stringify(estado)} no habilitado → no Guard`);
    assert(destinoPanelAdmin(null, membresia("guardia", t), GUARD) === "/sin-acceso?motivo=rol", `estado ${JSON.stringify(estado)} → /sin-acceso?motivo=rol`);
  }
});

seccion("12. guardia activo + tenant activo → Guard", () => {
  for (const estado of ["piloto", "activo"]) {
    const t = { onboarding_completado: true, estado_servicio: estado };
    assert(destinoPanelAdmin(null, membresia("guardia", t), GUARD) === `${GUARD}/guard`, `estado ${estado} → Guard`);
    assert(mostrarCtaGuard("rol", null, membresia("guardia", t), GUARD), `estado ${estado} → CTA`);
  }
  assert(destinoPanelAdmin(null, membresia("guardia", { onboarding_completado: false, estado_servicio: "piloto" }), GUARD) === `${GUARD}/guard`, "onboarding pendiente del residencial no bloquea al guardia (no entra al panel)");
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
