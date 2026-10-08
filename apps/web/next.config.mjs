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
};

export default nextConfig;
