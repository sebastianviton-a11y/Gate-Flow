import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

/**
 * Cliente de servidor con la clave publicable y SIN sesión ni cookies.
 * Para llamadas públicas de Auth que el servidor hace en nombre de un
 * usuario que todavía no tiene sesión — hoy, reenviar el correo de
 * confirmación de /registro (auth.resend) — y para leer los documentos
 * legales publicados, solo por las funciones RPC que la migración
 * 20261015000000 abre a anon. No sirve para leer tablas: sin JWT, RLS
 * no deja ver nada.
 */
export function createAnonServerClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createSupabaseClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
