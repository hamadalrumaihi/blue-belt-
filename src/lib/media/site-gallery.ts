import "server-only";
import { EMPTY_GALLERY, type SiteGallery } from "@/lib/photos/featured";
import { SERVICE_SLOTS } from "@/lib/photos/manifest";
import { loadPlacedMedia } from "./public";
import { publicItemToSitePhoto } from "./site-gallery-pure";

export { publicItemToSitePhoto };

/**
 * Bridges the media library to the SiteGallery shape the home and services
 * pages already consume, so either source (library placements or the
 * committed manifest) renders through the same components. Null when the
 * library has nothing placed, which makes src/lib/photos/site.ts fall back
 * to the manifest selection.
 */
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
  // Nothing visible to this viewer: fall back to the manifest selection rather than an empty gallery
  // (a visitor must never see an empty library just because something is pending for the studio).
  if (!any) return null;
  return { hero, featured, services, published, pending };
}
