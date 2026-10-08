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

/**
 * ¿Este Admin corre en un entorno de PRUEBAS? A diferencia de
 * esEntornoStaging, esta sí decide (claves de prueba de Turnstile,
 * precios sin aprobación comercial) y falla cerrado: solo es true si el
 * host de NEXT_PUBLIC_ADMIN_APP_URL se reconoce como de pruebas
 * (localhost, staging, Deploy Previews y branch deploys de Netlify).
 * Sin URL, con una URL inválida o con cualquier otro host (gateflow.mx)
 * es entorno de clientes.
 */
export function esEntornoDePruebas(urlAdmin: string | undefined): boolean {
  let host: string;
  try {
    host = new URL(urlAdmin ?? "").hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  return host === "localhost" || host === "127.0.0.1" || /staging|deploy-preview/.test(host) || host.includes("--");
}
