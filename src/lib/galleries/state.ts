import type { GalleryStatus } from "@/lib/supabase/database.types";

/**
 * Gallery lifecycle (photo_galleries.status). Pic-Time hosts the images; this
 * records where the gallery is and whether the client has been told.
 *
 *   pending → created → ready → delivered
 *
 * `ready` = the Pic-Time URL is attached and the owner marked it ready;
 * `delivered` = the client was notified (or the owner marked it delivered by hand).
 */
export const GALLERY_STATUSES = ["pending", "created", "ready", "delivered"] as const satisfies readonly GalleryStatus[];

export const GALLERY_TRANSITIONS: Record<GalleryStatus, readonly GalleryStatus[]> = {
  pending: ["created", "ready"],
  created: ["ready", "pending"],
  ready: ["delivered", "created"],
  delivered: ["ready"],
};

export const GALLERY_STATUS_LABEL: Record<GalleryStatus, string> = {
  pending: "Not created yet",
  created: "Created in Pic-Time",
  ready: "Ready",
  delivered: "Delivered",
};

export function isGalleryStatus(v: unknown): v is GalleryStatus {
  return typeof v === "string" && (GALLERY_STATUSES as readonly string[]).includes(v);
}

export function canTransitionGallery(from: GalleryStatus, to: GalleryStatus): boolean {
  return GALLERY_TRANSITIONS[from].includes(to);
}

const PICTIME_HOST_RE = /(^|\.)pic-time\.com$/i;

/**
 * A gallery link the portal may open: https, and either a pic-time.com host or
 * the studio's own custom gallery domain (allow-listed by the owner in settings).
 */
export function isAllowedGalleryUrl(raw: string, extraHosts: readonly string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (PICTIME_HOST_RE.test(host)) return true;
  return extraHosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
}
