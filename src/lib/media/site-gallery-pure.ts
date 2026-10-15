import type { PhotoCategory, SitePhoto } from "@/lib/photos/manifest";
import type { PublicMediaItem } from "./public";
import { isMediaCategory } from "./types";

/** Pure half of site-gallery.ts: a public item in the SitePhoto shape the existing components render. */
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
