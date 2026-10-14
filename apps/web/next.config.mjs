import { RUTAS_PANEL, urlPanel } from "./lib/v2/rutas-panel.mjs";

/**
 * Sin GF_LANDING_INDEXAR=1 (previews, branch deploys, staging), toda
 * respuesta lleva X-Robots-Tag: noindex — también imágenes y videos.
 * Ver lib/indexacion.ts.
 */
const indexable = process.env.GF_LANDING_INDEXAR === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    if (indexable) return [];
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
  /**
   * Rutas del panel Admin. gateflow.mx fue el panel antes de ser la
   * landing: los enlaces viejos (favoritos, invitaciones, recuperación de
   * contraseña) se redirigen al panel de NEXT_PUBLIC_ADMIN_APP_URL con la
   * misma ruta y la misma consulta; el fragmento (#access_token=…) lo
   * conserva el navegador. La landing no usa ninguna de estas rutas. Lista
   * en lib/v2/rutas-panel.mjs (también la usan las pruebas).
   */
  async redirects() {
    const panel = urlPanel(process.env.NEXT_PUBLIC_ADMIN_APP_URL);
    if (!panel) return [];
    return RUTAS_PANEL.map((ruta) => ({ source: `/${ruta}/:resto*`, destination: `${panel}/${ruta}/:resto*`, permanent: true }));
  },
};

export default nextConfig;
