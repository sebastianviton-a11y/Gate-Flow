import type { ContenidoGuia } from "@gateflow/ui";

/**
 * Guías breves de la app de portería. Se muestran solas una vez (solo
 * durante la prueba del residencial) y siempre se pueden volver a abrir
 * con «Cómo funciona». Al cambiar un texto, subir su `version`.
 */
export type ClaveGuiaGuard = "registrar" | "notificar" | "entregar";

export const GUIAS_GUARD: Record<ClaveGuiaGuard, ContenidoGuia> = {
  registrar: {
    clave: "guard-registrar",
    version: 1,
    titulo: "Cómo registrar un paquete",
    pasos: [
      "Busca la vivienda por su dirección o por el nombre del residente.",
      "Elige la ubicación donde dejas el paquete; la paquetería y la foto son opcionales.",
      "Toca «Confirmar recepción»: el paquete queda registrado con su código.",
    ],
  },
  notificar: {
    clave: "guard-notificar",
    version: 1,
    titulo: "Cómo avisar al residente",
    pasos: [
      "«Guardar y enviar notificación» abre WhatsApp con el mensaje listo para el residente.",
      "En WhatsApp, toca enviar: el mensaje sale desde tu teléfono.",
      "Si llegaron varios paquetes para la misma vivienda, usa «Guardar y agregar otro paquete» y avisa una sola vez.",
    ],
  },
  entregar: {
    clave: "guard-entregar",
    version: 1,
    titulo: "Cómo entregar un paquete",
    pasos: [
      "Busca el paquete por dirección, nombre o código. Si el residente te muestra su QR, usa «Escanear QR» en el inicio.",
      "Escribe el nombre de quien lo recibe y pídele que firme.",
      "Toca «Confirmar entrega»: el paquete queda entregado con fecha y hora.",
    ],
  },
};
