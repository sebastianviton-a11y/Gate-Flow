/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@gateflow/types", "@gateflow/ui", "@gateflow/auth", "@gateflow/supabase", "@gateflow/paquetes"],
};

export default nextConfig;
