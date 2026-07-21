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
 * Construye el mensaje completo de notificación — mismo texto que se usa
 * tanto para el enlace wa.me como para "Copiar mensaje" (una sola función,
 * para que las dos vías nunca puedan mostrar textos distintos).
 *
 * Incluye el enlace para VER el QR (no intenta adjuntar la imagen) —
 * wa.me nunca puede adjuntar un archivo, solo texto, así que un enlace
 * dentro del mismo mensaje es la única forma de que "un solo toque, un
 * solo mensaje" incluya también el QR, sin depender de que el sistema
 * deje elegir a quién compartir una imagen por separado.
 */
export function construirMensajeNotificacion(
  paquete: Paquete,
  residencialNombre: string,
  destinatarioNombre: string,
  urlVerQr?: string,
): string {
  const fecha = new Date(paquete.fechaRecepcion).toLocaleDateString("es-MX");
  const hora = new Date(paquete.fechaRecepcion).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

  const lineas = [
    `Hola, ${destinatarioNombre}.`,
    "",
    "Recibimos un paquete para tu domicilio.",
    "",
    `Paquete: ${paquete.codigoGateflow}`,
    `Domicilio: ${paquete.unidadIdentificador}`,
  ];
  if (paquete.empresaPaqueteria) lineas.push(`Paquetería: ${paquete.empresaPaqueteria}`);
  lineas.push(`Fecha de recepción: ${fecha} ${hora}`);
  if (urlVerQr) {
    lineas.push("", `Presenta este código QR en caseta para retirar tu paquete: ${urlVerQr}`);
  } else {
    lineas.push("", "Presenta el código QR adjunto en caseta para localizar y retirar tu paquete.");
  }

  return lineas.join("\n");
}

/**
 * URL segura de escaneo — codifica el pickup_token, nunca el ID interno
 * de Supabase ni datos personales. `baseUrl` viene siempre de la
 * variable de entorno propia de cada app (NEXT_PUBLIC_GUARD_APP_URL) —
 * esta función nunca la lee directamente, para no atar packages/paquetes
 * a una convención de env vars de Next.js específica de una sola app.
 *
 * La ruta es /escanear/[token], NO /guard/escanear/[token] — vive
 * deliberadamente fuera del layout de /guard/* (que redirige a /login
 * sin sesión), para poder mostrar un mensaje neutro a quien abra el
 * enlace sin estar autenticado.
 */
export function construirUrlEscaneo(pickupToken: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/escanear/${pickupToken}`;
}

/**
 * URL pública que muestra ÚNICAMENTE la imagen del QR (no el detalle del
 * paquete) — es la que se manda dentro del mensaje de WhatsApp, porque
 * wa.me nunca puede adjuntar la imagen directamente, solo texto. Mostrar
 * el QR en sí no expone nada sensible: es el mismo token que ya viaja en
 * el enlace de /escanear — quien lo abre solo ve el código para
 * presentarlo o guardarlo, nunca el nombre, domicilio o estado real del
 * paquete (eso sigue exigiendo sesión de guardia en /escanear/[token]).
 */
export function construirUrlVerQr(pickupToken: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/escanear/${pickupToken}/qr`;
}

/**
 * Construye el enlace wa.me para avisar al residente que llegó su
 * paquete. Devuelve null si no hay ningún teléfono disponible (ni
 * residente formal ni contacto informal) — quien llama debe mostrar
 * "Este residente no tiene un número de WhatsApp registrado." en ese
 * caso, no ocultar el botón silenciosamente ni bloquear el registro.
 *
 * El texto de wa.me es solo el mensaje — wa.me NO permite adjuntar una
 * imagen (el QR) automáticamente desde el navegador. Eso se resuelve
 * aparte, con Web Share API (ver PickupQRCode / "Compartir aviso y QR").
 */
export function construirEnlaceWhatsApp(
  paquete: Paquete,
  residencialNombre: string,
  destinatarioNombre: string,
  urlVerQr?: string,
): EnlaceWhatsApp | null {
  const telefonoCrudo = paquete.residenteTelefono ?? paquete.contactoTelefono;
  if (!telefonoCrudo) return null;

  const telefono = normalizarTelefonoWhatsApp(telefonoCrudo);
  if (!telefono) return null;

  const mensaje = construirMensajeNotificacion(paquete, residencialNombre, destinatarioNombre, urlVerQr);

  return {
    telefono,
    url: `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`,
  };
}
