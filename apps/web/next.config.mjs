// CONTEXT lo define Netlify durante el build ("production",
// "branch-deploy", "deploy-preview"). Solo en branch deploys y deploy
// previews, "/" lleva a la V2 (/v2-preview) para revisarla abriendo la
// URL directamente. En producción (CONTEXT=production) y en local no
// aplica: "/" sigue sirviendo la V1.
const esPreviewNetlify = process.env.CONTEXT === "branch-deploy" || process.env.CONTEXT === "deploy-preview";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return esPreviewNetlify ? [{ source: "/", destination: "/v2-preview", permanent: false }] : [];
  },
};

export default nextConfig;
