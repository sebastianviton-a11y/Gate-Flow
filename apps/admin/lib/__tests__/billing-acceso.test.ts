/**
 * Billing V1 — regla de acceso en TypeScript (espejo exacto de
 * tenant_operativo, migración 20261008200000): gracia de 7 días en
 * past_due y cancelación al final del periodo, con fronteras exactas.
 *   npx tsx apps/admin/lib/__tests__/billing-acceso.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DIAS_GRACIA_PAGO,
  SELECT_MEMBRESIA_ACCESO,
  SELECT_MEMBRESIAS_ACCESO,
  avisoPago,
  estadoEfectivoSuscripcion,
  resolverAcceso,
  suscripcionOperativa,
} from "@gateflow/auth/client";
import { RUTA_WEBHOOKS_BILLING, RUTAS_CUENTA } from "../rutas-publicas";

let pasadas = 0;
let fallidas = 0;
function assert(condicion: boolean, mensaje: string) {
  if (condicion) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}
function seccion(nombre: string, fn: () => void) {
  console.log(`\n${nombre}`);
  fn();
}

const RAIZ = join(__dirname, "../../../..");
const fuente = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
const AHORA = new Date("2026-10-07T18:00:00Z");
const DIA = 86_400_000;
const en = (ms: number) => new Date(AHORA.getTime() + ms).toISOString();
const sus = (estado: string, cpe: string | null, cancel = false) => ({ estado, trial_ends_at: null, current_period_end: cpe, cancel_at_period_end: cancel });

function membresia(rol: string, s: unknown, estadoServicio = "activo") {
  return { roles: { clave: rol }, tenants: { onboarding_completado: true, estado_servicio: estadoServicio, timezone: "America/Mexico_City", suscripciones: s } };
}

seccion("27–28. past_due: 7 días de gracia desde current_period_end (frontera exacta)", () => {
  assert(DIAS_GRACIA_PAGO === 7, "7 días");
  assert(estadoEfectivoSuscripcion(sus("past_due", en(-DIA)), AHORA) === "gracia", "27. vencido hace 1 día → gracia (operativo)");
  assert(estadoEfectivoSuscripcion(sus("past_due", en(-7 * DIA + 1)), AHORA) === "gracia", "27. a 1 ms de agotar la gracia → gracia");
  assert(estadoEfectivoSuscripcion(sus("past_due", en(-7 * DIA)), AHORA) === "inactiva", "28. frontera exacta de 7 días → bloqueado");
  assert(estadoEfectivoSuscripcion(sus("past_due", en(-7 * DIA - 1)), AHORA) === "inactiva", "28. 1 ms después → bloqueado");
  assert(estadoEfectivoSuscripcion(sus("past_due", null), AHORA) === "inactiva", "sin fin de periodo → bloqueado (falla cerrado)");
  assert(estadoEfectivoSuscripcion(sus("past_due", "no-es-fecha"), AHORA) === "inactiva", "fecha inválida → bloqueado");
  assert(suscripcionOperativa("gracia") && !suscripcionOperativa("inactiva"), "gracia es operativa");
});

seccion("30–31. cancelación al final del periodo", () => {
  assert(estadoEfectivoSuscripcion(sus("active", en(10 * DIA), true), AHORA) === "activa", "30. cancelada con periodo vigente → activa");
  assert(estadoEfectivoSuscripcion(sus("active", en(1), true), AHORA) === "activa", "30. 1 ms antes del fin → activa");
  assert(estadoEfectivoSuscripcion(sus("active", en(0), true), AHORA) === "inactiva", "31. en current_period_end → no operativo (sin esperar webhook)");
  assert(estadoEfectivoSuscripcion(sus("active", null, true), AHORA) === "inactiva", "cancelada sin fecha → no operativo (falla cerrado)");
  assert(estadoEfectivoSuscripcion(sus("active", en(-30 * DIA), false), AHORA) === "activa", "sin cancelación: periodo pasado sigue activo (renovación en curso)");
  assert(estadoEfectivoSuscripcion({ estado: "active", trial_ends_at: null }, AHORA) === "activa", "alta manual sin columnas de billing → activa (sin cambios)");
  assert(estadoEfectivoSuscripcion(sus("canceled", en(10 * DIA)), AHORA) === "inactiva", "32. canceled → bloqueado");
});

seccion("Paridad con tenant_operativo (SQL)", () => {
  const mig = fuente("supabase/migrations/20261008200000_tenant_operativo_billing.sql");
  assert(mig.includes("pg_catalog.now() < s.current_period_end + interval '7 days'"), "SQL: past_due < cpe + 7 días");
  assert(mig.includes("(s.current_period_end is not null and pg_catalog.now() < s.current_period_end)"), "SQL: cancelación vigente solo antes de cpe");
  assert(mig.includes("s.trial_ends_at is not null and pg_catalog.now() < s.trial_ends_at"), "SQL: trial sin cambios");
  assert(SELECT_MEMBRESIA_ACCESO.includes("suscripciones(estado, trial_ends_at, current_period_end, cancel_at_period_end)"), "SELECT de acceso lee las columnas de billing");
  assert(SELECT_MEMBRESIAS_ACCESO.includes("suscripciones(estado, trial_ends_at, current_period_end, cancel_at_period_end)"), "SELECT multitenant lee las columnas de billing");
});

seccion("Gracia: Admin con banner fuerte, Guard opera normal", () => {
  const gracia = sus("past_due", en(-2 * DIA));
  const admin = resolverAcceso({ error: null, membresia: membresia("admin_residencial", gracia), ahora: AHORA, app: "admin" });
  assert(admin.tipo === "permitir" && admin.estado === "gracia", "admin en gracia → panel permitido");
  assert(admin.tipo === "permitir" && admin.avisoPago?.nivel === "gracia" && admin.avisoPago.texto.startsWith("No pudimos cobrar tu suscripción."), "admin: aviso fuerte de problema de pago");
  assert(admin.tipo === "permitir" && admin.avisoPago?.hasta === en(5 * DIA), "el aviso dice hasta cuándo (fin de la gracia)");
  const guardia = resolverAcceso({ error: null, membresia: membresia("guardia", gracia), ahora: AHORA, app: "guard" });
  assert(guardia.tipo === "permitir" && guardia.avisoPago === null, "Guard en gracia → opera, sin banner");
  const agotada = resolverAcceso({ error: null, membresia: membresia("admin_residencial", sus("past_due", en(-8 * DIA))), ahora: AHORA, app: "admin" });
  assert(agotada.tipo === "suscripcion" && agotada.estado === "inactiva", "gracia agotada → /suscripcion");
  const guardiaAgotada = resolverAcceso({ error: null, membresia: membresia("guardia", sus("past_due", en(-8 * DIA))), ahora: AHORA, app: "guard" });
  assert(guardiaAgotada.tipo === "suscripcion", "Guard con gracia agotada → servicio inactivo");
  const suspendido = resolverAcceso({ error: null, membresia: membresia("admin_residencial", sus("active", en(10 * DIA)), "suspendido"), ahora: AHORA, app: "admin" });
  assert(suspendido.tipo === "suspendido", "24. pagado pero suspendido → sigue suspendido");
});

seccion("Cancelación pendiente: aviso discreto; avisos solo cuando corresponde", () => {
  const cancelada = resolverAcceso({ error: null, membresia: membresia("admin_residencial", sus("active", en(10 * DIA), true)), ahora: AHORA, app: "admin" });
  assert(cancelada.tipo === "permitir" && cancelada.avisoPago?.nivel === "cancelacion" && cancelada.avisoPago.texto.startsWith("Tu suscripción está cancelada y termina el"), "aviso de cancelación pendiente");
  assert(avisoPago(sus("active", en(10 * DIA)), AHORA, "America/Mexico_City") === null, "activa normal → sin aviso");
  assert(avisoPago({ estado: "trialing", trial_ends_at: en(5 * DIA) }, AHORA, "America/Mexico_City") === null, "trial → sin aviso de pago (tiene el suyo)");
  assert(avisoPago(sus("past_due", en(-2 * DIA)), AHORA, "Zona/Invalida") !== null, "zona inválida → aviso con zona de respaldo");
  const layout = fuente("apps/admin/app/(app)/layout.tsx");
  assert(layout.includes('decision.rol === "admin_residencial" && !session.impersonando ? decision.avisoPago : null') && layout.includes("<AvisoPago aviso={avisoPago} />"), "Admin: solo admin_residencial (nunca en modo soporte)");
  const guardLayout = fuente("apps/guard/app/guard/layout.tsx");
  assert(!guardLayout.includes("avisoPago") && !guardLayout.includes("AvisoPago"), "Guard no muestra avisos de pago");
});

seccion("Rutas", () => {
  assert((RUTAS_CUENTA as readonly string[]).includes("/suscripcion"), "/suscripcion (y /suscripcion/procesando) exentas de la redirección del middleware");
  assert(RUTA_WEBHOOKS_BILLING === "/api/billing/webhook/", "ruta de webhooks documentada");
  assert(fuente("apps/admin/middleware.ts").includes("|api/billing/webhook/|"), "matcher del middleware excluye los webhooks de billing");
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
