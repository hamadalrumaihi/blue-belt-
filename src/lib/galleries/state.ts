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
 * The studio's own Pic-Time custom domain(s). Always allowed, on top of
 * pic-time.com and any extra hosts the owner adds in Settings → Public site.
 */
export const STUDIO_GALLERY_HOSTS = ["galleries.bluebelt.media"] as const;

/** One message for every surface that rejects a gallery link (forms, actions, intake). */
export const GALLERY_URL_HELP = "Use the https link to the gallery on pic-time.com or galleries.bluebelt.media (or a gallery domain allowed in Settings).";

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** A bare hostname the owner may allow-list (no scheme, path, port or wildcard). */
export function isValidGalleryHost(raw: string): boolean {
  const h = raw.trim().toLowerCase();
  return HOSTNAME_RE.test(h) && !h.includes("..");
}

function hostMatches(host: string, allowed: string): boolean {
  const a = allowed.trim().toLowerCase();
  if (!a) return false;
  return host === a || host.endsWith(`.${a}`);
}

/**
 * A gallery link the portal may open: https, no credentials, and a host that
 * is pic-time.com (or a subdomain), one of the studio's own gallery domains
 * (or a subdomain), or an extra host allow-listed in Settings. Matching is on
 * the whole hostname, so look-alikes such as galleries.bluebelt.media.evil.example
 * never pass. Any path under an allowed host is fine.
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
  if (STUDIO_GALLERY_HOSTS.some((h) => hostMatches(host, h))) return true;
  return extraHosts.some((h) => hostMatches(host, h));
}
