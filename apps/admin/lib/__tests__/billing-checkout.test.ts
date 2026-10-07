/**
 * Billing V1 — checkout (sin red ni cuenta de Stripe: proveedor y base
 * falsos detrás de la interfaz BillingProvider).
 *   npx tsx apps/admin/lib/__tests__/billing-checkout.test.ts
 * Las reglas de la base (rol, estado, viviendas, un solo checkout
 * abierto, concurrencia) se prueban en supabase/tests/security/96_billing.sql.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolverAccesoUsuario, type FilaMembresia } from "@gateflow/auth/client";
import { autorizarBilling, permiteAlta } from "../billing/autorizacion";
import {
  CATALOGO_BILLING,
  MONTOS_PENDIENTES_DE_APROBACION,
  formatearMonto,
  planDeCheckout,
  validarPlanParaViviendas,
  viviendasRequeridas,
} from "../billing/catalogo";
import { iniciarCheckout, planIdDeFormulario, type DepsCheckout } from "../billing/checkout";
import { motivoDeErrorRpc, type BillingProvider, type DatosCheckoutProveedor } from "../billing/tipos";

let pasadas = 0;
let fallidas = 0;
function assert(condicion: boolean, mensaje: string) {
  if (condicion) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}
async function seccion(nombre: string, fn: () => void | Promise<void>) {
  console.log(`\n${nombre}`);
  await fn();
}

const RAIZ = join(__dirname, "../../../..");
const fuente = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
const AHORA = new Date("2026-10-07T18:00:00Z");
const DIA = 86_400_000;
const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";
const VENCIDA = { estado: "trialing", trial_ends_at: new Date(AHORA.getTime() - DIA).toISOString() };
const VIGENTE = { estado: "trialing", trial_ends_at: new Date(AHORA.getTime() + 10 * DIA).toISOString() };
const ACTIVA = { estado: "active", trial_ends_at: null };

function fila(tenant: string, rol: string, sus: unknown = VENCIDA, estadoServicio = "activo"): FilaMembresia {
  return {
    tenant_id: tenant,
    roles: { clave: rol },
    tenants: { nombre: "R", onboarding_completado: true, estado_servicio: estadoServicio, timezone: "America/Mexico_City", suscripciones: sus },
  };
}
const acceso = (filas: FilaMembresia[], cookie: string | null = null) =>
  resolverAccesoUsuario({ error: null, filas, cookieTenantId: cookie, app: "admin", ahora: AHORA });

interface Llamadas {
  crearEnBase: { userId: string; tenantId: string; planId: string; monto: number; moneda: string }[];
  registrar: [string, string][];
  proveedor: DatosCheckoutProveedor[];
  expirados: string[];
}

function deps(opciones: { viviendas?: { declaradas: number | null; unidadesActivas: number }; errorBase?: string; anteriores?: string[]; falloProveedor?: boolean } = {}) {
  const llamadas: Llamadas = { crearEnBase: [], registrar: [], proveedor: [], expirados: [] };
  const proveedor: BillingProvider = {
    id: "stripe",
    async crearCheckout(d) {
      if (opciones.falloProveedor) throw new Error("red");
      llamadas.proveedor.push(d);
      return { providerCheckoutId: `cs_test_${d.checkoutId}`, url: `https://checkout.stripe.test/${d.checkoutId}` };
    },
    async expirarCheckout(id) {
      llamadas.expirados.push(id);
    },
    verificarWebhook: () => null,
    normalizarEvento: async () => {
      throw new Error("no usado");
    },
    cancelarSuscripcion: async () => {},
    crearSesionGestion: async () => ({ url: "" }),
  };
  const d: DepsCheckout = {
    proveedor,
    urlBase: "https://admin.gateflow.test",
    ahora: () => AHORA,
    contarViviendas: async () => opciones.viviendas ?? { declaradas: 40, unidadesActivas: 12 },
    async crearCheckoutEnBase({ userId, tenantId, plan }) {
      if (opciones.errorBase) throw new Error(opciones.errorBase);
      llamadas.crearEnBase.push({ userId, tenantId, planId: plan.id, monto: plan.monto, moneda: plan.moneda });
      return { checkoutId: "chk-1", anteriores: opciones.anteriores ?? [] };
    },
    async registrarCheckoutProveedor(a, b) {
      llamadas.registrar.push([a, b]);
    },
    clienteExistente: async () => null,
  };
  return { d, llamadas };
}

async function main() {
  await seccion("Catálogo: única fuente de montos, MXN pendientes de aprobación", () => {
    assert(MONTOS_PENDIENTES_DE_APROBACION === true, "los montos MXN siguen marcados como pendientes de aprobación comercial");
    assert(Object.keys(CATALOGO_BILLING).join(",") === "hasta-50,hasta-150", "solo hasta-50 y hasta-150 tienen checkout");
    for (const p of Object.values(CATALOGO_BILLING)) {
      assert(p.moneda === "MXN" && Number.isInteger(p.monto) && p.monto > 0 && p.activo, `${p.id}: MXN, centavos enteros, activo`);
    }
    assert(CATALOGO_BILLING["hasta-50"].referenciaUsd === 29 && CATALOGO_BILLING["hasta-150"].referenciaUsd === 49, "referencias comerciales USD 29 / 49");
    const mig = fuente("supabase/migrations/20261008100000_billing_base.sql");
    assert(mig.includes("case p_plan when 'hasta-50' then 50 when 'hasta-150' then 150 end"), "límites de la base = límites del catálogo");
    assert(
      CATALOGO_BILLING["hasta-50"].limiteViviendas === 50 && CATALOGO_BILLING["hasta-150"].limiteViviendas === 150,
      "límites del catálogo 50 / 150",
    );
    // Los montos no se dispersan por el código.
    for (const archivo of ["apps/admin/app/suscripcion/page.tsx", "apps/admin/lib/planes.ts", "apps/admin/lib/billing/checkout.ts", "apps/admin/lib/billing/proveedores/stripe.ts", "apps/admin/lib/billing/servidor.ts"]) {
      assert(!/49_?900|89_?900|\b499\b|\b899\b/.test(fuente(archivo)), `${archivo}: sin montos escritos a mano`);
    }
    assert(formatearMonto({ moneda: "MXN", monto: 49_900 }).includes("499"), "formato de presentación en pesos");
  });

  await seccion("5. planes: solo los del catálogo; mas-150 sin checkout", () => {
    assert(planDeCheckout("hasta-50")?.id === "hasta-50", "hasta-50 válido");
    for (const malo of ["mas-150", "gratis", "", null, undefined, 50, "__proto__", "toString", "HASTA-50"]) {
      assert(planDeCheckout(malo) === null, `${JSON.stringify(malo)} → sin plan`);
    }
  });

  await seccion("6–7. viviendas: max(declaradas, unidades activas)", () => {
    assert(viviendasRequeridas(null, 12) === 12 && viviendasRequeridas(80, 3) === 80 && viviendasRequeridas(10, 80) === 80, "max de ambas");
    assert(!validarPlanParaViviendas("hasta-50", 80).ok, "80 viviendas + hasta-50 → rechazado");
    const r150 = validarPlanParaViviendas("hasta-150", 80);
    assert(r150.ok, "80 viviendas + hasta-150 → permitido");
    assert(validarPlanParaViviendas("hasta-150", 30).ok, "un plan mayor que el necesario está permitido");
    const r151 = validarPlanParaViviendas("hasta-150", 151);
    assert(!r151.ok && r151.motivo === "contacto", ">150 → contacto, sin checkout");
    assert(validarPlanParaViviendas("hasta-50", 50).ok && !validarPlanParaViviendas("hasta-50", 51).ok, "frontera 50 / 51");
  });

  await seccion("1–4, 9–10. quién puede pagar (residencial seleccionado, admin_residencial)", () => {
    const admin = acceso([fila(A, "admin_residencial")]);
    const okAdmin = autorizarBilling("u1", admin);
    assert(okAdmin.ok && okAdmin.tenantId === A, "1. admin_residencial de A, trial vencido → autorizado sobre A");
    assert(permiteAlta(admin), "1. trial vencido → alta permitida");
    assert(!autorizarBilling("u1", acceso([fila(A, "guardia")])).ok, "2. guardia → rechazado");
    assert(!autorizarBilling(null, admin).ok, "sin sesión → rechazado");
    // 3–4. multitenant: el residencial es el SELECCIONADO, con su propio rol.
    const mixto = [fila(A, "admin_residencial"), fila(B, "guardia")];
    const enB = autorizarBilling("u1", acceso(mixto, B));
    assert(!enB.ok && enB.motivo === "rol", "3. seleccionado B (guardia allí) → rechazado aunque sea admin en A");
    const enA = autorizarBilling("u1", acceso(mixto, A));
    assert(enA.ok && enA.tenantId === A, "4. seleccionado A → paga A");
    const sinSeleccion = autorizarBilling("u1", acceso([fila(A, "admin_residencial"), fila(B, "admin_residencial")]));
    assert(!sinSeleccion.ok && sinSeleccion.motivo === "seleccion", "4. dos residenciales sin selección → no se elige uno arbitrario");
    const cookieAjena = autorizarBilling("u1", acceso([fila(A, "admin_residencial")], B));
    assert(!cookieAjena.ok, "3. gf_tenant de un residencial sin membresía → rechazado (falla cerrado)");
    assert(!autorizarBilling("u1", acceso([fila(A, "super_admin")])).ok, "super_admin no paga por este flujo");
    assert(!permiteAlta(acceso([fila(A, "admin_residencial", ACTIVA)])), "9. residencial active → sin alta duplicada");
    assert(!permiteAlta(acceso([fila(A, "admin_residencial", VIGENTE)])), "10. trial vigente → no se cobra todavía");
    assert(!permiteAlta(acceso([fila(A, "admin_residencial", VENCIDA, "suspendido")])), "suspendido → sin alta (soporte)");
    assert(!permiteAlta(acceso([fila(A, "admin_residencial", null)])), "sin suscripción → sin alta (configuración)");
  });

  await seccion("1. checkout válido: base primero, luego Stripe con nuestro checkout_id", async () => {
    const { d, llamadas } = deps();
    const r = await iniciarCheckout(d, { userId: "u1", tenantId: A, planId: "hasta-50", emailPagador: "admin@x.test" });
    assert(r.ok && r.url === "https://checkout.stripe.test/chk-1", "devuelve la URL hospedada");
    const base = llamadas.crearEnBase[0];
    assert(base?.userId === "u1" && base.tenantId === A && base.planId === "hasta-50", "la base recibe usuario, residencial y plan");
    assert(base?.monto === CATALOGO_BILLING["hasta-50"].monto && base.moneda === "MXN", "monto y moneda del catálogo");
    const p = llamadas.proveedor[0];
    assert(p?.checkoutId === "chk-1", "el proveedor recibe NUESTRO checkout_id (client_reference_id)");
    assert(p?.urlExito === "https://admin.gateflow.test/suscripcion/procesando?c=chk-1", "success_url → /suscripcion/procesando?c=<checkout>");
    assert(p?.urlCancelar === "https://admin.gateflow.test/suscripcion", "cancel_url → /suscripcion");
    assert(p?.expiraEn.getTime() === AHORA.getTime() + 60 * 60_000, "la sesión vence en 60 min");
    assert(llamadas.registrar.length === 1 && llamadas.registrar[0]?.[0] === "chk-1" && llamadas.registrar[0]?.[1] === "cs_test_chk-1", "se registra el id del proveedor");
  });

  await seccion("8. el precio del navegador se ignora", async () => {
    const formulario = new FormData();
    formulario.set("plan", "hasta-50");
    formulario.set("monto", "1");
    formulario.set("moneda", "USD");
    formulario.set("tenant_id", B);
    const planId = planIdDeFormulario(formulario);
    assert(planId === "hasta-50", "del formulario solo se lee 'plan'");
    const { d, llamadas } = deps();
    await iniciarCheckout(d, { userId: "u1", tenantId: A, planId, emailPagador: null });
    assert(llamadas.crearEnBase[0]?.monto === CATALOGO_BILLING["hasta-50"].monto && llamadas.crearEnBase[0]?.moneda === "MXN", "monto/moneda siguen siendo los del catálogo");
    assert(llamadas.crearEnBase[0]?.tenantId === A, "el residencial es el autorizado, no el del formulario");
    const accion = fuente("apps/admin/app/suscripcion/actions.ts");
    assert(accion.includes("planId: planIdDeFormulario(formulario)") && !/formulario\.get\("(monto|moneda|tenant)/.test(accion), "la server action solo pasa planId");
    assert(accion.includes("tenantId: autorizacion.tenantId") && accion.includes("autorizarBilling(userId, resultado)"), "el tenant sale de la sesión + gf_tenant");
  });

  await seccion("5–7. planes inválidos o insuficientes no llegan a la base ni a Stripe", async () => {
    for (const [planId, viviendas, motivo] of [
      ["mas-150", 20, "plan"],
      ["gratis", 20, "plan"],
      ["hasta-50", 80, "viviendas"],
      ["hasta-150", 151, "contacto"],
    ] as const) {
      const { d, llamadas } = deps({ viviendas: { declaradas: viviendas, unidadesActivas: 0 } });
      const r = await iniciarCheckout(d, { userId: "u1", tenantId: A, planId, emailPagador: null });
      assert(!r.ok && r.motivo === motivo && llamadas.crearEnBase.length === 0 && llamadas.proveedor.length === 0, `${planId} con ${viviendas} viviendas → ${motivo}, sin efectos`);
    }
  });

  await seccion("2–3, 9–10. la base rechaza (rol, estado, suspendido, límite): sin Stripe", async () => {
    for (const [mensaje, motivo] of [
      ["billing:rol", "rol"],
      ["billing:estado_no_permite", "estado"],
      ["billing:suspendido", "suspendido"],
      ["billing:viviendas", "viviendas"],
      ["billing:limite_intentos", "limite"],
      ["billing:plan", "plan"],
      ["otra cosa", "error"],
    ] as const) {
      const { d, llamadas } = deps({ errorBase: mensaje });
      const r = await iniciarCheckout(d, { userId: "u1", tenantId: A, planId: "hasta-50", emailPagador: null });
      assert(!r.ok && r.motivo === motivo && llamadas.proveedor.length === 0, `${mensaje} → ${motivo}, Stripe no se llama`);
    }
    assert(motivoDeErrorRpc(undefined) === "error", "sin mensaje → error genérico");
  });

  await seccion("34. checkouts anteriores se expiran en el proveedor; fallo del proveedor no registra", async () => {
    const { d, llamadas } = deps({ anteriores: ["cs_viejo_1", "cs_viejo_2"] });
    await iniciarCheckout(d, { userId: "u1", tenantId: A, planId: "hasta-50", emailPagador: null });
    assert(llamadas.expirados.join(",") === "cs_viejo_1,cs_viejo_2", "se expiran los checkouts abiertos anteriores");
    const fallo = deps({ falloProveedor: true });
    const r = await iniciarCheckout(fallo.d, { userId: "u1", tenantId: A, planId: "hasta-50", emailPagador: null });
    assert(!r.ok && r.motivo === "proveedor" && fallo.llamadas.registrar.length === 0, "Stripe caído → error claro, nada registrado (el checkout de la base vence solo)");
  });

  await seccion("Contrato de nombres: servidor.ts ↔ parámetros de las RPC (PostgREST llama por nombre)", () => {
    const mig = fuente("supabase/migrations/20261008100000_billing_base.sql");
    const servidor = fuente("apps/admin/lib/billing/servidor.ts");
    for (const fn of ["billing_crear_checkout", "billing_registrar_checkout_proveedor", "billing_aplicar_evento"]) {
      const firma = new RegExp(`create function public\\.${fn}\\(([^)]*)\\)`).exec(mig)?.[1] ?? "";
      const sql = firma.split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean).sort();
      const llamada = new RegExp(`rpc\\("${fn}", \\{([\\s\\S]*?)\\}\\)`).exec(servidor)?.[1] ?? "";
      const ts = [...llamada.matchAll(/(p_[a-z_]+):/g)].map((m) => m[1]).sort();
      assert(sql.length > 0 && sql.join(",") === ts.join(","), `${fn}: ${ts.join(",")}`);
    }
  });

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
}

void main();
