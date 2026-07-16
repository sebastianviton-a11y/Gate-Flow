"use client";

import { createBrowserClient } from "@supabase/ssr";
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
