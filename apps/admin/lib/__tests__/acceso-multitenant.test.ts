/**
 * Selección explícita de residencial (multi-tenant): la decisión de
 * acceso se evalúa siempre sobre la membresía del tenant SELECCIONADO
 * (cookie gf_tenant validada), nunca sobre una fila arbitraria.
 *   npx tsx apps/admin/lib/__tests__/acceso-multitenant.test.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  COOKIE_TENANT,
  opcionesCookieTenant,
  opcionesSeleccion,
  resolverAccesoUsuario,
  resultadoEleccionAdmin,
  resultadoEleccionGuard,
  seleccionarMembresia,
  type FilaMembresia,
} from "@gateflow/auth/client";
import { destinoDeDecision, destinoTrasAutenticar, mostrarCtaGuard, resultadoPanel } from "../acceso-panel";

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

const AHORA = new Date("2026-10-06T18:00:00Z");
const DIA = 86_400_000;
const GUARD = "https://gateflow-guard-staging.netlify.app";
const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";
const C = "cccccccc-0000-0000-0000-000000000000";
const P = "11111111-0000-0000-0000-000000000000";

const ACTIVA = { estado: "active", trial_ends_at: null };
const VENCIDA = { estado: "trialing", trial_ends_at: new Date(AHORA.getTime() - DIA).toISOString() };

function fila(tenant: string, rol: string, opciones: { sus?: unknown; estadoServicio?: string; onboarding?: boolean } = {}): FilaMembresia {
  return {
    tenant_id: tenant,
    roles: { clave: rol },
    tenants: {
      nombre: `Residencial ${tenant.slice(0, 1).toUpperCase()}`,
      onboarding_completado: opciones.onboarding ?? true,
      estado_servicio: opciones.estadoServicio ?? "activo",
      timezone: "America/Mexico_City",
      suscripciones: "sus" in opciones ? opciones.sus : ACTIVA,
    },
  };
}

const admin = (filas: FilaMembresia[], cookie: string | null) => resultadoPanel(null, filas, cookie, AHORA);
const guard = (filas: FilaMembresia[], cookie: string | null) => resolverAccesoUsuario({ error: null, filas, cookieTenantId: cookie, app: "guard", ahora: AHORA });

const REPO = join(__dirname, "..", "..", "..", "..");
const fuente = (ruta: string) => readFileSync(join(REPO, ruta), "utf8");

/** a aparece en el texto y antes que b. */
const antes = (texto: string, a: string, b: string) => texto.indexOf(a) >= 0 && texto.indexOf(b) >= 0 && texto.indexOf(a) < texto.indexOf(b);

function permutaciones<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((resto) => [x, ...resto]));
}

seccion("40. A active + B vencido: no mezcla estados", () => {
  const filas = [fila(A, "admin_residencial"), fila(B, "admin_residencial", { sus: VENCIDA })];
  const ra = admin(filas, A);
  assert(ra.tenantId === A && ra.decision.tipo === "permitir", `cookie A → permitir en A (${ra.decision.tipo})`);
  const rb = admin(filas, B);
  assert(rb.tenantId === B && rb.decision.tipo === "suscripcion", `cookie B → /suscripcion en B (${rb.decision.tipo})`);
});

seccion("41. A vencido + B active: no mezcla estados", () => {
  const filas = [fila(A, "admin_residencial", { sus: VENCIDA }), fila(B, "admin_residencial")];
  assert(admin(filas, A).decision.tipo === "suscripcion", "cookie A → /suscripcion");
  assert(admin(filas, B).decision.tipo === "permitir", "cookie B → permitir");
});

seccion("42. el rol de A nunca autoriza B", () => {
  const filas = [fila(A, "admin_residencial"), fila(B, "guardia")];
  const rb = admin(filas, B);
  assert(rb.tenantId === B && rb.decision.tipo === "ir_a_guard", `Admin con cookie B (guardia) → Guard, no el panel (${rb.decision.tipo})`);
  const ra = admin(filas, A);
  assert(ra.decision.tipo === "permitir" && ra.decision.rol === "admin_residencial", "cookie A → admin_residencial de A");
  const enGuard = guard([fila(A, "guardia"), fila(B, "residente")], B);
  assert(enGuard.decision.tipo === "sin_acceso", `Guard con cookie B (residente) → sin acceso: el guardia de A no autoriza B (${enGuard.decision.tipo})`);
});

seccion("43. la suscripción de A nunca bloquea B", () => {
  const filas = [fila(A, "guardia", { sus: VENCIDA }), fila(B, "guardia")];
  assert(guard(filas, B).decision.tipo === "permitir", "Guard cookie B (activo) → opera aunque A esté vencido");
  assert(admin([fila(A, "admin_residencial", { sus: VENCIDA }), fila(B, "admin_residencial")], B).decision.tipo === "permitir", "Admin cookie B → permitir");
});

seccion("44. la suscripción de B nunca habilita A", () => {
  const filas = [fila(A, "guardia", { sus: VENCIDA }), fila(B, "guardia")];
  assert(guard(filas, A).decision.tipo === "suscripcion", "Guard cookie A (vencido) → servicio inactivo aunque B esté activo");
  assert(admin([fila(A, "admin_residencial", { sus: null }), fila(B, "admin_residencial")], A).decision.tipo === "suscripcion", "Admin cookie A (sin suscripción) → /suscripcion");
  assert(admin([fila(A, "admin_residencial", { estadoServicio: "suspendido" }), fila(B, "admin_residencial")], A).decision.tipo === "suspendido", "Admin cookie A suspendido → suspendido (prioridad intacta)");
});

seccion("45. una sola membresía: sin selector", () => {
  const r = admin([fila(A, "admin_residencial")], null);
  assert(r.seleccion.tipo === "resuelta" && r.seleccion.origen === "unica" && r.decision.tipo === "permitir", "1 membresía sin cookie → se usa sola");
  assert(guard([fila(A, "guardia")], null).decision.tipo === "permitir", "Guard: 1 membresía sin cookie → opera");
  assert(admin([fila(A, "guardia")], null).decision.tipo === "ir_a_guard", "1 membresía de guardia en Admin → Guard (sin selector)");
});

seccion("46. varias membresías: independiente del orden físico", () => {
  const base = [fila(A, "admin_residencial"), fila(B, "guardia", { sus: VENCIDA }), fila(C, "admin_residencial", { sus: null })];
  const clave = (r: ReturnType<typeof admin>) => JSON.stringify({ tenant: r.tenantId, decision: r.decision, seleccion: r.seleccion.tipo });
  const esperado = new Map<string | null, string>();
  for (const cookie of [null, A, B, C]) esperado.set(cookie, clave(admin(base, cookie)));
  for (const orden of permutaciones(base)) {
    for (const cookie of [null, A, B, C]) {
      assert(clave(admin(orden, cookie)) === esperado.get(cookie), `orden ${orden.map((f) => f.tenant_id[0]).join("")} cookie ${cookie?.[0] ?? "∅"}: misma decisión`);
    }
    const sinCookie = admin(orden, null);
    assert(sinCookie.decision.tipo === "seleccionar_residencial" && sinCookie.tenantId === null, `orden ${orden.map((f) => f.tenant_id[0]).join("")}: sin cookie → seleccionar, nunca la primera fila`);
    const ops = sinCookie.seleccion.tipo === "seleccionar" ? sinCookie.seleccion.opciones.map((f) => f.tenant_id).sort().join(",") : "";
    assert(ops === [A, B, C].sort().join(","), "las opciones son el mismo conjunto");
  }
  assert(destinoDeDecision({ tipo: "seleccionar_residencial", limpiarCookie: false }, GUARD) === "/seleccionar-residencial", "seleccionar → /seleccionar-residencial");
});

seccion("47. cookie de un tenant sin membresía → falla cerrado", () => {
  const filas = [fila(A, "admin_residencial"), fila(B, "admin_residencial")];
  for (const cookie of [C, "no-es-uuid", P, " "]) {
    const r = admin(filas, cookie);
    const valida = cookie.trim() !== "";
    if (valida) {
      assert(r.decision.tipo === "seleccionar_residencial" && r.decision.limpiarCookie && r.tenantId === null, `cookie ${JSON.stringify(cookie)} → seleccionar y borrar cookie, sin tenant`);
    } else {
      assert(r.decision.tipo === "seleccionar_residencial", "cookie vacía = sin cookie → seleccionar");
    }
  }
  const una = admin([fila(A, "admin_residencial")], C);
  assert(una.decision.tipo === "seleccionar_residencial" && una.tenantId === null, "aun con una sola membresía, cookie ajena → falla cerrado (no usa A en silencio)");
  const mw = fuente("apps/admin/middleware.ts");
  assert(mw.includes("redireccion.cookies.delete(COOKIE_TENANT)"), "el middleware borra la cookie inválida");
});

seccion("48. membresía inactiva → falla cerrado", () => {
  // La consulta solo trae activo = true: una membresía inactiva no llega.
  const soloActivas = [fila(B, "admin_residencial")];
  const r = admin(soloActivas, A);
  assert(r.decision.tipo === "seleccionar_residencial" && r.tenantId === null, "cookie de A (membresía inactiva) → falla cerrado");
  assert(admin([], A).decision.tipo === "sin_acceso", "sin membresías activas → sin acceso");
});

seccion("49. super_admin intacto", () => {
  const filas = [fila(P, "super_admin", { sus: VENCIDA }), fila(A, "admin_residencial", { sus: VENCIDA })];
  for (const cookie of [null, A, C]) {
    const r = admin(filas, cookie);
    assert(r.seleccion.tipo === "resuelta" && r.seleccion.origen === "super_admin" && r.decision.tipo === "permitir", `super_admin con cookie ${cookie?.[0] ?? "∅"} → su flujo (permitir)`);
  }
  const gs = fuente("packages/auth/src/get-session.ts");
  assert(gs.includes('cookies().get("gf_soporte_tenant")') && gs.includes('if (role === "super_admin") {'), "modo soporte (gf_soporte_tenant) sin cambios");
  assert(COOKIE_TENANT === "gf_tenant" && COOKIE_TENANT !== ("gf_soporte_tenant" as string), "gf_tenant separada de gf_soporte_tenant");
});

seccion("50. tenant_operativo evalúa exactamente p_tenant_id (SQL)", () => {
  const sql = fuente("supabase/tests/security/80_tenant_operativo.sql");
  assert(sql.includes("TO-50a") && sql.includes("TO-50b"), "casos TO-50 en la suite SQL de seguridad");
  const mig = fuente("supabase/migrations/20261007000000_tenant_operativo.sql");
  assert(mig.includes("and ut.tenant_id = p_tenant_id") && mig.includes("join public.suscripciones s on s.tenant_id = t.id"), "la suscripción y la membresía se unen por el MISMO tenant");
});

seccion("51. cambiar de residencial reemplaza la cookie", () => {
  const o = opcionesCookieTenant();
  assert(o.httpOnly === true && o.secure === true && o.sameSite === "lax" && o.path === "/", "gf_tenant: httpOnly, Secure, SameSite=Lax, path=/");
  for (const accion of ["apps/admin/app/seleccionar-residencial/actions.ts", "apps/guard/app/seleccionar-residencial/actions.ts"]) {
    const s = fuente(accion);
    assert(s.includes("cookies().set(COOKIE_TENANT, tenantId, opcionesCookieTenant())"), `${accion}: escribe la misma cookie (reemplaza)`);
    assert(antes(s, '.eq("activo", true)', "cookies().set(COOKIE_TENANT"), `${accion}: valida la membresía activa ANTES de escribir`);
    assert(s.includes('.eq("tenant_id", tenantId)') && s.includes(".maybeSingle()") && !s.includes(".limit("), `${accion}: busca la membresía de ESE tenant (unique), sin limit`);
    assert((s.match(/cookies\(\)\.set\(/g) ?? []).length === 1, `${accion}: un solo punto de escritura`);
  }
  assert(fuente("apps/admin/components/layout/tenant-switcher.tsx").includes('href="/seleccionar-residencial"'), "Admin: 'Cambiar residencial' en el header");
  assert(fuente("apps/guard/components/guard-shell.tsx").includes('href="/seleccionar-residencial"'), "Guard: 'Cambiar residencial'");
});

seccion("52. cerrar sesión borra la cookie", () => {
  for (const app of ["admin", "guard"]) {
    assert(fuente(`apps/${app}/app/sesion-actions.ts`).includes("cookies().delete(COOKIE_TENANT)"), `${app}: acción que borra gf_tenant`);
  }
  for (const archivo of [
    "apps/admin/components/layout/header.tsx",
    "apps/admin/app/sin-acceso/cerrar-sesion-button.tsx",
    "apps/admin/app/restablecer-password/restablecer-password-form.tsx",
    "apps/admin/app/aceptar-invitacion/aceptar-invitacion-form.tsx",
    "apps/guard/components/guard-shell.tsx",
    "apps/guard/app/sin-acceso/cerrar-sesion-button.tsx",
    "apps/guard/app/restablecer-password/restablecer-password-form.tsx",
  ]) {
    assert(antes(fuente(archivo), "await borrarResidencialSeleccionado();", "auth.signOut("), `${archivo}: borra gf_tenant antes de signOut`);
  }
  assert(antes(fuente("apps/admin/components/shared/login-form.tsx"), "await borrarResidencialSeleccionado();", 'signOut({ scope: "local" })'), "login (guardia → Guard): borra gf_tenant de Admin");
});

seccion("53. Admin no guarda el tenant de un guardia como contexto", () => {
  assert(JSON.stringify(resultadoEleccionAdmin("guardia")) === JSON.stringify({ guardarCookie: false, destino: "guard" }), "guardia → no guarda cookie, va a Guard");
  assert(resultadoEleccionAdmin("admin_residencial").guardarCookie && resultadoEleccionAdmin("admin_residencial").destino === "panel", "admin_residencial → guarda y entra");
  assert(!resultadoEleccionAdmin("residente").guardarCookie && !resultadoEleccionAdmin(null).guardarCookie, "otros roles → no guarda");
  const s = fuente("apps/admin/app/seleccionar-residencial/actions.ts");
  assert(antes(s, "if (resultado.guardarCookie) {", "cookies().set(COOKIE_TENANT"), "la única escritura está dentro de guardarCookie");
});

seccion("54. Guard usa su propia cookie", () => {
  assert(resultadoEleccionGuard("guardia").guardarCookie && resultadoEleccionGuard("admin_residencial").guardarCookie, "guardia/admin_residencial → guarda la gf_tenant de Guard");
  assert(!resultadoEleccionGuard("residente").guardarCookie && !resultadoEleccionGuard("super_admin").guardarCookie, "roles que no se eligen en Guard → no guarda");
  const lector = fuente("apps/guard/lib/acceso-guard.ts");
  assert(lector.includes("cookies().get(COOKIE_TENANT)?.value") && lector.includes('app: "guard"'), "Guard lee la cookie de su propio dominio");
  const s = fuente("apps/guard/app/seleccionar-residencial/actions.ts");
  assert(s.includes('redirect("/guard")') && s.includes("redirect(RUTA_SERVICIO_INACTIVO)"), "tras elegir: /guard si opera, /servicio-inactivo si no");
});

seccion("55. invitación con membresías previas → selección", () => {
  const rutas = { admin: "/login?password_created=1", guard: "/login?password_created=1" };
  const mixto = [fila(A, "admin_residencial"), fila(B, "guardia")];
  const d1 = destinoTrasAutenticar(null, mixto, rutas, GUARD, AHORA);
  assert(!d1.enGuard && d1.url === "/login?password_created=1", "admin en A + nuevo guardia en B → login de Admin");
  assert(admin(mixto, null).decision.tipo === "seleccionar_residencial", "…y luego /seleccionar-residencial");
  const guardias = [fila(A, "guardia"), fila(B, "guardia")];
  const d2 = destinoTrasAutenticar(null, guardias, rutas, GUARD, AHORA);
  assert(d2.enGuard && d2.url === `${GUARD}/login?password_created=1`, "guardia en A + guardia en B → Guard");
  assert(guard(guardias, null).decision.tipo === "seleccionar_residencial", "…y Guard pide elegir");
  assert(!destinoTrasAutenticar(null, [fila(A, "guardia")], rutas, null, AHORA).enGuard, "sin URL de Guard → Admin (falla cerrado)");
  assert(destinoTrasAutenticar(null, [fila(A, "guardia")], rutas, GUARD, AHORA).enGuard, "una sola membresía de guardia → Guard (sin cambios)");
});

seccion("56. el mismo guardia cambia entre dos residenciales activos sin mezclar", () => {
  const filas = [fila(A, "guardia"), fila(B, "guardia")];
  const ra = guard(filas, A);
  const rb = guard(filas, B);
  assert(ra.decision.tipo === "permitir" && ra.tenantId === A, "cookie A → opera en A");
  assert(rb.decision.tipo === "permitir" && rb.tenantId === B, "cookie B → opera en B");
  const gs = fuente("packages/auth/src/get-session.ts");
  assert(gs.includes("const membership = seleccion.membresia;") && gs.includes("tenantRow.id !== membership.tenant_id"), "getSessionContext arma el tenant con la membresía seleccionada");
  assert(fuente("apps/guard/app/guard/layout.tsx").includes("resultado.tenantId !== session.tenant.id"), "Guard: sesión y decisión del MISMO residencial");
  assert(fuente("apps/admin/app/(app)/layout.tsx").includes("resultado.tenantId !== session.tenant.id"), "Admin: sesión y decisión del MISMO residencial");
  assert(fuente("supabase/tests/security/80_tenant_operativo.sql").includes("TO-56"), "a nivel de datos: TO-56 (SQL)");
});

seccion("57. Guard lista solo membresías que operan en Guard", () => {
  const ops = opcionesSeleccion([fila(A, "guardia"), fila(B, "residente"), fila(C, "admin_residencial")], "guard").map((f) => f.tenant_id);
  assert(ops.join(",") === [A, C].join(","), `Guard: ${ops.length} opciones (guardia y admin_residencial)`);
  const adm = opcionesSeleccion([fila(A, "guardia"), fila(B, "residente"), fila(C, "admin_residencial")], "admin").map((f) => f.tenant_id);
  assert(adm.join(",") === [A, C].join(","), "Admin: guardia y admin_residencial (residente no)");
  const soloResidente = resolverAccesoUsuario({ error: null, filas: [fila(A, "residente"), fila(B, "residente")], cookieTenantId: null, app: "guard", ahora: AHORA });
  assert(soloResidente.decision.tipo === "sin_acceso", "sin opciones válidas → sin acceso (no una pantalla vacía)");
});

seccion("58–59. sin membresías y error", () => {
  assert(destinoDeDecision(admin([], null).decision, GUARD) === "/sin-acceso", "0 membresías → /sin-acceso");
  assert(guard([], null).decision.tipo === "sin_acceso", "Guard: 0 membresías → sin acceso");
  const e = resultadoPanel({ code: "PGRST" }, [fila(A, "admin_residencial")], A, AHORA);
  assert(e.decision.tipo === "sin_acceso" && e.tenantId === null, "error de lectura → sin acceso aunque la cookie sea válida");
  assert(!mostrarCtaGuard("rol", null, [fila(A, "guardia"), fila(B, "guardia")], GUARD, AHORA, null), "/sin-acceso: sin selección no ofrece Guard por una fila arbitraria");
  assert(mostrarCtaGuard("rol", null, [fila(A, "admin_residencial"), fila(B, "guardia")], GUARD, AHORA, B), "/sin-acceso: con la cookie de B (guardia) sí ofrece Guard");
});

seccion("60. ninguna resolución de membresía usa limit(1) u ORDER BY", () => {
  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n === ".next" || n === "__tests__") continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (/\.(ts|tsx)$/.test(n)) archivos.push(p);
    }
  };
  for (const raiz of ["apps/admin", "apps/guard", "packages"]) recorrer(join(REPO, raiz));
  let consultas = 0;
  for (const p of archivos) {
    const s = readFileSync(p, "utf8");
    for (const m of s.matchAll(/\.from\(\s*"user_tenants"\s*\)([\s\S]*?);/g)) {
      const cadena = m[1] ?? "";
      // Lecturas que resuelven la membresía DEL USUARIO (no los listados
      // de usuarios de un residencial, que ordenan solo para mostrar).
      if (!/\.select\(/.test(cadena) || !/\.eq\(\s*"user_id"/.test(cadena)) continue;
      consultas++;
      assert(!/\.limit\(|\.order\(/.test(cadena), `${p.replace(REPO + "/", "")}: lectura de user_tenants sin limit/order`);
    }
  }
  assert(consultas >= 8, `${consultas} lecturas de user_tenants revisadas`);
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
