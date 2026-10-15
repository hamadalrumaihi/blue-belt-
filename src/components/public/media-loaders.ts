import "server-only";
import { cache } from "react";
import type { ServiceKey } from "@/lib/catalog/index";
import { loadPublicMedia, type PublicMediaItem } from "@/lib/media/public";
import { SERVICE_SLOTS, type ServiceSlot } from "@/lib/photos/manifest";
import { loadSiteGallery } from "@/lib/photos/site";
import { fromSitePhoto, uniqueMedia } from "./media";

/**
 * What the public pages show: the media library first
 * (`loadPublicMedia`, published items only), the committed manifest gallery
 * when the library has nothing for that placement. Cached per request.
 */
const SERVICE_SLOTS_FOR: Record<ServiceKey, readonly ServiceSlot[]> = {
  tournament_athlete: ["tournament_athlete", "tournament_photo_video"],
  team_tournament: ["club"],
  training_content: ["training_session"],
  athlete_portrait: ["private_session"],
  organizer_custom: ["custom"],
};

export const loadHeroMedia = cache(async (): Promise<PublicMediaItem | null> => {
  const items = await loadPublicMedia({ placement: "hero", limit: 1 });
  if (items[0]) return items[0];
  const gallery = await loadSiteGallery();
  return gallery.hero ? fromSitePhoto(gallery.hero) : null;
});

export const loadFeaturedMedia = cache(async (limit = 8): Promise<PublicMediaItem[]> => {
  const items = await loadPublicMedia({ placement: "featured", limit });
  if (items.length) return items.slice(0, limit);
  const gallery = await loadSiteGallery();
  return gallery.featured.slice(0, limit).map(fromSitePhoto);
});

export const loadServiceMedia = cache(async (key: ServiceKey, limit = 4): Promise<PublicMediaItem[]> => {
  const items = await loadPublicMedia({ placement: `service:${key}`, limit });
  if (items.length) return items.slice(0, limit);
  const gallery = await loadSiteGallery();
  return uniqueMedia(SERVICE_SLOTS_FOR[key].flatMap((slot) => gallery.services[slot]).map(fromSitePhoto)).slice(0, limit);
});

/** Everything published for the showcase; the manifest's whole approved selection as the fallback. */
export const loadWorkMedia = cache(async (): Promise<PublicMediaItem[]> => {
  const items = await loadPublicMedia({ placement: "work" });
  if (items.length) return uniqueMedia(items);
  const gallery = await loadSiteGallery();
  const all = [gallery.hero, ...gallery.featured, ...SERVICE_SLOTS.flatMap((s) => gallery.services[s])].filter((p): p is NonNullable<typeof p> => p !== null);
  return uniqueMedia(all.map(fromSitePhoto));
});

/** True when a signed-in studio user is looking at an unpublished selection (the pages show a quiet notice). */
export const loadGalleryPending = cache(async (): Promise<boolean> => {
  const gallery = await loadSiteGallery();
  return gallery.pending;
});
