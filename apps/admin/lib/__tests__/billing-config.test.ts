/**
 * Safety de Stripe live: billing se niega a inicializar con una clave
 * live sin STRIPE_PERMITIR_LIVE=true, y nunca acepta live en staging,
 * preview o local. Las claves de este test son ficticias.
 *   npx tsx apps/admin/lib/__tests__/billing-config.test.ts
 */
import { configuracionStripe, esEntornoNoProductivo } from "../billing/config";

let pasadas = 0;
let fallidas = 0;
function assert(condicion: boolean, mensaje: string) {
  if (condicion) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}

const TEST = "sk_test_" + "a".repeat(24);
const LIVE = "sk_live_" + "b".repeat(24);
const RK_LIVE = "rk_live_" + "c".repeat(24);
const WHSEC = "whsec_" + "d".repeat(24);
const STAGING = "https://gateflow-admin-staging.netlify.app";
const PROD = "https://admin.gateflow.mx";

const motivo = (e: Parameters<typeof configuracionStripe>[0]) => {
  const c = configuracionStripe(e);
  return c.ok ? `ok:${c.modo}` : c.motivo;
};

console.log("\nClaves test (staging)");
assert(motivo({ STRIPE_SECRET_KEY: TEST, STRIPE_WEBHOOK_SECRET: WHSEC, NEXT_PUBLIC_ADMIN_APP_URL: STAGING }) === "ok:test", "sk_test_ en staging → habilitado (modo test)");
const c = configuracionStripe({ STRIPE_SECRET_KEY: ` ${TEST} `, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PORTAL_CONFIGURATION_ID: " bpc_x ", NEXT_PUBLIC_ADMIN_APP_URL: STAGING });
assert(c.ok && c.clave === TEST && c.portalConfiguracionId === "bpc_x", "espacios recortados; portal opcional");

console.log("\nClaves live: nunca sin permiso explícito, nunca en staging");
assert(motivo({ STRIPE_SECRET_KEY: LIVE, STRIPE_WEBHOOK_SECRET: WHSEC, NEXT_PUBLIC_ADMIN_APP_URL: STAGING }) === "live_no_permitido", "sk_live_ sin STRIPE_PERMITIR_LIVE → billing NO se inicializa");
assert(motivo({ STRIPE_SECRET_KEY: LIVE, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PERMITIR_LIVE: "false", NEXT_PUBLIC_ADMIN_APP_URL: PROD }) === "live_no_permitido", "STRIPE_PERMITIR_LIVE=false → rechazado");
assert(motivo({ STRIPE_SECRET_KEY: LIVE, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PERMITIR_LIVE: "TRUE", NEXT_PUBLIC_ADMIN_APP_URL: PROD }) === "live_no_permitido", "solo el valor exacto \"true\" cuenta");
assert(motivo({ STRIPE_SECRET_KEY: LIVE, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PERMITIR_LIVE: "true", NEXT_PUBLIC_ADMIN_APP_URL: STAGING }) === "live_en_staging", "sk_live_ en staging AUNQUE haya permiso → rechazado");
assert(motivo({ STRIPE_SECRET_KEY: RK_LIVE, STRIPE_WEBHOOK_SECRET: WHSEC, NEXT_PUBLIC_ADMIN_APP_URL: STAGING }) === "live_no_permitido", "restricted key live (rk_live_) también");
for (const url of ["https://deploy-preview-12--gateflow-admin.netlify.app", "https://feature-x--gateflow-admin.netlify.app", "http://localhost:3000", "", "no-es-url"]) {
  assert(motivo({ STRIPE_SECRET_KEY: LIVE, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PERMITIR_LIVE: "true", NEXT_PUBLIC_ADMIN_APP_URL: url }) === "live_en_staging", `live en "${url || "(vacía)"}" → rechazado`);
}
assert(motivo({ STRIPE_SECRET_KEY: LIVE, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PERMITIR_LIVE: "true", NEXT_PUBLIC_ADMIN_APP_URL: PROD }) === "ok:live", "solo producción con permiso explícito acepta live");

console.log("\nFaltantes o inválidas");
assert(motivo({}) === "sin_clave", "sin clave → deshabilitado");
assert(motivo({ STRIPE_SECRET_KEY: TEST }) === "sin_webhook_secret", "sin webhook secret → deshabilitado");
assert(motivo({ STRIPE_SECRET_KEY: "pk_test_123", STRIPE_WEBHOOK_SECRET: WHSEC }) === "clave_invalida", "clave publicable (pk_) → rechazada");
assert(motivo({ STRIPE_SECRET_KEY: "cualquier-cosa", STRIPE_WEBHOOK_SECRET: WHSEC }) === "clave_invalida", "formato desconocido → rechazado");
assert(esEntornoNoProductivo(STAGING) && !esEntornoNoProductivo(PROD), "detección de staging vs producción");
const rechazo = configuracionStripe({ STRIPE_SECRET_KEY: LIVE, STRIPE_WEBHOOK_SECRET: WHSEC });
assert(!JSON.stringify(rechazo).includes(LIVE) && !JSON.stringify(rechazo).includes(WHSEC), "el rechazo no contiene la clave ni el secreto");

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
