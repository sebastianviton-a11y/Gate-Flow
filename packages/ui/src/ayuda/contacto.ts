/**
 * Contacto comercial y de soporte (Admin, Guard y la página de Ayuda).
 * Un solo lugar: si cambia el número, se cambia aquí. La demostración
 * personal es opcional — nunca un requisito para usar Gate Flow.
 */
export const WHATSAPP_SOPORTE_VISIBLE = "+52 55 2324 8345";
const WHATSAPP_SOPORTE_DIGITOS = "525523248345";

export const MENSAJE_AYUDA = "Hola, necesito ayuda con Gate Flow.";
export const MENSAJE_DEMO = "Hola, me gustaría agendar una demostración de Gate Flow.";

/** Enlace wa.me al número de soporte con un mensaje inicial. */
export function enlaceWhatsAppSoporte(mensaje: string = MENSAJE_AYUDA): string {
  return `https://wa.me/${WHATSAPP_SOPORTE_DIGITOS}?text=${encodeURIComponent(mensaje)}`;
}
