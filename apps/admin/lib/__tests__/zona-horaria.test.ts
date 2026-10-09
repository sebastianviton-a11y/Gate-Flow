/**
 * Zona horaria del residencial (tenants.timezone) en Admin y Guard (sin
 * red, sin base):
 *   A. Cancún  B. Buenos Aires  C. cambio de día  D. cerca de medianoche
 *   E. cambio de horario (DST)  F. respaldo para datos sin zona
 *   G. dos residenciales, mismo instante UTC
 *   H. regresión: el formato fijo en America/Cancun mostraba mal Argentina
 *   + dashboard "hoy" / gráfico por día local, mensaje de WhatsApp,
 *     zona del alta según el país, y chequeos estáticos (sin hardcode,
 *     sin LOG_FECHAS_TEMPORAL, toda fecha visible recibe la zona).
 *   npx tsx apps/admin/lib/__tests__/zona-horaria.test.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ZONA_HORARIA_RESPALDO,
  claveDiaLocal,
  inicioDiaLocal,
  resolverZonaHoraria,
  sumarDias,
  type Paquete,
} from "@gateflow/types";
import { formatearClaveDia, formatearFecha, formatearFechaHora } from "@gateflow/ui";
import {
  agruparVolumenPorDia,
  construirMensajeNotificacion,
  limitesDiaLocal,
  obtenerResumenDashboard,
  obtenerVolumen30Dias,
} from "@gateflow/paquetes";
import { validarRegistro, zonaCompatibleConPais, zonaHorariaParaRegistro, type CamposCrudos } from "../registro/validacion";

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

const CANCUN = "America/Cancun";
const BSAS = "America/Argentina/Buenos_Aires";
const HORA = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
const hora = (iso: string, zona: string | null) => formatearFechaHora(iso, zona, HORA);

console.log("\nA. Residencial en Cancún");
assert(hora("2026-10-09T15:30:00Z", CANCUN) === "10:30", `15:30 UTC → 10:30 en Cancún (${hora("2026-10-09T15:30:00Z", CANCUN)})`);
assert(formatearFecha("2026-10-09T15:30:00Z", CANCUN) === "9/10/2026", "fecha en Cancún");
assert(claveDiaLocal("2026-10-09T15:30:00Z", CANCUN) === "2026-10-09", "día local en Cancún");

console.log("B. Residencial en Buenos Aires");
assert(hora("2026-10-09T15:30:00Z", BSAS) === "12:30", `15:30 UTC → 12:30 en Buenos Aires (${hora("2026-10-09T15:30:00Z", BSAS)})`);
assert(formatearFecha("2026-10-09T15:30:00Z", BSAS) === "9/10/2026", "fecha en Buenos Aires");
assert(claveDiaLocal("2026-10-09T15:30:00Z", BSAS) === "2026-10-09", "día local en Buenos Aires");

console.log("C. Cambio de día (en UTC ya es mañana)");
// 01:30 UTC del 10 = 22:30 del 9 en Buenos Aires = 20:30 del 9 en Cancún.
const noche = "2026-10-10T01:30:00Z";
assert(claveDiaLocal(noche, "UTC") === "2026-10-10", "en UTC ya es el 10");
assert(claveDiaLocal(noche, BSAS) === "2026-10-09" && hora(noche, BSAS) === "22:30", "en Buenos Aires sigue siendo el 9, 22:30");
assert(claveDiaLocal(noche, CANCUN) === "2026-10-09" && hora(noche, CANCUN) === "20:30", "en Cancún sigue siendo el 9, 20:30");
assert(formatearFecha(noche, BSAS) === "9/10/2026", "la fecha visible en Buenos Aires es el 9, no el 10");
const hoyBsas = limitesDiaLocal(new Date(noche), BSAS);
assert(hoyBsas.desde === "2026-10-09T03:00:00.000Z" && hoyBsas.hasta === "2026-10-10T03:00:00.000Z", `"hoy" en Buenos Aires = 9 de octubre local (${hoyBsas.desde} – ${hoyBsas.hasta})`);
const hoyCancun = limitesDiaLocal(new Date(noche), CANCUN);
assert(hoyCancun.desde === "2026-10-09T05:00:00.000Z" && hoyCancun.hasta === "2026-10-10T05:00:00.000Z", `"hoy" en Cancún = 9 de octubre local (${hoyCancun.desde} – ${hoyCancun.hasta})`);

console.log("D. Cerca de medianoche local");
assert(claveDiaLocal("2026-10-10T02:59:59Z", BSAS) === "2026-10-09", "23:59:59 en Buenos Aires → todavía el 9");
assert(claveDiaLocal("2026-10-10T03:00:00Z", BSAS) === "2026-10-10", "00:00:00 en Buenos Aires → ya el 10");
assert(claveDiaLocal("2026-10-10T04:59:59Z", CANCUN) === "2026-10-09" && claveDiaLocal("2026-10-10T05:00:00Z", CANCUN) === "2026-10-10", "medianoche de Cancún");
const volumen = agruparVolumenPorDia(
  [
    { fecha_recepcion: "2026-10-09T12:00:00Z", estado_id: "entregado" },
    { fecha_recepcion: "2026-10-10T02:59:59Z", estado_id: "recibido" },
    { fecha_recepcion: "2026-10-10T03:00:00Z", estado_id: "recibido" },
  ],
  BSAS,
);
assert(
  JSON.stringify(volumen) ===
    JSON.stringify([
      { fecha: "2026-10-09", recibidosTotal: 2, entregados: 1 },
      { fecha: "2026-10-10", recibidosTotal: 1, entregados: 0 },
    ]),
  `gráfico: el paquete de las 23:59:59 cuenta el 9, el de las 00:00 el 10 (${JSON.stringify(volumen)})`,
);
const volumenUtc = agruparVolumenPorDia([{ fecha_recepcion: "2026-10-10T02:59:59Z", estado_id: "recibido" }], "UTC");
assert(volumenUtc[0]?.fecha === "2026-10-10", "con día UTC (lo de antes) ese mismo paquete caía el 10");

console.log("E. Cambio de horario (DST)");
// Argentina y casi todo México no tienen DST; Tijuana (México) sí.
assert(inicioDiaLocal("2026-03-08", "America/Tijuana").toISOString() === "2026-03-08T08:00:00.000Z", "Tijuana: el 8/3 empieza en horario de invierno (UTC-8)");
assert(inicioDiaLocal("2026-03-09", "America/Tijuana").toISOString() === "2026-03-09T07:00:00.000Z", "Tijuana: el 9/3 empieza en horario de verano (UTC-7)");
const diaCorto = limitesDiaLocal(new Date("2026-03-08T20:00:00Z"), "America/Tijuana");
assert(Date.parse(diaCorto.hasta) - Date.parse(diaCorto.desde) === 23 * 3600_000, "el día del cambio dura 23 h (sin perder ni duplicar paquetes)");
const diaLargo = limitesDiaLocal(new Date("2026-11-01T20:00:00Z"), "America/Tijuana");
assert(Date.parse(diaLargo.hasta) - Date.parse(diaLargo.desde) === 25 * 3600_000, "el día de vuelta dura 25 h");
// Zona donde la medianoche no existe (el reloj salta de 23:59 a 01:00).
assert(inicioDiaLocal("2026-09-06", "America/Santiago").toISOString() === "2026-09-06T04:00:00.000Z", "Santiago: sin medianoche, el día empieza a la 01:00 local");
assert(claveDiaLocal("2026-09-06T04:00:00Z", "America/Santiago") === "2026-09-06" && claveDiaLocal("2026-09-06T03:59:59Z", "America/Santiago") === "2026-09-05", "límites del día sin medianoche");
assert(sumarDias("2026-02-28", 1) === "2026-03-01" && sumarDias("2026-01-01", -1) === "2025-12-31" && sumarDias("2026-10-09", -30) === "2026-09-09", "sumarDias cruza meses y años");

console.log("F. Respaldo para residenciales sin zona (legacy)");
for (const z of [null, undefined, "", "   ", "Marte/Olympus"]) {
  assert(resolverZonaHoraria(z) === ZONA_HORARIA_RESPALDO, `zona ${JSON.stringify(z)} → respaldo`);
}
assert(ZONA_HORARIA_RESPALDO === "America/Cancun", "el respaldo es la zona con la que se mostraba todo antes (y el default de la columna)");
assert(hora("2026-10-09T15:30:00Z", null) === hora("2026-10-09T15:30:00Z", CANCUN), "sin zona se ve igual que antes");
assert(resolverZonaHoraria(BSAS) === BSAS, "una zona válida del residencial nunca se reemplaza");
assert(formatearFechaHora(null, BSAS) === "—" && formatearFecha(undefined, BSAS) === "—", "sin fecha → —");

console.log("G. Dos residenciales, mismo instante UTC");
const instante = "2026-10-10T03:30:00Z";
assert(hora(instante, CANCUN) === "22:30" && claveDiaLocal(instante, CANCUN) === "2026-10-09", "Cancún: 22:30 del 9");
assert(hora(instante, BSAS) === "00:30" && claveDiaLocal(instante, BSAS) === "2026-10-10", "Buenos Aires: 00:30 del 10");
const lCancun = limitesDiaLocal(new Date(instante), CANCUN);
const lBsas = limitesDiaLocal(new Date(instante), BSAS);
assert(lCancun.desde !== lBsas.desde, "cada residencial tiene su propio \"hoy\"");
const v2 = (z: string) => agruparVolumenPorDia([{ fecha_recepcion: instante, estado_id: "recibido" }], z)[0]?.fecha;
assert(v2(CANCUN) === "2026-10-09" && v2(BSAS) === "2026-10-10", "el mismo paquete cae en el día de cada residencial");

console.log("H. Regresión: formato fijo en America/Cancun");
const formatoAnterior = (iso: string) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Cancun", ...HORA });
assert(formatoAnterior("2026-10-09T15:30:00Z") === "10:30", "el formato anterior mostraba 10:30 para todos");
assert(hora("2026-10-09T15:30:00Z", BSAS) !== formatoAnterior("2026-10-09T15:30:00Z"), "Buenos Aires ya no ve la hora de Cancún (fallaría con el hardcode)");
assert(claveDiaLocal(instante, BSAS) !== claveDiaLocal(instante, "America/Cancun"), "ni el día de Cancún");

console.log("Independiente de la zona del servidor o del navegador");
const tzOriginal = process.env.TZ;
for (const tzEntorno of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
  process.env.TZ = tzEntorno;
  assert(
    hora(noche, BSAS) === "22:30" && claveDiaLocal(noche, BSAS) === "2026-10-09" && limitesDiaLocal(new Date(noche), BSAS).desde === "2026-10-09T03:00:00.000Z",
    `entorno en ${tzEntorno}: mismo resultado`,
  );
}
if (tzOriginal === undefined) delete process.env.TZ;
else process.env.TZ = tzOriginal;

console.log("Gráfico: la clave del día no se corre");
assert(formatearClaveDia("2026-10-09", { day: "2-digit", month: "2-digit" }) === "09/10", "\"2026-10-09\" se muestra como 09/10");
const viejoEje = new Date("2026-10-09").toLocaleDateString("es-MX", { timeZone: CANCUN, day: "2-digit", month: "2-digit" });
assert(viejoEje === "08/10", "antes la clave se interpretaba como medianoche UTC y en Cancún se veía el día anterior");

console.log("Dashboard: consultas con los límites del día local");
type ClienteSupabase = Parameters<typeof obtenerResumenDashboard>[0];
interface Llamada {
  tabla: string;
  select?: string;
  filtros: Array<[string, string, unknown]>;
  rango?: [number, number];
}
function supabaseFalso(respuesta: (l: Llamada) => { data?: unknown; count?: number | null; error?: unknown }) {
  const llamadas: Llamada[] = [];
  const cliente = {
    from(tabla: string) {
      const l: Llamada = { tabla, filtros: [] };
      llamadas.push(l);
      const b = {
        select(c: string) {
          l.select = c;
          return b;
        },
        eq(c: string, v: unknown) {
          l.filtros.push(["eq", c, v]);
          return b;
        },
        gte(c: string, v: unknown) {
          l.filtros.push(["gte", c, v]);
          return b;
        },
        lt(c: string, v: unknown) {
          l.filtros.push(["lt", c, v]);
          return b;
        },
        order() {
          return b;
        },
        range(a: number, z: number) {
          l.rango = [a, z];
          return b;
        },
        maybeSingle() {
          return b;
        },
        then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
          return Promise.resolve({ data: null, count: null, error: null, ...respuesta(l) }).then(ok, ko);
        },
      };
      return b;
    },
  };
  return { cliente: cliente as unknown as ClienteSupabase, llamadas };
}
const filtro = (l: Llamada | undefined, op: string, col: string) => l?.filtros.find(([o, c]) => o === op && c === col)?.[2];

async function dashboard() {
  const tenantBsas = "00000000-0000-0000-0000-0000000000ba";
  {
    const { cliente, llamadas } = supabaseFalso((l) =>
      l.tabla === "v_dashboard_resumen"
        ? { data: { pendientes: 4, olvidados: 1, horas_promedio_entrega_30d: 6 } }
        : { count: filtro(l, "eq", "estado_id") === "recibido" ? 3 : 2 },
    );
    const r = await obtenerResumenDashboard(cliente, tenantBsas, BSAS, new Date(noche));
    assert(r.pendientes === 4 && r.olvidados === 1 && r.horasPromedioEntrega30d === 6, "pendientes, olvidados y promedio vienen de la vista (no dependen del día)");
    assert(r.recibidosHoy === 3 && r.entregadosHoy === 2, "recibidos/entregados de hoy se cuentan por día local");
    const vista = llamadas.find((l) => l.tabla === "v_dashboard_resumen");
    assert(!!vista && !/recibidos_hoy|entregados_hoy/.test(vista.select ?? ""), "ya no se usan los \"hoy\" de la vista (CURRENT_DATE en UTC)");
    const rec = llamadas.find((l) => l.tabla === "paquetes" && filtro(l, "eq", "estado_id") === "recibido");
    const ent = llamadas.find((l) => l.tabla === "paquetes" && filtro(l, "eq", "estado_id") === "entregado");
    assert(
      filtro(rec, "gte", "fecha_recepcion") === "2026-10-09T03:00:00.000Z" && filtro(rec, "lt", "fecha_recepcion") === "2026-10-10T03:00:00.000Z" && filtro(rec, "eq", "tenant_id") === tenantBsas,
      "recibidos hoy: recepción dentro del día local de Buenos Aires, solo su residencial",
    );
    assert(
      filtro(ent, "gte", "fecha_entrega") === "2026-10-09T03:00:00.000Z" && filtro(ent, "lt", "fecha_entrega") === "2026-10-10T03:00:00.000Z" && filtro(ent, "eq", "tenant_id") === tenantBsas,
      "entregados hoy: entrega dentro del día local de Buenos Aires, solo su residencial",
    );
  }
  {
    const { cliente } = supabaseFalso((l) => (l.tabla === "v_dashboard_resumen" ? { data: null } : { error: { message: "x" } }));
    let lanzo = false;
    try {
      await obtenerResumenDashboard(cliente, tenantBsas, BSAS, new Date(noche));
    } catch {
      lanzo = true;
    }
    assert(lanzo, "un error al contar \"hoy\" no se oculta como 0");
  }
  {
    const filas = Array.from({ length: 1000 }, () => ({ fecha_recepcion: "2026-10-09T12:00:00Z", estado_id: "entregado" }));
    const { cliente, llamadas } = supabaseFalso((l) => ({ data: l.rango?.[0] === 0 ? filas : [{ fecha_recepcion: "2026-10-10T02:00:00Z", estado_id: "recibido" }] }));
    const v = await obtenerVolumen30Dias(cliente, tenantBsas, BSAS, new Date(noche));
    assert(llamadas.every((l) => l.tabla === "paquetes"), "el gráfico ya no lee mv_dashboard_diario (día UTC)");
    assert(filtro(llamadas[0], "gte", "fecha_recepcion") === "2026-09-09T03:00:00.000Z" && filtro(llamadas[0], "eq", "tenant_id") === tenantBsas, "desde el inicio local de hace 30 días, solo su residencial");
    assert(llamadas.length === 2 && llamadas[1]?.rango?.[0] === 1000, "pagina de a 1000 filas");
    assert(JSON.stringify(v) === JSON.stringify([{ fecha: "2026-10-09", recibidosTotal: 1001, entregados: 1000 }]), "agrupa todas las páginas por día local");
  }
  {
    const { cliente } = supabaseFalso(() => ({ error: { message: "sin permiso" } }));
    const v = await obtenerVolumen30Dias(cliente, tenantBsas, BSAS, new Date(noche));
    assert(Array.isArray(v) && v.length === 0, "si falla, el gráfico queda vacío sin romper el dashboard");
  }
}

console.log("WhatsApp: fecha del aviso en la hora del residencial");
const paquete = {
  codigoGateflow: "GF-0001",
  unidadIdentificador: "Calle 1",
  empresaPaqueteria: null,
  fechaRecepcion: noche,
} as unknown as Paquete;
const msgBsas = construirMensajeNotificacion(paquete, "Res", "Ana", undefined, BSAS);
const msgCancun = construirMensajeNotificacion(paquete, "Res", "Ana", undefined, CANCUN);
const lineaFecha = (m: string) => m.split("\n").find((l) => l.startsWith("Fecha de recepción:")) ?? "";
assert(/^Fecha de recepción: 9\/10\/2026 10:30 p\.\s?m\.$/.test(lineaFecha(msgBsas)), `Buenos Aires: 9/10/2026 10:30 p. m. (${lineaFecha(msgBsas)})`);
assert(/^Fecha de recepción: 9\/10\/2026 08:30 p\.\s?m\.$/.test(lineaFecha(msgCancun)), `Cancún: 9/10/2026 08:30 p. m. (${lineaFecha(msgCancun)})`);
process.env.TZ = "Asia/Tokyo";
assert(construirMensajeNotificacion(paquete, "Res", "Ana", undefined, BSAS) === msgBsas, "no depende de la zona del navegador de quien registra");
if (tzOriginal === undefined) delete process.env.TZ;
else process.env.TZ = tzOriginal;

console.log("Alta: zona del navegador solo si es del país elegido");
assert(zonaHorariaParaRegistro("America/Cancun", "AR") === BSAS, "AR desde un navegador en Cancún → Buenos Aires (caso real de staging)");
assert(zonaHorariaParaRegistro("America/Argentina/Cordoba", "AR") === "America/Argentina/Cordoba", "AR con zona argentina → se conserva");
assert(zonaHorariaParaRegistro("America/Buenos_Aires", "AR") === "America/Buenos_Aires", "AR con alias antiguo argentino → se conserva");
assert(zonaHorariaParaRegistro("America/Argentina/Buenos_Aires", "MX") === "America/Mexico_City", "MX desde un navegador en Argentina → Ciudad de México");
assert(zonaHorariaParaRegistro("America/Cancun", "MX") === CANCUN && zonaHorariaParaRegistro("America/Tijuana", "MX") === "America/Tijuana", "MX con zona mexicana → se conserva");
for (const tz of ["", "Marte/Olympus", "UTC", "Etc/UTC", "Europe/Madrid", "America/Santiago", "America/Montevideo"]) {
  assert(zonaHorariaParaRegistro(tz, "AR") === BSAS && zonaHorariaParaRegistro(tz, "MX") === "America/Mexico_City", `${JSON.stringify(tz)} → zona del país`);
}
assert(!zonaCompatibleConPais("America/Argentina", "AR") && !zonaCompatibleConPais("America/Mexico_City_X", "MX"), "sin coincidencias parciales");
const camposAlta = (pais: string, timezone: string): CamposCrudos => ({
  nombreCompleto: "Ana Pérez",
  email: "ana@example.com",
  password: "contraseña-segura-1",
  nombreResidencial: "Residencial Sintético",
  pais,
  viviendas: "20",
  aceptaTerminos: "on",
  timezone,
  sitio_web: "",
  t: "x",
});
const altaAr = validarRegistro(camposAlta("AR", "America/Cancun"));
assert(altaAr.ok && altaAr.datos.timezone === BSAS, "validarRegistro AR + navegador en Cancún → timezone Buenos Aires");
const altaMx = validarRegistro(camposAlta("MX", "America/Cancun"));
assert(altaMx.ok && altaMx.datos.timezone === CANCUN, "validarRegistro MX + navegador en Cancún → Cancún (sin cambios para México)");

console.log("Chequeos estáticos");
const utils = fuente("packages/ui/src/utils.ts");
assert(!utils.includes("America/Cancun") && !utils.includes("ZONA_HORARIA_GATEFLOW"), "el formato ya no fija America/Cancun");
function archivos(dir: string): string[] {
  const abs = join(RAIZ, dir);
  return readdirSync(abs).flatMap((n) => {
    if (n === "node_modules" || n === ".next" || n === "__tests__") return [];
    const p = join(abs, n);
    return statSync(p).isDirectory() ? archivos(relative(RAIZ, p)) : /\.(ts|tsx)$/.test(n) ? [relative(RAIZ, p)] : [];
  });
}
const codigo = ["apps/admin/app", "apps/admin/components", "apps/admin/lib", "apps/guard/app", "apps/guard/components", "packages/ui/src", "packages/paquetes/src", "packages/auth/src", "packages/types/src"].flatMap(archivos);
assert(codigo.length > 100, `se revisan los fuentes de Admin, Guard y paquetes (${codigo.length})`);
const conLog = codigo.filter((f) => fuente(f).includes("LOG_FECHAS_TEMPORAL") || fuente(f).includes("[GateFlow][fechas]"));
assert(conLog.length === 0, `LOG_FECHAS_TEMPORAL apagado y eliminado (${conLog.join(", ")})`);
const sinZona: string[] = [];
for (const f of codigo) {
  for (const m of fuente(f).matchAll(/formatearFecha(?:Hora)?\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
    if (f === "packages/ui/src/utils.ts") continue;
    if (!(m[1] ?? "").includes(",")) sinZona.push(`${f}: ${m[0]}`);
  }
}
assert(sinZona.length === 0, `toda fecha visible recibe la zona (${sinZona.join(" | ")})`);
// toLocale*String de fechas sin timeZone explícita (dependería del servidor o del navegador).
const PERMITIDOS = [
  "packages/ui/src/debug-console.tsx", // hora del propio dispositivo en la consola de diagnóstico
  "apps/admin/app/superadmin/page.tsx", // números (t.valor), no fechas
];
const sueltos: string[] = [];
for (const f of codigo) {
  if (PERMITIDOS.includes(f)) continue;
  fuente(f)
    .split("\n")
    .forEach((linea, i) => {
      if (/toLocale(?:Date|Time)?String\(/.test(linea) && !/timeZone/.test(linea)) sueltos.push(`${f}:${i + 1}`);
    });
}
assert(sueltos.length === 0, `sin toLocaleString de fechas sin zona (${sueltos.join(", ")})`);
const sesion = fuente("packages/auth/src/get-session.ts");
assert((sesion.match(/\btimezone\b/g) ?? []).length >= 4, "la sesión lee tenants.timezone (residencial propio e impersonación de soporte)");
assert(/obtenerResumenDashboard\(supabase, session\.tenant\.id, session\.tenant\.timezone\)/.test(fuente("apps/admin/app/(app)/dashboard/page.tsx")), "el dashboard pasa la zona del residencial");
assert(/construirEnlaceWhatsApp\([^)]*session\.tenant\.timezone/.test(fuente("apps/admin/app/(app)/paquetes/nuevo/formulario-registro.tsx")), "el aviso de WhatsApp usa la zona del residencial");
const migraciones = readdirSync(join(RAIZ, "supabase/migrations"));
assert(!migraciones.some((m) => /zona|timezone/i.test(m)), "sin migraciones nuevas: la base sigue igual (UTC)");

dashboard().then(
  () => {
    console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
    if (fallidas > 0) process.exit(1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
