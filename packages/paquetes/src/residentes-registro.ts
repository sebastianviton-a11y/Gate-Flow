import type { UnidadConResidentes } from "@gateflow/types";
import { normalizarTelefonoWhatsApp } from "./whatsapp";

/**
 * Validación del registro de residentes por enlace. La misma función
 * corre en el navegador (marca cada campo antes de avanzar), en el
 * servidor (antes de llamar a la base) y en la revisión del
 * administrador. La base repite las reglas esenciales
 * (fn_residente_* en 20261011000000_residentes_enlace.sql).
 *
 * Lo que NO puede detectar: un número con formato válido pero de otra
 * persona, o una dirección bien escrita pero equivocada. Por eso el
 * formulario muestra un resumen para confirmar y el administrador
 * revisa antes de aprobar.
 */

export type PaisResidencial = "AR" | "MX";
export type CampoResidente = "nombre" | "apellido" | "direccion" | "whatsapp";

export const LIMITES_RESIDENTE = { nombre: 60, apellido: 60, direccionMin: 2, direccionMax: 120 } as const;

export const PREFIJO_WHATSAPP: Record<PaisResidencial, string> = { AR: "+54 9", MX: "+52" };
export const EJEMPLO_WHATSAPP: Record<PaisResidencial, string> = { AR: "11 2345 6789", MX: "998 123 4567" };
export const AYUDA_WHATSAPP: Record<PaisResidencial, string> = {
  AR: "Código de área y número, sin el 0 ni el 15.",
  MX: "Los 10 dígitos de tu número.",
};

// Letras latinas con acentos, ñ y ü: el mismo rango que la base.
const LETRA = "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F";
const RE_NOMBRE = new RegExp(`^[${LETRA}]+(?:[ '\\u2019-][${LETRA}]+)*$`);
const RE_SOLO_PERMITIDOS_NOMBRE = new RegExp(`^[${LETRA} '\\u2019-]*$`);
const RE_ALGUN_ALFANUMERICO = new RegExp(`[0-9${LETRA}]`);
// eslint-disable-next-line no-control-regex
const RE_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Quita espacios al principio y al final y deja uno solo entre palabras. No toca ningún otro carácter. */
export function limpiarEspacios(valor: string): string {
  return valor.replace(/[\s ]+/g, " ").trim();
}

function validarParteNombre(valor: string, etiqueta: "nombre" | "apellido"): string | null {
  if (!valor) return etiqueta === "nombre" ? "Escribe tu nombre." : "Escribe tu apellido.";
  if (valor.length > LIMITES_RESIDENTE[etiqueta]) return `Máximo ${LIMITES_RESIDENTE[etiqueta]} caracteres.`;
  if (/\d/.test(valor)) return `El ${etiqueta} no puede tener números.`;
  if (!RE_SOLO_PERMITIDOS_NOMBRE.test(valor)) return "Usa solo letras. Para separar, un espacio, un apóstrofo (') o un guion (-).";
  if (!RE_NOMBRE.test(valor)) return "Los espacios, apóstrofos y guiones van entre letras: no al principio, al final ni dos seguidos.";
  return null;
}

function validarDireccion(valor: string): string | null {
  if (!valor) return "Escribe tu dirección dentro del residencial.";
  if (RE_CONTROL.test(valor)) return "La dirección tiene caracteres que no se pueden guardar.";
  if (!RE_ALGUN_ALFANUMERICO.test(valor)) return "Incluye la calle y el número, o la torre y el departamento.";
  if (valor.length < LIMITES_RESIDENTE.direccionMin) return "La dirección es demasiado corta.";
  if (valor.length > LIMITES_RESIDENTE.direccionMax) return `Máximo ${LIMITES_RESIDENTE.direccionMax} caracteres.`;
  return null;
}

export type ResultadoWhatsApp = { ok: true; normalizado: string } | { ok: false; error: string };

const RE_CARACTERES_TELEFONO = /^\+?[0-9\s().-]*$/;

function digitosNacionales(cantidad: number, esperados: number, ejemplo: string): string | null {
  if (cantidad < esperados) return `Faltan dígitos: escribiste ${cantidad} y el número tiene ${esperados} (por ejemplo, ${ejemplo}).`;
  if (cantidad > esperados) return `Sobran dígitos: escribiste ${cantidad} y el número tiene ${esperados} (por ejemplo, ${ejemplo}).`;
  return null;
}

/**
 * Valida y normaliza el WhatsApp según el país del residencial (nunca
 * elegido por quien completa el formulario). Acepta el número con o sin
 * el código de país una vez; rechaza el código repetido, los dígitos de
 * más o de menos y los caracteres que no son de un teléfono.
 * El resultado es un punto fijo de normalizarTelefonoWhatsApp: el enlace
 * de WhatsApp que arma la guardia apunta al mismo número.
 */
export function validarWhatsApp(entrada: string, pais: PaisResidencial): ResultadoWhatsApp {
  const texto = entrada.trim();
  if (!texto) return { ok: false, error: "Escribe tu número de WhatsApp." };
  if (!RE_CARACTERES_TELEFONO.test(texto)) {
    return { ok: false, error: "Usa solo números. Puedes separarlos con espacios o guiones." };
  }
  let d = texto.replace(/\D/g, "");
  let internacional = texto.startsWith("+");
  if (!internacional && d.startsWith("00")) {
    internacional = true;
    d = d.slice(2);
  }
  const resultado = pais === "AR" ? nacionalArgentina(d, internacional) : nacionalMexico(d, internacional);
  if ("error" in resultado) return { ok: false, error: resultado.error };
  const normalizado = (pais === "AR" ? "549" : "52") + resultado.nacional;
  // Defensa: lo que aceptamos siempre es estable para la regla existente.
  if (normalizarTelefonoWhatsApp(normalizado, pais) !== normalizado) {
    return { ok: false, error: "Revisa el número: no pudimos interpretarlo." };
  }
  return { ok: true, normalizado };
}

function nacionalMexico(d: string, internacional: boolean): { nacional: string } | { error: string } {
  const repetido = "El código de país +52 está repetido. Escribe solo los 10 dígitos de tu número.";
  let n = d;
  if (internacional) {
    if (!n.startsWith("52")) return { error: "El número debe ser de México (+52). Escribe solo los 10 dígitos." };
    n = n.slice(2);
  } else if (n.length >= 12 && n.startsWith("52")) {
    n = n.slice(2);
  }
  if (n.length >= 12 && n.startsWith("52")) return { error: repetido };
  // Prefijo móvil anterior a 2019 ("+52 1 …"): se acepta y se quita.
  if (n.length === 11 && n.startsWith("1") && (internacional || d.startsWith("521"))) n = n.slice(1);
  const largo = digitosNacionales(n.length, 10, "998 123 4567");
  if (largo) return { error: largo };
  if (/^[01]/.test(n)) return { error: "Los números de México no empiezan con 0 ni con 1. Revisa el primer dígito." };
  return { nacional: n };
}

function nacionalArgentina(d: string, internacional: boolean): { nacional: string } | { error: string } {
  const repetido = "El código de país +54 9 está repetido. Escribe solo el código de área y el número.";
  const ejemplo = "11 2345 6789";
  let n = d;
  if (internacional) {
    if (!n.startsWith("54")) return { error: "El número debe ser de Argentina (+54). Escribe el código de área y el número." };
    n = n.slice(2);
    if (n.startsWith("9")) n = n.slice(1);
  } else if (n.length === 13 && n.startsWith("549")) {
    n = n.slice(3);
  } else if (n.length === 12 && n.startsWith("54")) {
    n = n.slice(2);
  }
  if (n.length >= 12 && (n.startsWith("549") || n.startsWith("54"))) return { error: repetido };
  // Formatos locales que la regla existente ya entiende: 0 inicial, 15
  // después del código de área y el 9 de celular escrito a mano.
  if (n.startsWith("0")) n = n.slice(1);
  if (n.length === 11 && n.startsWith("9")) n = n.slice(1);
  if (n.length === 12) {
    for (const largoArea of [2, 3, 4]) {
      if (n.slice(largoArea, largoArea + 2) === "15") {
        n = n.slice(0, largoArea) + n.slice(largoArea + 2);
        break;
      }
    }
  }
  // "15 2345 6789": el celular sin código de área (10 dígitos que parecen válidos).
  if (n.startsWith("15")) return { error: "Falta el código de área: escríbelo antes del número, sin el 15 (por ejemplo, 11 2345 6789)." };
  const largo = digitosNacionales(n.length, 10, ejemplo);
  if (largo) return { error: `${largo} Sin el 0 ni el 15.` };
  // Los códigos de área de Argentina empiezan con 11, 2 o 3.
  if (!/^(11|[23])/.test(n)) return { error: "Revisa el código de área: en Argentina empieza con 11, 2 o 3." };
  return { nacional: n };
}

/** Para mostrar en el resumen: "+52 998 123 4567" o "+54 9 11 2345 6789". */
export function formatearWhatsApp(normalizado: string, pais: PaisResidencial): string {
  if (pais === "AR" && /^549\d{10}$/.test(normalizado)) {
    const n = normalizado.slice(3);
    return `+54 9 ${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`;
  }
  if (pais === "MX" && /^52\d{10}$/.test(normalizado)) {
    const n = normalizado.slice(2);
    return `+52 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  return `+${normalizado}`;
}

/** Para listados: los WhatsApp normalizados (549… / 52…) con formato;
 * los cargados a mano, tal como se escribieron. */
export function telefonoParaMostrar(telefono: string, pais: PaisResidencial): string {
  return /^(549|52)\d{10}$/.test(telefono) ? formatearWhatsApp(telefono, pais) : telefono;
}

export interface DatosResidente {
  nombre: string;
  apellido: string;
  direccion: string;
  whatsapp: string;
}

export type ValidacionResidente =
  | { ok: true; datos: { nombre: string; apellido: string; direccion: string; telefono: string } }
  | { ok: false; errores: Partial<Record<CampoResidente, string>>; limpios: DatosResidente };

export function validarDatosResidente(entrada: DatosResidente, pais: PaisResidencial): ValidacionResidente {
  const limpios: DatosResidente = {
    nombre: limpiarEspacios(entrada.nombre ?? ""),
    apellido: limpiarEspacios(entrada.apellido ?? ""),
    direccion: limpiarEspacios(entrada.direccion ?? ""),
    whatsapp: (entrada.whatsapp ?? "").trim(),
  };
  const errores: Partial<Record<CampoResidente, string>> = {};
  const eNombre = validarParteNombre(limpios.nombre, "nombre");
  if (eNombre) errores.nombre = eNombre;
  const eApellido = validarParteNombre(limpios.apellido, "apellido");
  if (eApellido) errores.apellido = eApellido;
  const eDireccion = validarDireccion(limpios.direccion);
  if (eDireccion) errores.direccion = eDireccion;
  const tel = validarWhatsApp(limpios.whatsapp, pais);
  if (!tel.ok) errores.whatsapp = tel.error;
  if (Object.keys(errores).length > 0 || !tel.ok) return { ok: false, errores, limpios };
  return {
    ok: true,
    datos: { nombre: limpios.nombre, apellido: limpios.apellido, direccion: limpios.direccion, telefono: tel.normalizado },
  };
}

/** Error de un solo campo (para validar al salir de cada campo). */
export function errorCampoResidente(campo: CampoResidente, valor: string, pais: PaisResidencial): string | null {
  const v = campo === "whatsapp" ? valor.trim() : limpiarEspacios(valor);
  if (campo === "nombre" || campo === "apellido") return validarParteNombre(v, campo);
  if (campo === "direccion") return validarDireccion(v);
  const tel = validarWhatsApp(v, pais);
  return tel.ok ? null : tel.error;
}

export function esPaisResidencial(valor: unknown): valor is PaisResidencial {
  return valor === "AR" || valor === "MX";
}

/** Alguien a quien la guardia puede avisar por WhatsApp en una vivienda. */
export interface DestinatarioVivienda {
  /** "contacto" o el id de la persona en residentes_unidades. */
  clave: string;
  nombre: string;
  telefono: string | null;
}

/**
 * A quién se puede avisar en una vivienda: su contacto y las personas
 * adicionales aprobadas por la administración (nunca solicitudes
 * pendientes: la guardia no las ve).
 */
export function destinatariosDeVivienda(
  u: Pick<UnidadConResidentes, "contactoNombre" | "contactoTelefono" | "adicionales"> | null,
): DestinatarioVivienda[] {
  if (!u) return [];
  const lista: DestinatarioVivienda[] = [];
  if (u.contactoNombre || u.contactoTelefono) {
    lista.push({ clave: "contacto", nombre: u.contactoNombre ?? "Contacto de la vivienda", telefono: u.contactoTelefono ?? null });
  }
  for (const a of u.adicionales ?? []) lista.push({ clave: a.id, nombre: a.nombre, telefono: a.telefono });
  return lista;
}

/** Id de la persona que queda en el paquete (destinatario_residente_id); null para el contacto. */
export function idPersonaDestinataria(d: DestinatarioVivienda | null): string | null {
  return d && d.clave !== "contacto" ? d.clave : null;
}
