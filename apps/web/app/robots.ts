import type { MetadataRoute } from "next";
import { indexable } from "@/lib/indexacion";

/** Previews y staging: nada se indexa (lib/indexacion.ts). */
export default function robots(): MetadataRoute.Robots {
  if (!indexable()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://gateflow.mx/sitemap.xml",
  };
}
