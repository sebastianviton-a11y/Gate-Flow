import type { MetadataRoute } from "next";
import { indexable } from "@/lib/indexacion";

/** Sin sitemap mientras la landing no sea indexable (lib/indexacion.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!indexable()) return [];
  return [{ url: "https://gateflow.mx", lastModified: new Date() }];
}
