/**
 * Indexación de la landing. Por defecto (previews, branch deploys,
 * staging) NO se indexa: robots.txt bloquea todo, cada página lleva
 * <meta name="robots" content="noindex, nofollow"> y X-Robots-Tag, y no
 * hay sitemap. Solo el build del sitio público, al publicarse, la
 * habilita con GF_LANDING_INDEXAR=1 (decisión de publicación).
 */
export const VARIABLE_INDEXAR = "GF_LANDING_INDEXAR";

export function indexable(valor: string | undefined = process.env.GF_LANDING_INDEXAR): boolean {
  return valor === "1";
}
