import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

/**
 * Cliente de Supabase para uso en Server Components, Server Actions y Route
 * Handlers. Lee/escribe la sesión desde las cookies de la petición — nunca
 * desde un parámetro provisto por el cliente (consistente con 04-API.md §3:
 * el tenant y el usuario se derivan siempre del token de sesión).
 */
export function createClient() {
  const cookieStore = cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Se puede ignorar si se llama desde un Server Component sin
          // posibilidad de escribir cookies; el middleware se encarga
          // de refrescar la sesión en ese caso.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // Ver nota anterior.
        }
      },
    },
  });
}
