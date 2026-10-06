/**
 * Detección del entorno de staging sin variables nuevas: el sitio de
 * staging apunta al proyecto Supabase "Gate Flow - Staging"
 * (sfuckzzqejerrifuypby). Producción (xlozkpygubyiuxopmdxw) nunca
 * cumple esta condición. Solo se usa para avisos visibles, nunca para
 * decisiones de seguridad.
 */

export const REF_SUPABASE_STAGING = "sfuckzzqejerrifuypby";

export function esEntornoStaging(env: Record<string, string | undefined> = process.env): boolean {
  return (env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(REF_SUPABASE_STAGING);
}
