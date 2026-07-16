/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@gateflow/types", "@gateflow/ui", "@gateflow/auth", "@gateflow/supabase", "@gateflow/paquetes"],
  // Cabeceras para que el service worker (public/sw.js) pueda controlar
  // toda la app desde la raíz — necesario para el scope de un PWA instalable.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Service-Worker-Allowed", value: "/" }],
      },
    ];
  },
};

export default nextConfig;
