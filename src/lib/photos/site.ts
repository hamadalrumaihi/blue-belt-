import "server-only";
import { cache } from "react";
import { isStudioRole, resolveViewer } from "@/lib/roles";
import { loadPublicStudio } from "@/lib/studio/queries";
import { buildSiteGallery, EMPTY_GALLERY, readFeaturedWork, type SiteGallery } from "./featured";
import manifestJson from "../../../public/photos/manifest.json";
import type { Manifest } from "./manifest";

const manifest = manifestJson as unknown as Manifest;

/**
 * The photographs a public page may show. Visitors see the published
 * selection; a signed-in studio user sees the pending selection as a
 * preview. Cached per request so the layout and the page share one read.
 */
export const loadSiteGallery = cache(async (): Promise<SiteGallery> => {
  const [pub, viewer] = await Promise.all([loadPublicStudio(), resolveViewer()]);
  if (!pub) return EMPTY_GALLERY;
  const preview = Boolean(viewer && isStudioRole(viewer.role));
  return buildSiteGallery(readFeaturedWork(pub.studio.settings), manifest, { preview });
});
