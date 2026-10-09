"use server";

import { headers } from "next/headers";
import { urlPublicaAdmin } from "@/lib/entorno";
import { enviarCorreoConfirmacion } from "@/lib/registro/confirmacion";
import { ipDesdeHeaders } from "@/lib/registro/hash";
import type { ResultadoReenvio } from "@/lib/registro/reenvio";
import { LimitadorReenvio, ejecutarReenvio } from "@/lib/registro/reenvio-servidor";

const limitador = new LimitadorReenvio();

/**
 * "Reenviar correo de confirmación" en /login. Recibe solo el correo;
 * el destino del enlace (/confirmar-cuenta de este Admin) lo decide el
 * servidor. Usa el cliente anónimo (sin clave de servicio): solo pide a
 * Supabase un nuevo correo de verificación para un usuario existente.
 */
export async function reenviarCorreoConfirmacion(email: string): Promise<ResultadoReenvio> {
  const cabeceras = headers();
  const ip = ipDesdeHeaders((nombre) => cabeceras.get(nombre));
  return ejecutarReenvio(
    {
      urlAdmin: urlPublicaAdmin(),
      enviar: enviarCorreoConfirmacion,
      permitido: (correo) => limitador.permitir(correo, ip),
      log(evento, datos) {
        console.warn(`[GateFlow] ${evento}`, datos ? JSON.stringify(datos) : "");
      },
    },
    email,
  );
}
