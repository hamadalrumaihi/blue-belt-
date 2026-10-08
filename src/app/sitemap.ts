import type { MetadataRoute } from "next";
import { buildSitemap } from "@/lib/seo";
import { siteUrl } from "@/lib/studio/queries";

/** Public pages only; the portal, studio, signing and payment routes are excluded. */
export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap(siteUrl());
}
