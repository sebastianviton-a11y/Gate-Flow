/**
 * Suscripción manual de Super Admin (sin red, sin base): acciones por
 * estado, fechas en la zona del residencial, textos de confirmación,
 * validación de entrada, mensajes de error (alineados con la migración),
 * frontera exacta del vencimiento (misma regla que tenant_operativo), aviso
 * del panel del residencial y chequeos estáticos de la acción de servidor.
 * Los casos con base real están en supabase/tests/security/93_suscripcion_manual.sql.
 *   npx tsx apps/admin/lib/__tests__/suscripcion-manual.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SuscripcionSuperAdmin } from "@gateflow/paquetes";
import { SELECT_MEMBRESIA_ACCESO, avisoPago, estadoEfectivoSuscripcion, suscripcionOperativa } from "@gateflow/auth/client";
import {
  ACLARACION_SIN_COBRO,
  MENSAJES_ERROR,
  accionesSuscripcion,
  codigoDeError,
  esActivacionManual,
  fechaCorta,
  fechaValida,
  finComoDiaIncluido,
  limitesFecha,
  mensajeError,
  proveedorDeError,
  textoConfirmacion,
  ultimoDiaConAcceso,
  validarEntrada,
} from "../superadmin/suscripcion-manual";

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

const BSAS = "America/Argentina/Buenos_Aires";
const AHORA = new Date("2026-10-13T12:00:00Z"); // 09:00 del 13/10 en Buenos Aires
const base: SuscripcionSuperAdmin = {
  id: "00000000-0000-0000-0000-0000000000s1",
  estado: "trialing",
  origen: "registro_publico",
  plan: null,
  trialStartedAt: "2026-09-10T15:00:00Z",
  trialEndsAt: "2026-10-10T15:00:00Z",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  impagoDesde: null,
  viviendasDeclaradas: 40,
  provider: null,
  tieneSuscripcionProveedor: false,
  tieneClienteProveedor: false,
};
const s = (cambios: Partial<SuscripcionSuperAdmin>): SuscripcionSuperAdmin => ({ ...base, ...cambios });
const resumen = (x: ReturnType<typeof accionesSuscripcion>) =>
  `${x.gestion.tipo}${x.gestion.tipo === "proveedor" ? `:${x.gestion.proveedor}` : ""}|${x.extenderPrueba ? "P" : "-"}${x.activar ? "A" : "-"}${x.extenderVigencia ? "V" : "-"}`;

console.log("\nAcciones por estado (mismas precondiciones que las RPC)");
const casos: Array<[string, SuscripcionSuperAdmin | null, string]> = [
  ["prueba vencida", s({}), "manual|PA-"],
  ["prueba vigente", s({ trialEndsAt: "2026-10-30T15:00:00Z" }), "manual|PA-"],
  ["activación manual vigente", s({ estado: "active", origen: "alta_manual", currentPeriodEnd: "2026-12-01T03:00:00Z", cancelAtPeriodEnd: true }), "manual|--V"],
  ["activación manual vencida", s({ estado: "active", origen: "alta_manual", currentPeriodEnd: "2026-10-01T03:00:00Z", cancelAtPeriodEnd: true }), "manual|--V"],
  ["alta manual sin vencimiento (anterior al trial)", s({ estado: "active", origen: "alta_manual", trialStartedAt: null, trialEndsAt: null }), "sin_vencimiento|---"],
  ["canceled sin proveedor", s({ estado: "canceled" }), "manual|-A-"],
  ["expired sin proveedor", s({ estado: "expired" }), "manual|-A-"],
  ["Stripe active", s({ estado: "active", provider: "stripe", plan: "hasta-50", currentPeriodEnd: "2026-11-10T00:00:00Z", tieneSuscripcionProveedor: true, tieneClienteProveedor: true }), "proveedor:Stripe|---"],
  ["Stripe canceled con suscripción del proveedor", s({ estado: "canceled", provider: "stripe", tieneSuscripcionProveedor: true }), "proveedor:Stripe|---"],
  ["Stripe past_due", s({ estado: "past_due", provider: "stripe", tieneSuscripcionProveedor: true, impagoDesde: "2026-10-10T00:00:00Z" }), "proveedor:Stripe|---"],
  ["Mercado Pago (futuro)", s({ estado: "active", provider: "mercadopago", tieneSuscripcionProveedor: true }), "proveedor:Mercado Pago|---"],
  ["solo cliente del proveedor", s({ tieneClienteProveedor: true }), "proveedor:un proveedor de cobro|---"],
  ["sin suscripción", null, "sin_suscripcion|---"],
];
for (const [nombre, sus, esperado] of casos) {
  const r = resumen(accionesSuscripcion(sus));
  assert(r === esperado, `${nombre}: ${esperado} (${r})`);
}
assert(esActivacionManual(casos[2]![1]!) && !esActivacionManual(casos[4]![1]!) && !esActivacionManual(casos[7]![1]!), "activación manual = active + cancel_at_period_end + fecha + sin proveedor");

console.log("Fechas en la zona del residencial");
assert(ultimoDiaConAcceso("2026-12-01T03:00:00Z", BSAS) === "2026-11-30", "fin 01/12 00:00 en Buenos Aires → último día con acceso 30/11");
assert(ultimoDiaConAcceso("2026-12-01T05:00:00Z", "America/Cancun") === "2026-11-30", "fin 01/12 00:00 en Cancún → 30/11");
assert(ultimoDiaConAcceso(null, BSAS) === null, "sin fecha → null");
let l = limitesFecha("extender_prueba", s({}), BSAS, AHORA);
assert(l.min === "2026-10-13" && l.max === "2027-04-11" && l.sugerida === "2026-10-28", `prueba vencida: desde hoy, máx. 180 días, sugerida +15 (${JSON.stringify(l)})`);
l = limitesFecha("extender_prueba", s({ trialEndsAt: "2026-10-20T15:00:00Z" }), BSAS, AHORA);
assert(l.min === "2026-10-20" && l.sugerida === "2026-11-04", `prueba vigente: nunca antes de su fin (${JSON.stringify(l)})`);
l = limitesFecha("activar", s({}), BSAS, AHORA);
assert(l.min === "2026-10-13" && l.max === "2028-10-13" && l.sugerida === "2026-11-12", `activar desde prueba vencida: hoy … 2 años, sugerida +30 (${JSON.stringify(l)})`);
l = limitesFecha("activar", s({ trialEndsAt: "2026-10-25T15:00:00Z" }), BSAS, AHORA);
assert(l.min === "2026-10-25", `activar durante una prueba vigente: no antes de su fin (${l.min})`);
l = limitesFecha("extender_vigencia", s({ estado: "active", currentPeriodEnd: "2026-12-01T03:00:00Z", cancelAtPeriodEnd: true }), BSAS, AHORA);
assert(l.min === "2026-11-30" && l.sugerida === "2026-12-30", `extender vigencia: desde el último día vigente, sugerida +30 (${JSON.stringify(l)})`);
l = limitesFecha("activar", s({}), BSAS, new Date("2028-02-29T15:00:00Z"));
assert(l.max === "2030-02-28", `2 años desde un 29/02 → 28/02, igual que Postgres (${l.max})`);
l = limitesFecha("extender_prueba", s({}), BSAS, new Date("2026-10-14T02:30:00Z"));
assert(l.min === "2026-10-13", `"hoy" es el día local (23:30 del 13/10 en Buenos Aires), no el de UTC (${l.min})`);

assert(finComoDiaIncluido("2026-10-24T03:00:00Z", BSAS) === "2026-10-23", "prueba extendida hasta el 23/10 (fin 24/10 00:00 local) → se muestra «23/10 (incluido)»");
assert(finComoDiaIncluido("2026-10-10T15:00:00Z", BSAS) === null, "prueba del registro (vence a la hora del alta) → fecha y hora");
assert(finComoDiaIncluido("2026-10-24T03:00:00Z", "America/Cancun") === null, "medianoche de OTRA zona no cuenta");

console.log("Textos de confirmación");
assert(
  textoConfirmacion("activar", "2026-11-30") === "Este residencial podrá usar Gate Flow hasta el 30/11/2026. Esta acción no genera ningún cobro automático.",
  "activar: texto pedido, con la fecha elegida",
);
assert(textoConfirmacion("extender_vigencia", "2027-01-31").includes("hasta el 31/01/2027") && textoConfirmacion("extender_vigencia", "2027-01-31").includes("ningún cobro"), "extender vigencia: sin cobro");
assert(textoConfirmacion("extender_prueba", "2026-11-15") === "La prueba gratuita de este residencial se extiende hasta el 15/11/2026. No se cobra nada.", "extender prueba: sin cobro");
assert(ACLARACION_SIN_COBRO.includes("Stripe") && ACLARACION_SIN_COBRO.includes("Mercado Pago") && ACLARACION_SIN_COBRO.includes("administrativa"), "aclara: sin Stripe, sin Mercado Pago, activación administrativa");
assert(fechaCorta("2026-01-05") === "05/01/2026", "fecha corta dd/mm/aaaa");

console.log("Validación de entrada (server action)");
const T = "3fbf76a3-0c16-4ece-84f3-713f369c7bdc";
assert(JSON.stringify(validarEntrada(T, "2026-11-30", "hasta-50")) === JSON.stringify({ ok: true, tenantId: T, hasta: "2026-11-30", plan: "hasta-50" }), "entrada válida");
assert(validarEntrada(T, "2026-11-30", "").ok && (validarEntrada(T, "2026-11-30", "") as { plan: unknown }).plan === null, "plan vacío = sin plan");
for (const [t, h, p, codigo] of [
  ["no-es-uuid", "2026-11-30", null, "parametros"],
  [T, "2026-02-30", null, "parametros"],
  [T, "30/11/2026", null, "parametros"],
  [T, "", null, "parametros"],
  [null, "2026-11-30", null, "parametros"],
  [T, "2026-11-30", "oro", "plan_invalido"],
] as const) {
  const r = validarEntrada(t, h, p);
  assert(!r.ok && r.codigo === codigo, `${JSON.stringify([t, h, p])} → ${codigo}`);
}
assert(fechaValida("2028-02-29") && !fechaValida("2027-02-29"), "29/02 solo en bisiestos");

console.log("Errores de la base → mensajes");
const migracion = fuente("supabase/migrations/20261013000000_superadmin_suscripcion_manual.sql");
const codigos = [...new Set([...migracion.matchAll(/suscripcion_manual:([a-z_]+)/g)].map((m) => m[1]!))];
assert(codigos.length >= 14, `la migración usa ${codigos.length} códigos`);
for (const c of codigos) {
  assert(c === "gestionada_por_proveedor" || c in MENSAJES_ERROR, `código ${c}: tiene mensaje para la persona`);
  assert(codigoDeError({ message: `suscripcion_manual:${c}` }) === c, `código ${c}: se reconoce`);
}
assert(mensajeError("gestionada_por_proveedor", proveedorDeError({ message: "suscripcion_manual:gestionada_por_proveedor", details: "stripe" })) === "Esta suscripción está gestionada por Stripe.", "Stripe: «Esta suscripción está gestionada por Stripe.»");
assert(mensajeError("gestionada_por_proveedor", proveedorDeError({ details: "mercadopago" })) === "Esta suscripción está gestionada por Mercado Pago.", "Mercado Pago");
assert(mensajeError("gestionada_por_proveedor", proveedorDeError({ details: "proveedor" })) === "Esta suscripción está gestionada por un proveedor de cobro.", "sin nombre: genérico");
assert(codigoDeError(new Error("connection reset")) === "desconocido" && codigoDeError({ message: "suscripcion_manual:inventado" }) === "desconocido", "otros errores → desconocido");
assert(!Object.values(MENSAJES_ERROR).some((m) => /suscripcion_manual|sqlstate|42501|22023/.test(m)), "los mensajes no exponen detalles técnicos");

console.log("Vencimiento: misma frontera que tenant_operativo (SM-P1/P2)");
const fin = "2026-12-01T03:00:00.000Z";
const manual = { estado: "active", trial_ends_at: null, current_period_end: fin, cancel_at_period_end: true, provider: null };
assert(estadoEfectivoSuscripcion(manual, new Date(Date.parse(fin) - 1)) === "activa", "1 ms antes: activa");
assert(estadoEfectivoSuscripcion(manual, new Date(fin)) === "inactiva" && !suscripcionOperativa(estadoEfectivoSuscripcion(manual, new Date(fin))), "en el instante exacto: inactiva (no queda activo indefinidamente)");
assert(estadoEfectivoSuscripcion({ estado: "trialing", trial_ends_at: "2026-10-28T03:00:00Z" }, AHORA) === "trial_activo", "prueba extendida: trial_activo");

console.log("Aviso del panel del residencial");
const a3 = avisoPago({ ...manual, current_period_end: "2026-10-16T03:00:00Z" }, AHORA, BSAS);
assert(a3?.nivel === "vencimiento" && a3.texto === "Tu suscripción está activa hasta el 15 de octubre.", `activación manual a 3 días: «${a3?.texto}»`);
assert(avisoPago({ ...manual, current_period_end: "2026-11-30T03:00:00Z" }, AHORA, BSAS) === null, "a más de 7 días: sin aviso (nada de «cancelada»)");
const stripe = avisoPago({ ...manual, provider: "stripe", current_period_end: "2026-11-30T03:00:00Z" }, AHORA, BSAS);
assert(stripe?.nivel === "cancelacion" && stripe.texto.startsWith("Tu suscripción está cancelada"), "Stripe con cancelación pedida: aviso de cancelación sin cambios");
const sinCampo = avisoPago({ estado: "active", trial_ends_at: null, current_period_end: "2026-11-30T03:00:00Z", cancel_at_period_end: true }, AHORA, BSAS);
assert(sinCampo?.nivel === "cancelacion", "fila sin el campo provider (consulta anterior): mismo comportamiento que antes");
assert(/suscripciones\([^)]*\bprovider\b/.test(SELECT_MEMBRESIA_ACCESO), "la consulta de acceso lee provider");
assert(/suscripciones\([^)]*\bprovider\b/.test(fuente("packages/auth/src/membresias.ts")), "la consulta de membresías lee provider");

console.log("Acción de servidor y UI (estático)");
const acciones = fuente("apps/admin/app/superadmin/suscripcion-actions.ts");
assert(/session\.role !== "super_admin"/.test(acciones) && /getSessionContext\(\)/.test(acciones), "la acción exige sesión de super_admin");
assert(/createServerSupabaseClient\(\)/.test(acciones) && !/createServiceRoleClient|SERVICE_ROLE|service_role/.test(acciones), "usa el JWT de quien opera, nunca la clave de servicio");
assert((acciones.match(/^export async function /gm) ?? []).length === 3, "expone exactamente 3 acciones");
assert(/validarEntrada\(/.test(acciones) && /revalidatePath\(/.test(acciones), "valida la entrada y refresca el detalle");
assert(!/console\.\w+\([^)]*(tenantId|nombre|hasta)/.test(acciones), "el log no lleva datos del residencial");
const escrituraDirecta = /\.from\("suscripciones"\)[\s\S]{0,200}?\.(update|insert|upsert|delete)\(/;
for (const f of ["packages/paquetes/src/superadmin.ts", "apps/admin/app/superadmin/suscripcion-actions.ts", "apps/admin/app/superadmin/residenciales/[id]/tab-suscripcion.tsx"]) {
  assert(!escrituraDirecta.test(fuente(f)), `${f}: sin UPDATE/INSERT directo sobre suscripciones`);
}
const sa = fuente("packages/paquetes/src/superadmin.ts");
for (const rpc of ["superadmin_extender_trial", "superadmin_activar_suscripcion_manual", "superadmin_extender_suscripcion_manual"]) {
  assert(sa.includes(`rpc("${rpc}"`) && migracion.includes(`create function public.${rpc}(`), `${rpc}: la llama el código y existe en la migración`);
}
const tab = fuente("apps/admin/app/superadmin/residenciales/[id]/tab-suscripcion.tsx");
for (const t of ["Suscripción", "Extender prueba", "Activar manualmente", "Extender vigencia", "Esta suscripción está gestionada por", "Viviendas declaradas", "Proveedor de cobro", "Fin de la prueba"]) {
  assert(tab.includes(t), `UI: «${t}»`);
}
assert(/textoConfirmacion\(accion, fecha\)/.test(tab) && /role="alertdialog"/.test(tab), "UI: confirmación antes de guardar con el texto de la fecha elegida");
assert(/enCurso\.current/.test(tab) && /disabled=\{enviando\}/.test(tab), "UI: doble clic no envía dos veces");
assert(/type="date"/.test(tab) && /min=\{limites\.min\}/.test(tab) && /max=\{limites\.max\}/.test(tab), "UI: fecha explícita con los límites de la base");
assert(/sm:grid-cols-2/.test(tab) && /w-full sm:w-auto/.test(tab), "UI: se apila en móvil");
assert(fuente("apps/admin/app/superadmin/residenciales/[id]/detalle-client.tsx").includes('"Suscripción"'), "pestaña «Suscripción» en el detalle del residencial");

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
