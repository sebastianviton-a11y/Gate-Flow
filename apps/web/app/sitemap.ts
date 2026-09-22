import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://gateflow.mx", lastModified: new Date() }];
}
