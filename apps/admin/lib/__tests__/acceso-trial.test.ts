/**
 * Ciclo de vida del trial: estados efectivos, avisos y destino por
 * rol en Admin y Guard (@gateflow/auth/acceso.ts). Sin framework:
 *   npx tsx apps/admin/lib/__tests__/acceso-trial.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avisoTrial,
  estadoEfectivoSuscripcion,
  puedeOperar,
  resolverAcceso,
  type DecisionAcceso,
} from "@gateflow/auth/client";
import { decisionPanel, destinoDeDecision, destinoPanelAdmin, destinoTrasAutenticar } from "../acceso-panel";
import { esRutaPublica, RUTAS_CUENTA } from "../rutas-publicas";
import { PLANES } from "../planes";

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

/** a aparece en el texto y antes que b (sin el -1 silencioso de indexOf). */
const antes = (texto: string, a: string, b: string) => texto.indexOf(a) >= 0 && texto.indexOf(b) >= 0 && texto.indexOf(a) < texto.indexOf(b);

function seccion(nombre: string, fn: () => void) {
  console.log(`\n${nombre}`);
  fn();
}

// 12:00 en Ciudad de México (UTC-6).
const AHORA = new Date("2026-10-06T18:00:00Z");
const DIA = 86_400_000;
const GUARD = "https://gateflow-guard-staging.netlify.app";
const TZ = "America/Mexico_City";

const en = (ms: number) => new Date(AHORA.getTime() + ms).toISOString();
const trial = (finMs: number) => ({ estado: "trialing", trial_ends_at: en(finMs) });
const ACTIVA = { estado: "active", trial_ends_at: null };

function m(rol: string, opciones: { sus?: unknown; estadoServicio?: string; onboarding?: boolean; zona?: string } = {}) {
  return {
    roles: { clave: rol },
    tenants: {
      onboarding_completado: opciones.onboarding ?? true,
      estado_servicio: opciones.estadoServicio ?? "activo",
      timezone: opciones.zona ?? TZ,
      suscripciones: "sus" in opciones ? opciones.sus : ACTIVA,
    },
  };
}

const admin = (mem: ReturnType<typeof m> | null) => destinoPanelAdmin(null, mem, GUARD, AHORA);
const guard = (mem: ReturnType<typeof m> | null): DecisionAcceso => resolverAcceso({ error: null, membresia: mem, ahora: AHORA, app: "guard" });
const aviso = (mem: ReturnType<typeof m>) => {
  const d = decisionPanel(null, mem, AHORA);
  return d.tipo === "permitir" ? d.aviso : null;
};

const REPO = join(__dirname, "..", "..", "..", "..");
const fuente = (ruta: string) => readFileSync(join(REPO, ruta), "utf8");

seccion("1–2. trial con 20 y 8 días → Admin normal, indicador discreto", () => {
  for (const dias of [20, 8]) {
    const mem = m("admin_residencial", { sus: trial(dias * DIA) });
    assert(admin(mem) === null, `${dias} días: entra al panel`);
    const a = aviso(mem);
    assert(a?.nivel === "discreto" && a.dias === dias, `${dias} días: discreto (${a?.nivel}, ${a?.dias})`);
    assert(a?.texto === `Prueba gratuita · ${dias} días restantes`, `${dias} días: "${a?.texto}"`);
    assert(guard(m("guardia", { sus: trial(dias * DIA) })).tipo === "permitir", `${dias} días: Guard opera`);
  }
});

seccion("3–4. 7 y 3 días → banner visible, sin bloquear", () => {
  const a7 = aviso(m("admin_residencial", { sus: trial(7 * DIA) }));
  assert(a7?.nivel === "banner" && a7.texto === "Tu prueba gratuita termina en 7 días.", `7 días: ${a7?.nivel} "${a7?.texto}"`);
  const a3 = aviso(m("admin_residencial", { sus: trial(3 * DIA) }));
  assert(a3?.nivel === "urgente" && a3.texto === "Tu prueba gratuita termina en 3 días.", `3 días: ${a3?.nivel} "${a3?.texto}"`);
  assert(admin(m("admin_residencial", { sus: trial(3 * DIA) })) === null, "3 días: sigue entrando");
});

seccion("5–6. mañana y hoy (días de calendario en la zona del residencial)", () => {
  const manana = aviso(m("admin_residencial", { sus: trial(DIA) }));
  assert(manana?.nivel === "manana" && manana.texto === "Tu prueba termina mañana.", `1 día: "${manana?.texto}"`);
  // Termina hoy a las 23:30 hora local (faltan 11.5 h).
  const hoyTarde = aviso(m("admin_residencial", { sus: { estado: "trialing", trial_ends_at: "2026-10-07T05:30:00Z" } }));
  assert(hoyTarde?.nivel === "hoy" && hoyTarde.texto === "Tu prueba termina hoy.", `último día (23:30 local): "${hoyTarde?.texto}"`);
  const hoyPronto = aviso(m("admin_residencial", { sus: trial(60 * 60 * 1000) }));
  assert(hoyPronto?.nivel === "hoy", `último día (1 h): ${hoyPronto?.nivel}`);
  // Termina mañana a las 00:30 local (faltan 12.5 h): es "mañana", no "hoy".
  const madrugada = aviso(m("admin_residencial", { sus: { estado: "trialing", trial_ends_at: "2026-10-07T06:30:00Z" } }));
  assert(madrugada?.nivel === "manana", `00:30 de mañana: ${madrugada?.nivel}`);
  assert(admin(m("admin_residencial", { sus: trial(60 * 60 * 1000) })) === null, "último día: sigue entrando");
});

seccion("Avisos: solo admin_residencial en trial", () => {
  assert(aviso(m("admin_residencial")) === null, "active: sin aviso");
  assert(guard(m("guardia", { sus: trial(2 * DIA) })).tipo === "permitir", "Guard no recibe aviso comercial (decisión sin aviso)");
  const g = guard(m("guardia", { sus: trial(2 * DIA) }));
  assert(g.tipo === "permitir" && g.aviso === null, "Guard: aviso = null");
  const layout = fuente("apps/admin/app/(app)/layout.tsx");
  assert(layout.includes('decision.rol === "admin_residencial" && !session.impersonando ? decision.aviso : null'), "el layout muestra el aviso solo al admin_residencial (no en modo soporte)");
  assert(!fuente("apps/guard/app/guard/layout.tsx").includes("AvisoTrial"), "Guard no renderiza avisos de trial");
});

seccion("7. trial terminado → admin → /suscripcion", () => {
  const mem = m("admin_residencial", { sus: trial(-DIA) });
  assert(admin(mem) === "/suscripcion", `admin vencido → ${admin(mem)}`);
  const d = decisionPanel(null, mem, AHORA);
  assert(d.tipo === "suscripcion" && d.estado === "vencida", "decisión suscripcion:vencida");
  assert(!puedeOperar(d), "no puede operar (server actions)");
});

seccion("8. trial terminado → guardia → servicio no activo", () => {
  const mem = m("guardia", { sus: trial(-DIA) });
  const g = guard(mem);
  assert(g.tipo === "suscripcion", `Guard: ${g.tipo}`);
  assert(admin(mem) === `${GUARD}/guard`, "en Admin se dirige a Guard (Guard resuelve el bloqueo)");
  assert(destinoTrasAutenticar(null, mem, { admin: "/dashboard", guard: "/login" }, GUARD, AHORA).enGuard, "login en Admin → Guard");
  const layout = fuente("apps/guard/app/guard/layout.tsx");
  assert(layout.includes("if (esServicioInactivo(decision)) {\n    redirect(RUTA_SERVICIO_INACTIVO);"), "el layout de Guard redirige a /servicio-inactivo");
  const pagina = fuente("apps/guard/app/servicio-inactivo/page.tsx");
  assert(pagina.includes("El servicio de este residencial no está activo.") && pagina.includes("Contacta al administrador del residencial."), "textos exactos");
  assert(!/USD|precio|plan/i.test(pagina.replace(/\/\*[\s\S]*?\*\//g, "")), "sin precios ni planes para el guardia");
  assert(pagina.includes("<CerrarSesionButton />"), "solo cerrar sesión");
});

seccion("9. trial terminado → super_admin sigue entrando", () => {
  const mem = m("super_admin", { sus: trial(-DIA) });
  assert(admin(mem) === null, "Admin: pasa");
  assert(guard(mem).tipo === "permitir", "Guard: pasa");
  assert(admin(m("super_admin", { sus: null })) === null, "sin suscripción: pasa");
  assert(admin(m("super_admin", { sus: trial(-DIA), estadoServicio: "suspendido" })) === null, "suspendido + vencido: pasa (excepción administrativa)");
});

seccion("10–11. active (alta_manual o registro_publico) → normal", () => {
  for (const origen of ["alta_manual", "registro_publico"]) {
    const mem = m("admin_residencial", { sus: { estado: "active", trial_ends_at: null, origen } });
    assert(admin(mem) === null, `active/${origen}: entra`);
    assert(guard(m("guardia", { sus: { estado: "active", trial_ends_at: null, origen } })).tipo === "permitir", `active/${origen}: Guard opera`);
  }
});

seccion("12. sin suscripción → falla cerrado (estado excepcional)", () => {
  for (const sus of [null, undefined, []]) {
    const mem = m("admin_residencial", { sus });
    const d = decisionPanel(null, mem, AHORA);
    assert(d.tipo === "suscripcion" && d.estado === "sin_suscripcion", `${JSON.stringify(sus)} → suscripcion:sin_suscripcion`);
    assert(guard(m("guardia", { sus })).tipo === "suscripcion", `${JSON.stringify(sus)} → Guard servicio inactivo`);
  }
  assert(estadoEfectivoSuscripcion({ estado: "desconocido", trial_ends_at: null }, AHORA) === "sin_suscripcion", "estado desconocido → sin_suscripcion");
  const pagina = fuente("apps/admin/app/suscripcion/page.tsx");
  assert(pagina.includes("No pudimos determinar una suscripción activa para este residencial."), "texto de problema de configuración");
  assert(pagina.includes('{decision.tipo === "suscripcion" && decision.estado !== "sin_suscripcion" && suscripcion?.estado !== "past_due" && ('), "sin suscripción no muestra planes");
});

seccion("13–14. past_due y canceled → operación bloqueada (inactiva)", () => {
  for (const estado of ["past_due", "canceled"]) {
    const sus = { estado, trial_ends_at: null };
    assert(estadoEfectivoSuscripcion(sus, AHORA) === "inactiva", `${estado} → inactiva`);
    const d = decisionPanel(null, m("admin_residencial", { sus }), AHORA);
    assert(d.tipo === "suscripcion" && d.estado === "inactiva", `${estado}: admin → /suscripcion (inactiva)`);
    assert(guard(m("guardia", { sus })).tipo === "suscripcion", `${estado}: Guard servicio inactivo`);
  }
  const pagina = fuente("apps/admin/app/suscripcion/page.tsx");
  assert(pagina.includes('inactiva: { etiqueta: "Tu suscripción no está activa" }') && pagina.includes('vencida: { etiqueta: "Tu prueba gratuita de 30 días terminó" }'), "texto neutro para inactiva; 'prueba terminó' solo para vencida");
});

seccion("15. tenant suspendido sigue teniendo prioridad", () => {
  for (const sus of [ACTIVA, trial(-DIA), null, { estado: "past_due", trial_ends_at: null }]) {
    assert(admin(m("admin_residencial", { sus, estadoServicio: "suspendido" })) === "/residencial-suspendido", `admin suspendido (${JSON.stringify(sus)}) → /residencial-suspendido`);
    assert(admin(m("guardia", { sus, estadoServicio: "suspendido" })) === "/residencial-suspendido", "guardia suspendido → /residencial-suspendido (no Guard)");
    assert(guard(m("guardia", { sus, estadoServicio: "suspendido" })).tipo === "suspendido", "Guard: suspendido → servicio inactivo");
  }
  // tenants.estado_servicio = cancelado no se redefine.
  assert(admin(m("admin_residencial", { estadoServicio: "cancelado" })) === null, "tenant cancelado + active: admin entra (sin cambios)");
  assert(admin(m("guardia", { estadoServicio: "cancelado" })) === "/sin-acceso?motivo=rol", "tenant cancelado: guardia no va a Guard (sin cambios)");
});

seccion("16. membresía inactiva sigue teniendo prioridad", () => {
  assert(admin(null) === "/sin-acceso", "sin membresía activa → /sin-acceso");
  assert(guard(null).tipo === "sin_acceso", "Guard: sin_acceso");
  assert(destinoPanelAdmin({ code: "PGRST" }, m("admin_residencial", { sus: trial(-DIA) }), GUARD, AHORA) === "/sin-acceso?motivo=error", "error de lectura gana a todo");
  for (const archivo of [
    "apps/admin/middleware.ts",
    "apps/admin/lib/acceso-servidor.ts",
    "apps/guard/lib/acceso-guard.ts",
    "packages/auth/src/get-session.ts",
  ]) {
    assert(/\.eq\("activo", true\)/.test(fuente(archivo)), `${archivo} filtra activo=true`);
  }
});

seccion("17. admin vencido no se salta el bloqueo por URL directa", () => {
  const mem = m("admin_residencial", { sus: trial(-DIA) });
  const destino = admin(mem);
  for (const ruta of ["/", "/dashboard", "/paquetes", "/paquetes/nuevo", "/residentes", "/unidades", "/incidencias", "/configuracion", "/usuarios", "/onboarding"]) {
    assert(!esRutaPublica(ruta) && !(RUTAS_CUENTA as readonly string[]).some((r) => ruta.startsWith(r)), `${ruta} pasa por la verificación del middleware`);
  }
  assert(destino === "/suscripcion", "el destino es /suscripcion (no /onboarding): el asistente también queda bloqueado");
  const mw = fuente("apps/admin/middleware.ts");
  assert(mw.includes("if (user && !esPublica && !esRutaSuperadmin && !esRutaCuenta) {"), "el middleware ya no exime /onboarding");
  assert(mw.includes('if (destino && !(destino === "/onboarding" && esRutaOnboarding)) {'), "solo se omite la redirección a /onboarding estando en /onboarding");
  const layout = fuente("apps/admin/app/(app)/layout.tsx");
  assert(layout.includes('if (decision.tipo !== "permitir" && decision.tipo !== "onboarding") {'), "el layout de (app) bloquea igual aunque el middleware no corra");
  for (const accion of ["apps/admin/app/(app)/onboarding/invitar-usuario-action.ts", "apps/admin/app/(app)/usuarios/actualizar-nombre-usuario-action.ts"]) {
    assert(fuente(accion).includes("if (!(await residencialPuedeOperar())) {"), `${accion}: server action con clave de servicio verifica la operación`);
  }
});

seccion("18. guardia vencido no abre funciones operativas por URL", () => {
  const g = guard(m("guardia", { sus: trial(-DIA) }));
  assert(g.tipo === "suscripcion", "decisión de Guard bloquea");
  const layout = fuente("apps/guard/app/guard/layout.tsx");
  const iDecide = layout.indexOf("leerAccesoGuard(session.user.id)");
  assert(iDecide >= 0 && iDecide < layout.indexOf("<GuardShell"), "el layout de /guard/* decide antes de renderizar cualquier función");
  const escanear = fuente("apps/guard/app/escanear/[token]/page.tsx");
  assert(antes(escanear, "esServicioInactivo(decision)", "buscarPaquetePorPickupToken(supabase"), "/escanear/[token] bloquea antes de consultar el token");
  const mw = fuente("apps/guard/middleware.ts");
  assert(mw.includes('"/servicio-inactivo"'), "/servicio-inactivo es pública (sin bucle)");
  const pagina = fuente("apps/guard/app/servicio-inactivo/page.tsx");
  assert(!pagina.includes("createServerSupabaseClient") && !pagina.includes("redirect("), "/servicio-inactivo no consulta ni redirige");
});

seccion("19. /suscripcion no entra en bucle", () => {
  const casos = [
    m("admin_residencial"),
    m("admin_residencial", { sus: trial(5 * DIA) }),
    m("admin_residencial", { sus: trial(-DIA) }),
    m("admin_residencial", { sus: null }),
    m("admin_residencial", { estadoServicio: "suspendido" }),
    m("admin_residencial", { onboarding: false, sus: trial(30 * DIA) }),
    m("guardia", { sus: trial(-DIA) }),
    m("residente"),
    m("super_admin", { sus: trial(-DIA) }),
    null,
  ];
  for (const mem of casos) {
    const d = decisionPanel(null, mem, AHORA);
    if (d.tipo !== "suscripcion") {
      assert(destinoDeDecision(d, GUARD) !== "/suscripcion", `${d.tipo}: /suscripcion redirige a otra ruta (${destinoDeDecision(d, GUARD) ?? "/dashboard"})`);
    } else {
      assert(admin(mem) === "/suscripcion", "suscripcion: el middleware manda a /suscripcion y la página se muestra");
    }
  }
  assert((RUTAS_CUENTA as readonly string[]).includes("/suscripcion"), "/suscripcion está exenta de la redirección del middleware");
  const pagina = fuente("apps/admin/app/suscripcion/page.tsx");
  assert(pagina.includes('} else if (decision.tipo !== "suscripcion") {\n    redirect(destinoDeDecision(decision) ?? "/dashboard");'), "la página decide con la misma lógica");
  assert(pagina.includes('if (decision.tipo === "permitir") {\n    // Operativo: solo quien administra el residencial ve la gestión.\n    if (!autorizacion.ok) redirect("/dashboard");'), "operativo: gestión solo para admin_residencial");
});

seccion("20. registro nuevo → onboarding y todo disponible", () => {
  const nuevo = m("admin_residencial", { onboarding: false, sus: trial(30 * DIA) });
  assert(admin(nuevo) === "/onboarding", "trialing recién creado → /onboarding");
  assert(puedeOperar(decisionPanel(null, nuevo, AHORA)), "puede operar (p. ej. invitar guardias en el asistente)");
  assert(fuente("apps/admin/app/registro/actions.ts").includes('servicio.rpc("crear_cuenta_prueba"'), "/registro sigue usando crear_cuenta_prueba (sin cambios)");
});

seccion("21. vencer no cambia datos", () => {
  for (const archivo of ["packages/auth/src/acceso.ts", "packages/auth/src/membresias.ts", "apps/admin/lib/acceso-panel.ts", "apps/admin/lib/acceso-servidor.ts", "apps/guard/lib/acceso-guard.ts", "apps/admin/app/suscripcion/page.tsx", "apps/guard/app/servicio-inactivo/page.tsx"]) {
    assert(!/\.(insert|update|upsert|delete)\(|\.rpc\(/.test(fuente(archivo)), `${archivo} no escribe nada`);
  }
  const mig = fuente("supabase/migrations/20261007000000_tenant_operativo.sql");
  assert(!/^\s*(insert|update|delete)\s/im.test(mig.replace(/--.*$/gm, "").replace(/\$function\$[\s\S]*?\$function\$/g, "")), "la migración no modifica filas");
});

seccion("22. frontera exacta de trial_ends_at", () => {
  const fin = AHORA.toISOString();
  assert(estadoEfectivoSuscripcion({ estado: "trialing", trial_ends_at: fin }, AHORA) === "vencida", "ahora = fin → vencida");
  assert(estadoEfectivoSuscripcion({ estado: "trialing", trial_ends_at: en(1) }, AHORA) === "trial_activo", "1 ms antes → trial_activo");
  assert(estadoEfectivoSuscripcion({ estado: "trialing", trial_ends_at: en(-1) }, AHORA) === "vencida", "1 ms después → vencida");
  assert(estadoEfectivoSuscripcion({ estado: "trialing", trial_ends_at: null }, AHORA) === "vencida", "trialing sin fecha → vencida (falla cerrado)");
  assert(estadoEfectivoSuscripcion({ estado: "trialing", trial_ends_at: "no-es-fecha" }, AHORA) === "vencida", "fecha inválida → vencida");
});

seccion("23. la zona horaria no altera el instante de expiración", () => {
  const instante = "2026-10-06T18:00:00Z";
  const mismoConOffset = "2026-10-06T12:00:00-06:00";
  for (const zona of ["America/Mexico_City", "Asia/Tokyo", "America/Argentina/Buenos_Aires", "Zona/Invalida", ""]) {
    const antes = m("admin_residencial", { sus: { estado: "trialing", trial_ends_at: instante }, zona });
    assert(admin(antes) === "/suscripcion", `${zona || "(vacía)"}: en el instante exacto → vencida`);
    const conOffset = m("admin_residencial", { sus: { estado: "trialing", trial_ends_at: mismoConOffset }, zona });
    assert(admin(conOffset) === "/suscripcion", `${zona || "(vacía)"}: mismo instante con offset → vencida`);
    const un_ms_antes = new Date(Date.parse(instante) - 1);
    assert(destinoPanelAdmin(null, antes, GUARD, un_ms_antes) === null, `${zona || "(vacía)"}: 1 ms antes → entra`);
  }
  assert(avisoTrial({ estado: "trialing", trial_ends_at: en(2 * DIA) }, AHORA, "Zona/Invalida") !== null, "zona inválida: aviso con zona de respaldo");
});

seccion("24. active manual nunca se considera trial vencido", () => {
  for (const ahora of [AHORA, new Date("2100-01-01T00:00:00Z")]) {
    assert(estadoEfectivoSuscripcion({ estado: "active", trial_ends_at: null }, ahora) === "activa", `active sin fechas (${ahora.getUTCFullYear()}) → activa`);
    assert(estadoEfectivoSuscripcion({ estado: "active", trial_ends_at: "2020-01-01T00:00:00Z" }, ahora) === "activa", "active con fecha de trial vieja → activa");
  }
  assert(avisoTrial(ACTIVA, AHORA, TZ) === null, "active: sin aviso de trial");
});

seccion("/suscripcion con billing V1: solo planId, sin secretos ni activación desde el navegador", () => {
  assert(PLANES.map((p) => `${p.id}:${p.precio ? "precio" : "-"}:${p.accion.tipo}`).join(",") === "hasta-50:precio:checkout,hasta-150:precio:checkout,mas-150:-:contacto", "planes y acciones");
  const contacto = PLANES.find((p) => p.id === "mas-150")!.accion;
  assert(contacto.tipo === "contacto" && contacto.href.startsWith("mailto:soporte@gateflow.mx"), "más de 150 → mailto:soporte@gateflow.mx (sin checkout)");
  const pagina = fuente("apps/admin/app/suscripcion/page.tsx");
  assert(pagina.includes("<form action={elegirPlanAction}>") && pagina.includes('<input type="hidden" name="plan" value={plan.accion.planId} />') && pagina.includes("Activar plan"), "Activar plan envía solo planId a la server action");
  assert(!/name="(monto|moneda|precio|tenant|tenant_id)"/.test(pagina), "el formulario no envía monto, moneda ni tenant");
  assert(!/from "stripe"|STRIPE_|NEXT_PUBLIC_STRIPE/.test(pagina), "la página no importa el SDK ni lee secretos");
  for (const enlace of ["<CerrarSesionButton", 'href="/terminos"', 'href="/privacidad"', "Soporte"]) {
    assert(pagina.includes(enlace), `siempre disponible: ${enlace}`);
  }
  assert(!/eliminad|perdid|definitiv/i.test(pagina), "sin mensajes alarmistas");
});

seccion("/suscripcion — diseño aprobado (variante B: beneficios compartidos)", () => {
  const pagina = fuente("apps/admin/app/suscripcion/page.tsx");
  assert(pagina.includes("Elige el plan para seguir usando Gate Flow") && pagina.includes("Tu información sigue aquí. Activa tu suscripción y continúa donde lo dejaste."), "cabecera de continuidad");
  // Los beneficios se escriben una sola vez y se muestran en el bloque compartido.
  assert((pagina.match(/"Administradores y guardias ilimitados"/g) ?? []).length === 1 && pagina.includes("Todos los planes de Gate Flow incluyen:"), "beneficios compartidos, no repetidos por tarjeta");
  assert(pagina.includes('const destacado = plan.id === "hasta-150";') && pagina.includes("Más elegido"), "badge solo en Hasta 150");
  // Precio del catálogo, nunca escrito a mano.
  assert(pagina.includes("{plan.precio.texto}") && !/\$\s?\d/.test(pagina), "precio desde el catálogo");
  // Plan no elegible: misma regla, sin mostrar las viviendas del residencial, sin rojo ni ámbar.
  assert(pagina.includes("const noCubre = plan.limiteViviendas !== null && viviendas > plan.limiteViviendas;"), "elegibilidad sin cambios");
  assert(pagina.includes("Tu residencial supera este plan.") && pagina.includes("Este plan cubre hasta {plan.limiteViviendas} viviendas."), "mensaje de plan no elegible");
  assert(!/tiene \{viviendas\}/.test(pagina), "no muestra la cantidad del residencial");
  const tarjeta = pagina.slice(pagina.indexOf("function TarjetaPlan"), pagina.indexOf("function Aviso"));
  assert(!/destructive|warn|red-|amber|yellow/.test(tarjeta), "tarjeta no elegible sin rojo ni ámbar");
  assert(/disabled aria-describedby=\{motivo\}/.test(tarjeta), "CTA deshabilitado explica el motivo");
  // Verde Flujo (primary) es el único verde funcional.
  assert(!/#10B981|emerald|green-/i.test(pagina), "sin un segundo verde en la interfaz");
  assert(pagina.includes("Más de 150 viviendas") === false && pagina.includes("{contacto.nombre}") && pagina.includes("Hablemos") && pagina.includes("Contactar"), "franja >150 desde PLANES (mailto)");
  assert(pagina.includes("Activación inmediata · Pago mensual") && pagina.includes("Pago seguro procesado por Stripe"), "garantías al pie de los planes");
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);
