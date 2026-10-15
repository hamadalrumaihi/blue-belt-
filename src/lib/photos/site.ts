import "server-only";
import { cache } from "react";
import { loadLibraryGallery } from "@/lib/media/site-gallery";
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
 *
 * Source order: the media library (Supabase Storage, placements set under
 * /media) wins whenever it has anything placed; otherwise the committed
 * manifest plus the owner's approvals from the legacy Featured work page.
 * Either way the shape is the same, so the pages never know which one fed them.
 */
export const loadSiteGallery = cache(async (): Promise<SiteGallery> => {
  const [pub, viewer] = await Promise.all([loadPublicStudio(), resolveViewer()]);
  if (!pub) return EMPTY_GALLERY;
  const preview = Boolean(viewer && isStudioRole(viewer.role));
  const library = await loadLibraryGallery({ preview }).catch(() => null);
  if (library) return library;
  return buildSiteGallery(readFeaturedWork(pub.studio.settings), manifest, { preview });
});
