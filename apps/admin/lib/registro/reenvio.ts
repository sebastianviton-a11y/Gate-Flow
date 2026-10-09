/**
 * Reenvío del correo de confirmación desde /login: lo que comparten el
 * navegador y el servidor (sin Next, sin Supabase, sin módulos de Node).
 * La acción del servidor está en app/login/actions.ts y su lógica en
 * reenvio-servidor.ts.
 */

export const MENSAJES_REENVIO = {
  enviado: "Te enviamos un nuevo correo de confirmación.",
  espera: "Espera un momento antes de volver a intentarlo.",
  error: "No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.",
} as const;

export type EstadoReenvio = keyof typeof MENSAJES_REENVIO;

export interface ResultadoReenvio {
  estado: EstadoReenvio;
  mensaje: string;
}

export function resultadoReenvio(estado: EstadoReenvio): ResultadoReenvio {
  return { estado, mensaje: MENSAJES_REENVIO[estado] };
}

/**
 * Pausa entre dos reenvíos al mismo correo. Es la misma que aplica
 * Supabase por usuario (60 s por defecto): pedir antes solo daría
 * "espera".
 */
export const ESPERA_REENVIO_MS = 60_000;

/**
 * El botón "Reenviar correo de confirmación" solo aparece cuando el
 * login ya dijo que la cuenta está pendiente de confirmación (Supabase
 * solo responde email_not_confirmed con la contraseña correcta). Con
 * credenciales incorrectas, cuenta confirmada o cualquier otro error,
 * no se ofrece.
 */
export function ofreceReenvioConfirmacion(codigoErrorLogin: string | undefined | null): boolean {
  return codigoErrorLogin === "email_not_confirmed";
}

/**
 * Control del botón en el navegador: una sola solicitud a la vez (un
 * doble clic no manda dos) y, tras un envío o un "espera", nada hasta
 * que pase ESPERA_REENVIO_MS. Un error deja reintentar.
 * `intentar` devuelve null si no llamó al servidor.
 */
export function crearControlReenvio(
  enviar: (email: string) => Promise<ResultadoReenvio>,
  ahora: () => number = Date.now,
  esperaMs: number = ESPERA_REENVIO_MS,
) {
  let enCurso = false;
  let bloqueadoHasta = 0;
  return {
    puedeIntentar(): boolean {
      return !enCurso && ahora() >= bloqueadoHasta;
    },
    async intentar(email: string): Promise<ResultadoReenvio | null> {
      if (enCurso || ahora() < bloqueadoHasta) return null;
      enCurso = true;
      try {
        const r = await enviar(email);
        if (r.estado !== "error") bloqueadoHasta = ahora() + esperaMs;
        return r;
      } catch {
        return resultadoReenvio("error");
      } finally {
        enCurso = false;
      }
    },
  };
}
