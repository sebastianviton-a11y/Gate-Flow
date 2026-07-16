/**
 * Antes, si faltaba `.env.local`, `process.env.NEXT_PUBLIC_SUPABASE_URL!`
 * pasaba `undefined` directo al SDK de Supabase, que falla con un error
 * genérico difícil de diagnosticar para alguien ejecutando el proyecto por
 * primera vez. Esto falla rápido y explica exactamente qué falta y cómo
 * arreglarlo.
 */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Faltan variables de entorno de Supabase. Copia apps/web/.env.example a " +
        "apps/web/.env.local y completa NEXT_PUBLIC_SUPABASE_URL y " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY con los valores de tu proyecto Supabase.",
    );
  }

  return { url, anonKey };
}
