import "server-only";
import { createAnonServerClient } from "@gateflow/supabase";

/**
 * Envío del correo de confirmación de /registro, encapsulado en un
 * solo lugar. Hoy usa auth.resend({type:'signup'}): GoTrue manda su
 * plantilla "Confirm signup" por el SMTP ya configurado y el enlace
 * vuelve a `redirectTo` (/confirmar-cuenta). "Allow new users to sign
 * up" sigue OFF: el usuario ya existe (lo creó el servidor con la
 * clave secreta); aquí solo se reenvía la verificación.
 *
 * Si resend resultara bloqueado con signups OFF, el reemplazo es
 * auth.admin.generateLink({type:'signup'}) + envío propio, y solo
 * cambia esta función.
 */
export async function enviarCorreoConfirmacion(email: string, redirectTo: string): Promise<{ ok: true } | { ok: false; detalle: string }> {
  const supabase = createAnonServerClient();
  const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } });
  if (error) {
    return { ok: false, detalle: [error.status, error.code, error.message].filter(Boolean).join(" ") };
  }
  return { ok: true };
}
