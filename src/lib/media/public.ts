import "server-only";

/**
 * CONTRACT between the media library (workstream C) and the public pages
 * (workstream B). Public reads return only published, safe fields: no
 * storage paths of drafts, no owner ids, no original filenames, no EXIF.
 * The implementation lives in the media workstream; until it lands this
 * returns the manifest-based gallery so nothing on the site breaks.
 */
export type MediaPlacement = "hero" | "featured" | "work" | `service:${string}`;

export type PublicMediaItem = {
  id: string;
  /** Public, immutable URL of the largest web derivative (never the original). */
  src: string;
  /** srcset candidates, ascending width. */
  sources: Array<{ src: string; width: number; height: number }>;
  width: number;
  height: number;
  alt: string;
  caption: string | null;
  category: string;
  tags: string[];
  focal: { x: number; y: number };
  blurDataURL?: string;
  takenOn: string | null;
};

export type PublicMediaQuery = { placement?: MediaPlacement; category?: string; limit?: number };

export async function loadPublicMedia(_query: PublicMediaQuery = {}): Promise<PublicMediaItem[]> {
  return [];
}
