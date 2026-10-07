/**
 * Helpers de suscripción (packages/paquetes/src/suscripciones.ts).
 *   npx tsx apps/admin/lib/__tests__/suscripcion-situacion.test.ts
 */
import { diasRestantesTrial, situacionSuscripcion } from "@gateflow/paquetes";
import type { Suscripcion } from "@gateflow/types";

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

const AHORA = new Date("2026-10-06T12:00:00Z");

function s(parcial: Partial<Suscripcion>): Suscripcion {
  return {
    id: "s1",
    tenantId: "t1",
    estado: "active",
    trialStartedAt: null,
    trialEndsAt: null,
    viviendasDeclaradas: null,
    origen: "alta_manual",
    plan: null,
    provider: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    tieneClienteProveedor: false,
    ...parcial,
  };
}

console.log("\nsituacionSuscripcion");
assert(situacionSuscripcion(null, AHORA) === "sin_suscripcion", "null → sin_suscripcion");
assert(situacionSuscripcion(s({ estado: "active" }), AHORA) === "activa", "active (alta manual) → activa");
assert(situacionSuscripcion(s({ estado: "past_due" }), AHORA) === "inactiva", "past_due sin fin de periodo → inactiva (falla cerrado)");
assert(
  situacionSuscripcion(s({ estado: "trialing", origen: "registro_publico", trialStartedAt: "2026-10-01T00:00:00Z", trialEndsAt: "2026-10-31T00:00:00Z" }), AHORA) === "trial_activo",
  "trialing con fin futuro → trial_activo",
);
assert(
  situacionSuscripcion(s({ estado: "trialing", origen: "registro_publico", trialStartedAt: "2026-08-01T00:00:00Z", trialEndsAt: "2026-08-31T00:00:00Z" }), AHORA) === "vencida",
  "trialing con fin pasado → vencida",
);
assert(situacionSuscripcion(s({ estado: "trialing", trialEndsAt: null }), AHORA) === "vencida", "trialing sin fecha → vencida (falla cerrado)");
assert(situacionSuscripcion(s({ estado: "expired" }), AHORA) === "vencida", "expired → vencida");
assert(situacionSuscripcion(s({ estado: "canceled" }), AHORA) === "inactiva", "canceled → inactiva");

console.log("\ndiasRestantesTrial");
assert(diasRestantesTrial(null, AHORA) === null, "null → null");
assert(diasRestantesTrial(s({ estado: "active" }), AHORA) === null, "active → null");
assert(diasRestantesTrial(s({ estado: "trialing", trialEndsAt: "2026-10-31T12:00:00Z" }), AHORA) === 25, "25 días exactos");
assert(diasRestantesTrial(s({ estado: "trialing", trialEndsAt: "2026-10-06T13:00:00Z" }), AHORA) === 1, "menos de un día → 1");
assert(diasRestantesTrial(s({ estado: "trialing", trialEndsAt: "2026-10-01T00:00:00Z" }), AHORA) === 0, "vencido → 0");

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
