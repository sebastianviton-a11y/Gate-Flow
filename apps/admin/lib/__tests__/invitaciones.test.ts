/**
 * Quién puede invitar a quién. Sin framework, igual que
 * residentes-import.test.ts:
 *   npx tsx apps/admin/lib/__tests__/invitaciones.test.ts
 */
import { ROLES_INVITABLES, puedeInvitar } from "@gateflow/paquetes";

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

/** Lo que valida invitarUsuarioResidencial (onboarding y /usuarios). */
function pasaFlujoResidencial(rolQuienInvita: string, rolInvitado: string) {
  return ROLES_INVITABLES.some((r) => r.clave === rolInvitado) && puedeInvitar(rolQuienInvita, rolInvitado);
}

const NO_INVITABLES = ["super_admin", "supervisor", "recepcion", "residente", "admin_empresa", "rol_inventado", "", "GUARDIA"];

seccion("Selector del residencial: solo Guardia", () => {
  assert(ROLES_INVITABLES.map((r) => r.clave).join(",") === "guardia", `ROLES_INVITABLES = ${ROLES_INVITABLES.map((r) => r.clave).join(",")}`);
  for (const rol of NO_INVITABLES.concat("admin_residencial")) {
    assert(!ROLES_INVITABLES.some((r) => r.clave === rol), `${JSON.stringify(rol)} no debe aparecer como opción`);
  }
});

seccion("admin_residencial invita guardia y nada más", () => {
  assert(pasaFlujoResidencial("admin_residencial", "guardia"), "admin_residencial puede invitar guardia");
  assert(!pasaFlujoResidencial("admin_residencial", "admin_residencial"), "admin_residencial no puede invitar admin_residencial");
  assert(!puedeInvitar("admin_residencial", "admin_residencial"), "puedeInvitar(admin_residencial, admin_residencial) debe ser false");
  for (const rol of NO_INVITABLES) {
    assert(!pasaFlujoResidencial("admin_residencial", rol), `admin_residencial no puede invitar ${JSON.stringify(rol)}`);
  }
});

seccion("super_admin invita admin_residencial solo por su flujo", () => {
  assert(puedeInvitar("super_admin", "admin_residencial"), "super_admin puede invitar admin_residencial (flujo Super Admin)");
  assert(!pasaFlujoResidencial("super_admin", "admin_residencial"), "admin_residencial no entra por el flujo del residencial");
  assert(pasaFlujoResidencial("super_admin", "guardia"), "super_admin (o en modo soporte) puede invitar guardia");
  for (const rol of NO_INVITABLES) {
    assert(!puedeInvitar("super_admin", rol), `super_admin no puede invitar ${JSON.stringify(rol)}`);
  }
});

seccion("Nadie más invita", () => {
  for (const quien of ["guardia", "supervisor", "recepcion", "residente", "admin_empresa", "", null, undefined]) {
    for (const rol of ["guardia", "admin_residencial", "super_admin"]) {
      assert(!puedeInvitar(quien, rol), `${JSON.stringify(quien)} no puede invitar ${rol}`);
    }
  }
  assert(!puedeInvitar("super_admin", null), "rol invitado nulo no pasa");
  assert(!puedeInvitar("super_admin", undefined), "rol invitado undefined no pasa");
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
