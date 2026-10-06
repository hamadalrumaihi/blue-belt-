import type { MetadataRoute } from "next";
import { buildRobots } from "@/lib/seo";
import { siteUrl } from "@/lib/studio/queries";

export default function robots(): MetadataRoute.Robots {
  return buildRobots(siteUrl());
}
