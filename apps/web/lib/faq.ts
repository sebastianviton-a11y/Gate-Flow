// Contenido del FAQ tal como fue aprobado en el canvas "Gate Flow — Landing"
// de Claude Design (Landing.dc.html / Mobile-2.dc.html), confirmado por el
// usuario. No reinterpretar ni parafrasear estas respuestas.
export type FaqItem = {
  question: string;
  answer: string | null; // null = todavía sin confirmar por el usuario
};

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "¿Necesito instalar algo?",
    answer:
      "No. Gate Flow funciona desde el navegador, por lo que puedes acceder desde computadora, tablet o celular sin instalar programas adicionales.",
  },
  {
    question: "¿Los residentes necesitan descargar una app?",
    answer:
      "No. Los residentes no necesitan descargar una app para recibir y utilizar la información relacionada con sus paquetes.",
  },
  {
    question: "¿Qué necesita el guardia para usar Gate Flow?",
    answer:
      "Un celular o dispositivo con acceso a internet y cámara. Desde Gate Flow puede registrar paquetes, tomar fotografías, buscar entregas y escanear códigos QR.",
  },
  {
    question: "¿Puedo importar mis residentes desde Excel?",
    answer: "Sí. Desde el módulo Residentes puedes importar un archivo de Excel.",
  },
  {
    question: "¿Qué pasa después de los 7 días?",
    answer:
      "La prueba dura 7 días y no requiere tarjeta. Al finalizar, deberás activar una suscripción para continuar utilizando Gate Flow. Si no se activa una suscripción, la operación del residencial se suspende, pero la información no se elimina automáticamente. Al activar la suscripción, el acceso puede restablecerse.",
  },
  {
    question: "¿Puedo cancelar cuando quiera?",
    answer:
      "Sí. Gate Flow funcionará con suscripción mensual y podrás cancelar para evitar futuras renovaciones.",
  },
  {
    question: "¿Qué pasa con mis datos si termina mi suscripción?",
    answer: "La información no se elimina automáticamente cuando termina la suscripción.",
  },
  {
    question: "¿Gate Flow funciona en México y Argentina?",
    answer: "Sí. Gate Flow está pensado para operar inicialmente con residenciales en México y Argentina.",
  },
];
