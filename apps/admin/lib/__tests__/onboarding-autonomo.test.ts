/**
 * Onboarding autónomo: avance real de la configuración, asistente que se
 * puede dejar y retomar, «Primeros pasos», guías de primera visita, ayuda
 * por campo y página de Ayuda.
 *   npx tsx apps/admin/lib/__tests__/onboarding-autonomo.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { obtenerConteosConfiguracion, pasoInicialAsistente, progresoConfiguracion, type ConteosConfiguracion } from "@gateflow/paquetes";
import {
  claveGuiaVista,
  clavePrimerosPasosOculto,
  guardarMarca,
  leerMarca,
  type Almacen,
} from "../../../../packages/ui/src/ayuda/preferencias";
import { MENSAJE_DEMO, WHATSAPP_SOPORTE_VISIBLE, enlaceWhatsAppSoporte } from "../../../../packages/ui/src/ayuda/contacto";
import { GUIAS_ADMIN, PROCESOS_AYUDA } from "../ayuda/guias";
import { GUIAS_GUARD } from "../../../guard/lib/guias";
import { NAV_ITEMS } from "../../components/layout/nav-items";

let pasadas = 0;
let fallidas = 0;
function assert(condicion: boolean, mensaje: string, detalle = "") {
  if (condicion) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}${detalle ? ` (${detalle})` : ""}`);
  }
}
async function seccion(nombre: string, fn: () => void | Promise<void>) {
  console.log(`\n${nombre}`);
  await fn();
}
const REPO = join(__dirname, "..", "..", "..", "..");
const fuente = (ruta: string) => readFileSync(join(REPO, ruta), "utf8");
function listarFuentes(dirs: string[]): string[] {
  const salida: string[] = [];
  const recorrer = (rel: string) => {
    for (const e of readdirSync(join(REPO, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!["node_modules", ".next", "__tests__"].includes(e.name)) recorrer(r);
      } else if (/\.(ts|tsx)$/.test(e.name)) salida.push(r);
    }
  };
  dirs.forEach(recorrer);
  return salida;
}
const conteos = (c: Partial<ConteosConfiguracion> = {}): ConteosConfiguracion => ({ unidades: 0, residentes: 0, ubicaciones: 0, guardias: 0, paquetes: 0, ...c });

/** Cliente falso: registra cada consulta (tabla y filtros) y devuelve el conteo pedido. */
function clienteFalso(respuestas: Record<string, { count: number | null; error?: unknown }>) {
  const consultas: Array<{ tabla: string; filtros: string[] }> = [];
  const cliente = {
    from(tabla: string) {
      const filtros: string[] = [];
      consultas.push({ tabla, filtros });
      const constructor = {
        select: (_c: string, _o: unknown) => constructor,
        eq: (col: string, val: unknown) => (filtros.push(`eq:${col}=${String(val)}`), constructor),
        is: (col: string, val: unknown) => (filtros.push(`is:${col}=${String(val)}`), constructor),
        or: (expr: string) => (filtros.push(`or:${expr}`), constructor),
        then(resolver: (v: unknown) => void) {
          const clave = filtros.some((f) => f.startsWith("or:")) ? `${tabla}+contacto` : tabla;
          const r = respuestas[clave] ?? { count: 0 };
          resolver({ count: r.count, error: r.error ?? null });
        },
      };
      return constructor;
    },
  };
  return { cliente: cliente as never, consultas };
}

void (async () => {
  await seccion("1. Progreso calculado desde los datos reales", () => {
    const vacio = progresoConfiguracion(conteos());
    assert(vacio.total === 5 && vacio.completados === 0 && !vacio.completo, "residencial nuevo: 0 de 5");
    assert(
      JSON.stringify(vacio.pasos.map((p) => [p.clave, p.href])) ===
        JSON.stringify([
          ["unidades", "/unidades"],
          ["residentes", "/residentes"],
          ["ubicaciones", "/configuracion/bodega"],
          ["guardias", "/usuarios"],
          ["paquetes", "/paquetes/nuevo"],
        ]),
      "cada paso enlaza a su sección",
    );
    const parcial = progresoConfiguracion(conteos({ unidades: 12, residentes: 3, guardias: 1 }));
    assert(parcial.completados === 3 && parcial.pasos.find((p) => p.clave === "ubicaciones")?.listo === false, "parcial: 3 de 5");
    const todo = progresoConfiguracion(conteos({ unidades: 1, residentes: 1, ubicaciones: 1, guardias: 1, paquetes: 1 }));
    assert(todo.completo && todo.completados === 5, "todo listo → completo (la tarjeta deja de mostrarse)");
  });

  await seccion("2. Retomar el asistente donde quedó", () => {
    assert(pasoInicialAsistente(conteos(), false) === 1, "nuevo y sin datos → bienvenida");
    assert(pasoInicialAsistente(conteos(), true) === 3, "cerrado sin datos → residentes (no repite la bienvenida)");
    assert(pasoInicialAsistente(conteos({ ubicaciones: 2 }), false) === 3, "con algo configurado ya no muestra la bienvenida");
    assert(pasoInicialAsistente(conteos({ unidades: 5 }), true) === 4, "con unidades → usuarios");
    assert(pasoInicialAsistente(conteos({ residentes: 5, guardias: 1 }), true) === 5, "con residentes y guardia → bodega");
    assert(pasoInicialAsistente(conteos({ unidades: 5, residentes: 5, guardias: 1, ubicaciones: 1 }), true) === 6, "todo → resumen");
  });

  await seccion("3. Conteos: siempre del residencial pedido; si algo falla, no se muestra (nunca bloquea)", async () => {
    const { cliente, consultas } = clienteFalso({
      unidades: { count: 7 },
      "unidades+contacto": { count: 4 },
      residentes_unidades: { count: 2 },
      ubicaciones: { count: 3 },
      user_tenants: { count: 1 },
      paquetes: { count: 0 },
    });
    const c = await obtenerConteosConfiguracion(cliente, "tenant-A");
    assert(JSON.stringify(c) === JSON.stringify({ unidades: 7, residentes: 6, ubicaciones: 3, guardias: 1, paquetes: 0 }), "conteos y residentes = contactos + adicionales", JSON.stringify(c));
    assert(consultas.length === 6 && consultas.every((q) => q.filtros.includes("eq:tenant_id=tenant-A")), "las 6 consultas filtran tenant_id del residencial activo");
    assert(consultas.find((q) => q.tabla === "user_tenants")?.filtros.includes("eq:roles.clave=guardia") ?? false, "guardias: solo rol guardia activo");
    const conError = clienteFalso({ ubicaciones: { count: null, error: { code: "42501" } } });
    assert((await obtenerConteosConfiguracion(conError.cliente, "tenant-A")) === null, "error de lectura → null (sin tarjeta, sin bloqueo)");
  });

  await seccion("4. Preferencias solo en el navegador, sin datos del residencial", () => {
    const memoria = new Map<string, string>();
    const almacen: Almacen = { getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => void memoria.set(k, v), removeItem: (k) => void memoria.delete(k) };
    const clave = claveGuiaVista("unidades", 1, "user-1");
    assert(clave === "gf:ayuda:guia:unidades:v1:user-1", "guía vista: por guía, versión y usuario");
    assert(claveGuiaVista("unidades", 2, "user-1") !== clave, "otra versión del texto → se vuelve a mostrar una vez");
    assert(clavePrimerosPasosOculto("user-1", "tenant-A") !== clavePrimerosPasosOculto("user-1", "tenant-B"), "«Primeros pasos» oculto: por residencial (no se mezcla entre residenciales)");
    assert(!leerMarca(almacen, clave), "sin marca → no vista");
    guardarMarca(almacen, clave, true);
    assert(leerMarca(almacen, clave) && memoria.get(clave) === "1", "marca guardada (solo «1»)");
    guardarMarca(almacen, clave, false);
    assert(!leerMarca(almacen, clave), "marca borrada (volver a mostrar)");
    const roto: Almacen = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); }, removeItem: () => { throw new Error("bloqueado"); } };
    let lanzo = false;
    try {
      guardarMarca(roto, clave, true);
      assert(!leerMarca(roto, clave), "almacenamiento bloqueado → se trata como no vista");
      assert(!leerMarca(null, clave), "sin almacenamiento → no vista");
    } catch {
      lanzo = true;
    }
    assert(!lanzo, "almacenamiento bloqueado o ausente no rompe la página");
  });

  await seccion("5. Contacto de soporte y demostración opcional", () => {
    assert(WHATSAPP_SOPORTE_VISIBLE === "+52 55 2324 8345", "número visible");
    assert(enlaceWhatsAppSoporte().startsWith("https://wa.me/525523248345?text="), "wa.me con el número en dígitos");
    assert(decodeURIComponent(enlaceWhatsAppSoporte(MENSAJE_DEMO).split("text=")[1] ?? "") === MENSAJE_DEMO, "mensaje de demo");
    const ayuda = fuente("apps/admin/app/(app)/ayuda/page.tsx");
    assert(ayuda.includes("Demostración personal (opcional)") && ayuda.includes("No es necesaria"), "la demo es opcional, nunca un requisito");
    assert(ayuda.includes("enlaceWhatsAppSoporte()") && ayuda.includes("enlaceWhatsAppSoporte(MENSAJE_DEMO)"), "soporte y demo por WhatsApp");
    assert(NAV_ITEMS.some((i) => i.href === "/ayuda" && !i.roles), "Ayuda en el menú (escritorio y celular, todos los roles)");
    assert(fuente("apps/guard/app/guard/ayuda/page.tsx").includes("enlaceWhatsAppSoporte()"), "Guard: ayuda con WhatsApp de soporte");
    // Contacto único: WhatsApp. Ningún correo de soporte o comercial en lo que ve el cliente.
    const conCorreo = listarFuentes(["apps/admin/app", "apps/admin/lib", "apps/admin/components", "apps/guard/app", "apps/guard/components", "packages/ui/src"])
      .filter((f) => /(soporte|hola|ventas)@gateflow\.mx/.test(fuente(f)));
    assert(conCorreo.length === 0, "ninguna pantalla muestra soporte@ / hola@gateflow.mx: el contacto es WhatsApp", conCorreo.join(", "));
    const suscripcion = fuente("apps/admin/app/suscripcion/page.tsx");
    assert(!suscripcion.includes("mailto:") && suscripcion.includes("enlaceWhatsAppSoporte(MENSAJE_CONTRATAR)"), "/suscripcion: al vencer la prueba, contratar por WhatsApp (continuidad manual)");
    assert(fuente("apps/admin/lib/planes.ts").includes("enlaceWhatsAppSoporte(MENSAJE_MAS_DE_150)"), "más de 150 viviendas → WhatsApp");
  });

  await seccion("6. Asistente: se puede dejar y retomar, sin borrar ni rehacer nada", () => {
    const pagina = fuente("apps/admin/app/(app)/onboarding/page.tsx");
    assert(!pagina.includes('redirect("/dashboard")'), "ya no expulsa al Dashboard a quien lo terminó: se puede volver a abrir");
    assert(pagina.includes("pasoInicialAsistente(") && pagina.includes("obtenerConteosConfiguracion("), "abre en el primer paso pendiente según los datos reales");
    const asistente = fuente("apps/admin/app/(app)/onboarding/onboarding-wizard.tsx");
    assert((asistente.match(/onboarding_completado: true/g) ?? []).length === 1, "una sola escritura de onboarding_completado (marcarAsistenteCerrado)");
    assert(!asistente.includes("onboarding_completado: false"), "nunca vuelve a imponer el asistente");
    assert(!/\.delete\(|\.remove\(/.test(asistente), "el asistente no borra nada");
    assert(asistente.includes("Seguir más tarde") && !/>\s*Continuar más tarde/.test(asistente), "«Seguir más tarde» (no se confunde con «Continuar»)");
    assert(asistente.includes("useState(props.pasoInicial)") && asistente.includes('aria-current={paso === i + 1 ? "step" : undefined}'), "pasos navegables desde la barra");
    assert(asistente.includes("progreso={props.progreso}") && !asistente.includes("residentesImportados"), "el resumen usa los datos reales, no el estado del navegador");
    assert(asistente.includes("router.refresh()"), "al llegar al resumen se vuelven a leer los datos");
    assert(asistente.includes('window.location.assign("/dashboard")') && !asistente.includes('router.replace("/dashboard")'), "al salir, navegación completa (no reutiliza la redirección guardada a /onboarding)");
    const encabezado = fuente("apps/admin/components/layout/header.tsx");
    assert(encabezado.includes('className="hidden min-w-0 text-right sm:block"') && encabezado.includes("truncate"), "encabezado: un nombre largo no tapa el menú en celular");
    assert(asistente.includes("if (errorSubida) throw errorSubida;"), "un error al subir el logo se muestra");
    assert(asistente.includes('className="grid gap-4 sm:grid-cols-2"') && asistente.includes('className="flex flex-col gap-2 sm:flex-row sm:items-end"'), "formularios en una columna en celular");
    const mw = fuente("apps/admin/middleware.ts");
    assert(mw.includes('if (destino && !(destino === "/onboarding" && esRutaOnboarding)) {'), "middleware sin cambios: el asistente solo se impone la primera vez");
  });

  await seccion("7. «Primeros pasos» no bloquea y se puede ocultar", () => {
    const tarjeta = fuente("apps/admin/components/dashboard/primeros-pasos.tsx");
    assert(tarjeta.includes("if (progreso.completo || !visible) return null;"), "se oculta sola cuando todo está listo");
    assert(tarjeta.includes("Ocultar") && tarjeta.includes("clavePrimerosPasosOculto(usuarioId, tenantId)"), "se puede ocultar (por usuario y residencial)");
    assert(tarjeta.includes("Son recomendaciones: puedes usar Gate Flow aunque falte alguno."), "aclara que no son obligatorios");
    const dashboard = fuente("apps/admin/app/(app)/dashboard/page.tsx");
    assert(dashboard.includes("obtenerConteosConfiguracion(supabase, session.tenant.id)") && dashboard.includes('session.role === "admin_residencial"'), "Dashboard: avance del residencial activo, solo para quien lo configura");
    assert(!/redirect\(/.test(dashboard), "el Dashboard no redirige por pasos pendientes");
  });

  await seccion("8. Guías de primera visita: breves, solo la primera vez, siempre reabribles", () => {
    for (const [ruta, clave] of [
      ["apps/admin/app/(app)/unidades/page.tsx", "unidades"],
      ["apps/admin/app/(app)/residentes/page.tsx", "residentes"],
      ["apps/admin/app/(app)/usuarios/page.tsx", "usuarios"],
      ["apps/admin/app/(app)/configuracion/bodega/page.tsx", "bodega"],
      ["apps/admin/app/(app)/paquetes/page.tsx", "paquetes"],
    ] as const) {
      assert(fuente(ruta).includes(`<GuiaSeccion clave="${clave}" />`), `Admin ${clave}: guía de la sección`);
    }
    assert(fuente("apps/guard/app/guard/packages/register/page.tsx").includes('<GuiaGuard clave="registrar" />'), "Guard: registrar");
    assert(fuente("apps/guard/app/guard/packages/register/page.tsx").includes('<GuiaGuard clave="notificar"'), "Guard: notificar");
    assert(fuente("apps/guard/app/guard/packages/deliver/page.tsx").includes('<GuiaGuard clave="entregar" />'), "Guard: entregar");
    for (const guia of [...Object.values(GUIAS_ADMIN), ...Object.values(GUIAS_GUARD)]) {
      assert(guia.pasos.length >= 2 && guia.pasos.length <= 4 && guia.pasos.every((p) => p.length <= 160), `«${guia.titulo}»: 2 a 4 pasos breves`);
    }
    const claves = [...Object.values(GUIAS_ADMIN), ...Object.values(GUIAS_GUARD)].map((g) => g.clave);
    assert(new Set(claves).size === claves.length, "cada guía con su propia clave");
    const layoutAdmin = fuente("apps/admin/app/(app)/layout.tsx");
    assert(layoutAdmin.includes('!session.impersonando && (decision.tipo === "onboarding" || (decision.tipo === "permitir" && decision.estado === "trial_activo"))'), "Admin: se abren solas solo durante la configuración o la prueba (no en modo soporte)");
    const layoutGuard = fuente("apps/guard/app/guard/layout.tsx");
    assert(layoutGuard.includes('!session.impersonando && decision.tipo === "permitir" && decision.estado === "trial_activo"'), "Guard: solo durante la prueba");
    const guia = fuente("packages/ui/src/ayuda/guia-primera-visita.tsx");
    assert(guia.includes("if (autoMostrar && !leerMarca(almacenDelNavegador(), clave)) setAbierta(true);") && guia.includes("Cómo funciona"), "no repite la guía en cada visita y se reabre con «Cómo funciona»");
    assert(!/fixed inset|role="dialog"|aria-modal/.test(guia), "no es un modal: no bloquea la pantalla");
    assert(guia.includes('aria-label="Ocultar la guía"') && !/aria-label="Cerrar/.test(guia), "su botón no se llama «Cerrar» (no se confunde con el de los formularios abiertos encima)");
    assert(PROCESOS_AYUDA.length >= 6, "Ayuda: procesos principales");
  });

  await seccion("9. Ayuda por campo en registro y asistente", () => {
    const registro = fuente("apps/admin/app/registro/registro-form.tsx");
    for (const campo of ["email", "password", "nombreResidencial", "pais", "viviendas"]) {
      assert(registro.includes(`ayuda={AYUDA_REGISTRO.${campo}}`), `registro: ayuda en ${campo}`);
    }
    assert(registro.includes("hasta ${MAX_VIVIENDAS_AUTOSERVICIO} para registrarte aquí"), "viviendas: el mismo límite que valida el servidor");
    const campo = fuente("packages/ui/src/ayuda/ayuda-campo.tsx");
    assert(campo.includes('type="button"') && campo.includes("aria-expanded={abierta}") && campo.includes("aria-controls={idTexto}"), "botón accesible que no envía el formulario");
    assert(!/onMouseEnter|onMouseOver|title=/.test(campo), "se abre tocando, no al pasar el mouse");
    const asistente = fuente("apps/admin/app/(app)/onboarding/onboarding-wizard.tsx");
    for (const id of ["ob-nombre", "ob-telefono", "ob-invitar-rol", "ob-ubicaciones"]) {
      assert(asistente.includes(`<AyudaCampo id="${id}"`), `asistente: ayuda en ${id}`);
    }
  });

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
})();
