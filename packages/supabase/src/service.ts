import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con la clave de SERVICIO (no la anon/publishable). Solo debe
 * usarse en Server Actions muy específicas que necesitan privilegios
 * que RLS no concede a nadie — hoy, únicamente
 * `supabase.auth.admin.inviteUserByEmail()` para el flujo de
 * invitación de administradores/usuarios (no existía ningún caso de
 * uso para esto antes de este sprint).
 *
 * SUPABASE_SERVICE_ROLE_KEY es una variable de entorno SIN el prefijo
 * NEXT_PUBLIC_ — a propósito: ese prefijo hace que Next.js la incluya
 * en el bundle del navegador, y esta clave nunca debe llegar ahí. Se
 * configura solo en las variables de entorno del sitio de Netlify
 * (Site settings → Environment variables), nunca en un archivo que
 * pueda acabar en el repositorio.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY (o NEXT_PUBLIC_SUPABASE_URL) en las variables de entorno del servidor. " +
        "Se obtiene en Supabase -> Settings -> API -> service_role secret, y se agrega SOLO en Netlify (nunca con prefijo NEXT_PUBLIC_).",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
