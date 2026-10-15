import "server-only";
import { EMPTY_GALLERY, type SiteGallery } from "@/lib/photos/featured";
import { SERVICE_SLOTS, type PhotoCategory, type SitePhoto } from "@/lib/photos/manifest";
import { isMediaCategory } from "./types";
import { loadPlacedMedia, type PublicMediaItem } from "./public";

/**
 * Bridges the media library to the SiteGallery shape the home and services
 * pages already consume, so either source (library placements or the
 * committed manifest) renders through the same components. Null when the
 * library has nothing placed, which makes src/lib/photos/site.ts fall back
 * to the manifest selection.
 */
export function publicItemToSitePhoto(item: PublicMediaItem): SitePhoto {
  // The library has no "clean side" classification; the focal point decides where the headline can sit.
  const textSpace: SitePhoto["textSpace"] = item.focal.x <= 0.4 ? "right" : item.focal.x >= 0.6 ? "left" : "none";
  const category: PhotoCategory = isMediaCategory(item.category) ? item.category : "brand_general";
  return {
    id: item.id,
    src: item.src,
    width: item.width,
    height: item.height,
    alt: item.alt,
    category,
    focal: item.focal,
    textSpace,
    blurDataURL: item.blurDataURL,
    needsReview: false,
    score: 0,
    takenAt: item.takenOn,
    folder: null,
  };
}

export async function loadLibraryGallery({ preview = false }: { preview?: boolean } = {}): Promise<SiteGallery | null> {
  const placed = await loadPlacedMedia({ preview });
  if (!placed) return null;
  const { byPlacement, pending, published } = placed;
  const hero = byPlacement.hero?.[0] ? publicItemToSitePhoto(byPlacement.hero[0]) : null;
  const featured = (byPlacement.featured ?? []).map(publicItemToSitePhoto).filter((p) => p.id !== hero?.id);
  const services = { ...EMPTY_GALLERY.services };
  let any = Boolean(hero || featured.length);
  for (const slot of SERVICE_SLOTS) {
    services[slot] = (byPlacement[`service:${slot}`] ?? []).map(publicItemToSitePhoto);
    if (services[slot].length) any = true;
  }
  if (!any && !pending) return null;
  return { hero, featured, services, published, pending };
}
