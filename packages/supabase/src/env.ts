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
      "Faltan variables de entorno de Supabase. Completa NEXT_PUBLIC_SUPABASE_URL y " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY (en apps/admin/.env.local o apps/guard/.env.local " +
        "para desarrollo local, o en las variables de entorno del sitio de Netlify " +
        "correspondiente para producción) con los valores de tu proyecto Supabase.",
    );
  }

  return { url, anonKey };
}
