import type { Paquete } from "@gateflow/types";

/**
 * Normaliza un teléfono capturado en cualquier formato humano (espacios,
 * guiones, paréntesis, +52 opcional) al formato que exige wa.me: solo
 * dígitos, con código de país. Sin esto, wa.me abre un chat vacío o falla
 * silenciosamente si el número trae caracteres no numéricos.
 *
 * Asume México (52) cuando el número no incluye ya un código de país —
 * es una asunción razonable para el mercado actual de GateFlow, no una
 * regla universal; si el producto se expande a otros países, esto debe
 * volverse configurable por tenant en vez de hardcodeado.
 */
export function normalizarTelefonoWhatsApp(telefono: string): string {
  const soloDigitos = telefono.replace(/\D/g, "");
  if (soloDigitos.startsWith("52") && soloDigitos.length >= 12) return soloDigitos;
  if (soloDigitos.length === 10) return `52${soloDigitos}`;
  return soloDigitos;
}

export interface EnlaceWhatsApp {
  url: string;
  telefono: string;
}

/**
 * Construye el enlace wa.me para avisar al residente que llegó su
 * paquete. Devuelve null si no hay ningún teléfono disponible (ni
 * residente formal ni contacto informal) — quien llama debe mostrar
 * "Este residente no tiene un número de WhatsApp registrado." en ese
 * caso, no ocultar el botón silenciosamente ni bloquear el registro.
 */
export function construirEnlaceWhatsApp(paquete: Paquete, residencialNombre: string, destinatarioNombre: string): EnlaceWhatsApp | null {
  const telefonoCrudo = paquete.residenteTelefono ?? paquete.contactoTelefono;
  if (!telefonoCrudo) return null;

  const telefono = normalizarTelefonoWhatsApp(telefonoCrudo);
  if (!telefono) return null;

  const mensaje =
    `Hola, ${destinatarioNombre}. Recibimos un paquete para tu vivienda ${paquete.unidadIdentificador} ` +
    `en la caseta de ${residencialNombre}. Puedes pasar a recogerlo. Folio: ${paquete.codigoGateflow}.`;

  return {
    telefono,
    url: `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`,
  };
}
