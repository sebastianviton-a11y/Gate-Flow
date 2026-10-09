"use client";

import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

/**
 * Cliente de Supabase para uso en Client Components.
 */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}

// Alias con el nombre que ya usan los 10 Client Components del monorepo
// (apps/admin y apps/guard) — así la corrección del barrel (packages/
// supabase/src/index.ts seguía arrastrando next/headers vía server.ts)
// solo exige cambiar la RUTA del import, no el nombre importado en cada
// archivo. Ver packages/supabase/package.json para el subpath "./client".
export { createClient as createBrowserSupabaseClient };

/**
 * Cliente SOLO para pedir enlaces por correo que la persona puede abrir
 * en otro dispositivo (recuperación de contraseña). El cliente de
 * @supabase/ssr usa PKCE: el enlace solo sirve en el navegador que lo
 * pidió (ahí queda el verificador), así que pedirlo en la compu y abrirlo
 * en el teléfono fallaba. Con el flujo implícito el enlace trae la sesión
 * en el fragmento (#), igual que la invitación y la confirmación, y
 * /restablecer-password la toma con setSession(). Sin sesión propia.
 */
export function createEmailLinkClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createSupabaseClient(url, anonKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
