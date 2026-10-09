/**
 * Zona horaria del residencial: único lugar donde se resuelve.
 *
 * La fuente canónica es `tenants.timezone` (NOT NULL; se fija al dar de
 * alta el residencial). Todo lo que se guarda en la base es `timestamptz`
 * (un instante en UTC) y NO cambia: la zona solo decide cómo se MUESTRA
 * una fecha y qué es "hoy" o "un día" para ese residencial.
 *
 * Sin dependencias (solo Intl): lo usan @gateflow/ui (formato) y
 * @gateflow/paquetes (dashboard por día local, mensaje de WhatsApp).
 */

/**
 * Respaldo SOLO para un valor ausente o inválido (datos legacy o una
 * pantalla sin residencial, como Super Admin). Es la zona con la que se
 * mostraban las fechas antes de respetar la del residencial y el
 * default de la columna, así que lo existente no cambia.
 */
export const ZONA_HORARIA_RESPALDO = "America/Cancun";

const formatosDia = new Map<string, Intl.DateTimeFormat>();
const formatosReloj = new Map<string, Intl.DateTimeFormat>();

/** Nombre IANA que el motor de Intl reconoce. */
export function esZonaHorariaValida(zona: string | null | undefined): zona is string {
  if (typeof zona !== "string" || zona.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

/** La zona del residencial si es válida; si no, la de respaldo. */
export function resolverZonaHoraria(zona: string | null | undefined): string {
  return esZonaHorariaValida(zona) ? zona : ZONA_HORARIA_RESPALDO;
}

function formatoDia(zona: string): Intl.DateTimeFormat {
  let f = formatosDia.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" });
    formatosDia.set(zona, f);
  }
  return f;
}

function formatoReloj(zona: string): Intl.DateTimeFormat {
  let f = formatosReloj.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zona,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatosReloj.set(zona, f);
  }
  return f;
}

/** Día local ("YYYY-MM-DD") de un instante en la zona del residencial. */
export function claveDiaLocal(instante: Date | string | number, zona: string | null | undefined): string {
  return formatoDia(resolverZonaHoraria(zona)).format(new Date(instante));
}

/** Suma (o resta) días de calendario a una clave "YYYY-MM-DD". */
export function sumarDias(clave: string, dias: number): string {
  const [a, m, d] = clave.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Diferencia (ms) entre la hora de pared de la zona y UTC en ese instante. */
function desfase(ms: number, zona: string): number {
  const partes = Object.fromEntries(formatoReloj(zona).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const pared = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    Number(partes.hour),
    Number(partes.minute),
    Number(partes.second),
  );
  return pared - Math.floor(ms / 1000) * 1000;
}

/**
 * Primer instante del día local `clave` en la zona (la medianoche local,
 * o la primera hora existente si un cambio de horario se la saltea).
 * Sirve para filtrar "hoy" o "desde hace N días" con límites reales.
 */
export function inicioDiaLocal(clave: string, zona: string | null | undefined): Date {
  const z = resolverZonaHoraria(zona);
  const [a, m, d] = clave.split("-").map(Number) as [number, number, number];
  const medianocheComoUtc = Date.UTC(a, m - 1, d);
  let t = medianocheComoUtc - desfase(medianocheComoUtc, z);
  t = medianocheComoUtc - desfase(t, z);
  // Medianoche inexistente (el reloj salta de 23:59 a 01:00): el día
  // empieza en el primer instante cuya fecha local ya es `clave`.
  if (claveDiaLocal(t, z) < clave) t += 60 * 60 * 1000;
  return new Date(t);
}
