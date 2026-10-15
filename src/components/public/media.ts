import type { PublicMediaItem } from "@/lib/media/public";
import type { SitePhoto } from "@/lib/photos/manifest";

/**
 * The public pages render one shape, `PublicMediaItem` (the media library's
 * contract). The committed manifest gallery is the fallback source until the
 * library has published items, so its `SitePhoto` is adapted here. Pure.
 */
export function fromSitePhoto(photo: SitePhoto): PublicMediaItem {
  return {
    id: photo.id,
    src: photo.src,
    sources: [],
    width: photo.width,
    height: photo.height,
    alt: photo.alt,
    caption: null,
    category: photo.category,
    tags: [],
    focal: photo.focal,
    blurDataURL: photo.blurDataURL,
    takenOn: photo.takenAt,
  };
}

/** `object-position` for a cover crop that keeps the subject in frame. */
export function focalPositionOf(item: Pick<PublicMediaItem, "focal">): string {
  const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`;
  return `${pct(item.focal.x)} ${pct(item.focal.y)}`;
}

/** Drops duplicates by id, keeping first occurrence. */
export function uniqueMedia(items: readonly PublicMediaItem[]): PublicMediaItem[] {
  const seen = new Set<string>();
  const out: PublicMediaItem[] = [];
  for (const m of items) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** Distinct categories in display order of first appearance. */
export function mediaCategories(items: readonly PublicMediaItem[]): string[] {
  return [...new Set(items.map((m) => m.category).filter(Boolean))];
}

/** Landscape frames get the wider tile in a grid. */
export function isLandscape(item: Pick<PublicMediaItem, "width" | "height">): boolean {
  return item.width > item.height * 1.15;
}
