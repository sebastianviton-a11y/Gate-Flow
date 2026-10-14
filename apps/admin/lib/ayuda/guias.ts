import type { ContenidoGuia } from "@gateflow/ui";

/**
 * Textos de ayuda del panel Admin: guías de primera visita por sección y
 * procesos de la página /ayuda. Un solo lugar para los textos; cada guía
 * se muestra sola una vez (y solo durante la prueba) y siempre se puede
 * volver a abrir con «Cómo funciona». Al cambiar el texto de una guía,
 * subir su `version` para que se vuelva a mostrar una vez.
 */
export type ClaveGuiaAdmin = "unidades" | "residentes" | "usuarios" | "bodega" | "paquetes";

export const GUIAS_ADMIN: Record<ClaveGuiaAdmin, ContenidoGuia> = {
  unidades: {
    clave: "unidades",
    version: 1,
    titulo: "Cómo funcionan las unidades",
    pasos: [
      "Cada unidad es una casa o departamento del residencial; su dirección no se puede repetir.",
      "Agrégalas una por una o importa la plantilla de Excel: antes de confirmar verás cuántas se encontraron, duplicadas y con errores.",
      "El contacto de cada unidad (nombre y WhatsApp) es a quien se avisa cuando llega un paquete.",
    ],
  },
  residentes: {
    clave: "residentes",
    version: 1,
    titulo: "Cómo agregar residentes",
    pasos: [
      "Comparte el enlace de alta: cada residente llena sus datos desde su celular.",
      "Revisa las solicitudes aquí mismo y apruébalas o recházalas: ningún residente se agrega sin tu aprobación.",
      "También puedes cargarlos con la plantilla de Excel en Unidades.",
    ],
  },
  usuarios: {
    clave: "usuarios",
    version: 1,
    titulo: "Cómo invitar a tu equipo",
    pasos: [
      "Invita a cada guardia con su correo: recibe un mensaje para crear su propia contraseña.",
      "El guardia trabaja desde la app de portería (Guard), en celular, tablet o computadora.",
      "Cada usuario ve solo los residenciales en los que tiene acceso.",
    ],
  },
  bodega: {
    clave: "bodega",
    version: 1,
    titulo: "Cómo organizar la bodega",
    pasos: [
      "Crea las ubicaciones donde se guardan los paquetes (por ejemplo, un área y sus estantes).",
      "Al registrar un paquete, el guardia elige en qué ubicación lo deja.",
      "Si un paquete se mueve, se puede cambiar su ubicación desde su detalle.",
    ],
  },
  paquetes: {
    clave: "paquetes",
    version: 1,
    titulo: "Cómo funciona un paquete",
    pasos: [
      "Recibido: se registra la vivienda, la paquetería, la ubicación y, si quieres, una foto.",
      "Notificado: Gate Flow prepara el mensaje de WhatsApp y quien registra lo envía desde su teléfono.",
      "Entregado: se busca o se escanea el QR del residente, se indica quién recibe y se firma.",
    ],
  },
};

/** Procesos que explica la página /ayuda (y desde dónde se hacen). */
export const PROCESOS_AYUDA: ReadonlyArray<{ titulo: string; texto: string; href?: string; enlace?: string }> = [
  {
    titulo: "Configurar el residencial",
    texto: "El asistente te guía por residentes, guardias y bodega. Puedes salir cuando quieras y retomarlo desde «Primeros pasos» en el Dashboard: lo que ya configuraste se conserva.",
    href: "/onboarding",
    enlace: "Abrir el asistente",
  },
  {
    titulo: "Cargar unidades y residentes",
    texto: "Agrega las viviendas una por una o con la plantilla de Excel. Para los residentes, comparte el enlace de alta y aprueba las solicitudes.",
    href: "/unidades",
    enlace: "Ir a Unidades",
  },
  {
    titulo: "Invitar guardias",
    texto: "Cada guardia recibe un correo para crear su contraseña y entra a la app de portería con su propio usuario.",
    href: "/usuarios",
    enlace: "Ir a Usuarios",
  },
  {
    titulo: "Organizar la bodega",
    texto: "Crea las ubicaciones donde se guardan los paquetes; el guardia elige una al registrar cada paquete.",
    href: "/configuracion/bodega",
    enlace: "Ir a Bodega",
  },
  {
    titulo: "Registrar y notificar un paquete",
    texto: "Se registra la vivienda, la paquetería, la ubicación y, si quieres, una foto. Después se abre WhatsApp con el mensaje listo y quien registra lo envía.",
    href: "/paquetes/nuevo",
    enlace: "Registrar paquete",
  },
  {
    titulo: "Entregar un paquete",
    texto: "En la app de portería se busca el paquete o se escanea el QR del residente, se indica quién lo recibe y se firma.",
  },
  {
    titulo: "Reportar una incidencia",
    texto: "Si un paquete llega dañado o hay un problema, se reporta con fotos y se le da seguimiento en Incidencias.",
    href: "/incidencias",
    enlace: "Ir a Incidencias",
  },
];
