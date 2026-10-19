/**
 * Acceso al panel Admin por rol. Sin framework, igual que
 * residentes-import.test.ts:
 *   npx tsx apps/admin/lib/__tests__/acceso-panel.test.ts
 */
import { ROLES_PANEL_ADMIN, puedeUsarPanelAdmin } from "@gateflow/auth/client";
import { destinoPanelAdmin } from "../acceso-panel";

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

/** Desde el ciclo de vida del trial, el acceso exige suscripción operativa. */
const ACTIVA = { estado: "active", trial_ends_at: null };
const TENANT_OK = { onboarding_completado: true, estado_servicio: "piloto", suscripciones: ACTIVA };

function membresia(clave: unknown, tenants: unknown = TENANT_OK) {
  return { roles: clave === undefined ? null : { clave }, tenants };
}

seccion("ROLES_PANEL_ADMIN es exactamente super_admin y admin_residencial", () => {
  assert(
    [...ROLES_PANEL_ADMIN].sort().join(",") === "admin_residencial,super_admin",
    `ROLES_PANEL_ADMIN = ${ROLES_PANEL_ADMIN.join(",")}`,
  );
});

seccion("Entran al panel", () => {
  for (const rol of ["super_admin", "admin_residencial"]) {
    assert(puedeUsarPanelAdmin(rol), `puedeUsarPanelAdmin(${rol}) debe ser true`);
    assert(destinoPanelAdmin(null, membresia(rol)) === null, `${rol} debe pasar el middleware`);
  }
});

seccion("Todos los demás roles van a /sin-acceso?motivo=rol", () => {
  for (const rol of ["guardia", "supervisor", "recepcion", "residente", "admin_empresa", "rol_desconocido", "SUPER_ADMIN", " super_admin"]) {
    assert(!puedeUsarPanelAdmin(rol), `puedeUsarPanelAdmin(${JSON.stringify(rol)}) debe ser false`);
    assert(destinoPanelAdmin(null, membresia(rol)) === "/sin-acceso?motivo=rol", `${JSON.stringify(rol)} debe ir a /sin-acceso?motivo=rol`);
  }
});

seccion("Rol vacío, nulo o ilegible falla cerrado (sin fallback a admin_residencial)", () => {
  for (const rol of ["", null, undefined]) {
    assert(!puedeUsarPanelAdmin(rol as string | null | undefined), `puedeUsarPanelAdmin(${JSON.stringify(rol)}) debe ser false`);
    assert(destinoPanelAdmin(null, membresia(rol)) === "/sin-acceso?motivo=error", `rol ${JSON.stringify(rol)} debe ir a /sin-acceso?motivo=error`);
  }
  assert(destinoPanelAdmin(null, membresia("admin_residencial", null)) === "/sin-acceso?motivo=error", "tenant ilegible debe ir a /sin-acceso?motivo=error");
});

seccion("Sin membresía o con error de lectura no se deja pasar", () => {
  assert(destinoPanelAdmin(null, null) === "/sin-acceso", "sin membresía debe ir a /sin-acceso");
  assert(destinoPanelAdmin(null, undefined) === "/sin-acceso", "membresía undefined debe ir a /sin-acceso");
  assert(
    destinoPanelAdmin({ code: "42501" }, membresia("super_admin")) === "/sin-acceso?motivo=error",
    "un error de lectura debe ir a /sin-acceso?motivo=error aunque venga una fila",
  );
});

seccion("Suspendido y onboarding (sin cambios de comportamiento)", () => {
  const suspendido = { onboarding_completado: true, estado_servicio: "suspendido", suscripciones: ACTIVA };
  assert(destinoPanelAdmin(null, membresia("admin_residencial", suspendido)) === "/residencial-suspendido", "admin de un residencial suspendido → /residencial-suspendido");
  assert(destinoPanelAdmin(null, membresia("super_admin", suspendido)) === null, "super_admin entra a un residencial suspendido (soporte)");
  assert(destinoPanelAdmin(null, membresia("guardia", suspendido)) === "/residencial-suspendido", "la suspensión se valida antes que el rol");
  assert(destinoPanelAdmin(null, membresia("rol_desconocido", suspendido)) === "/residencial-suspendido", "rol sin panel de un residencial suspendido → /residencial-suspendido");
  const sinOnboarding = { onboarding_completado: false, estado_servicio: "piloto", suscripciones: ACTIVA };
  assert(destinoPanelAdmin(null, membresia("admin_residencial", sinOnboarding)) === "/onboarding", "onboarding pendiente → /onboarding");
  assert(destinoPanelAdmin(null, membresia("recepcion", sinOnboarding)) === "/sin-acceso?motivo=rol", "un rol sin panel no llega a /onboarding");
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
