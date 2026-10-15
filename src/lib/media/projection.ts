import type { PhotoMediaAssetRow } from "@/lib/supabase/database.types";
import type { PublicMediaItem } from "./public";
import { publicObjectUrl, readDerivatives } from "./types";

/**
 * The ONLY path from a database row to something a visitor can see. Pure,
 * explicit field by field: no spread of the row, so a new column can never
 * leak by accident. Tested in tests/media-projection.test.ts, which asserts
 * the absence of owner ids, original keys, source labels, review notes and
 * anything that is not in PublicMediaItem.
 *
 * URL rules: a `published` row gets public-bucket URLs (its copies were put
 * there by publishMedia). A `ready` row is included only for a studio
 * preview AND only through `signedUrlFor`, which the caller resolves from the
 * private bucket with a short expiry; without a signed URL for every copy the
 * row is dropped. No other status ever produces an item.
 */
export const PUBLIC_MEDIA_FIELDS = ["id", "src", "sources", "width", "height", "alt", "caption", "category", "tags", "focal", "blurDataURL", "takenOn"] as const;

export type PublicProjectionInput = Pick<PhotoMediaAssetRow, "id" | "status" | "derivatives" | "blur_data_url" | "alt" | "caption" | "category" | "tags" | "focal_x" | "focal_y" | "taken_on">;

export type ProjectionOptions = {
  /** Studio preview: include `ready` rows, resolving each derivative key to a signed private-bucket URL. */
  includeReady?: boolean;
  signedUrlFor?: (key: string) => string | null | undefined;
};

export function toPublicMediaItem(row: PublicProjectionInput, publicBase: string, { includeReady = false, signedUrlFor }: ProjectionOptions = {}): PublicMediaItem | null {
  const published = row.status === "published";
  const previewReady = includeReady && row.status === "ready" && typeof signedUrlFor === "function";
  if (!published && !previewReady) return null;
  const derivatives = readDerivatives(row.derivatives);
  if (!derivatives.length) return null;
  const urls: string[] = [];
  for (const d of derivatives) {
    const url = published ? publicObjectUrl(publicBase, d.key) : signedUrlFor?.(d.key);
    if (!url) return null;
    urls.push(url);
  }
  const largest = derivatives[derivatives.length - 1];
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
  return {
    id: row.id,
    src: urls[urls.length - 1],
    sources: derivatives.map((d, i) => ({ src: urls[i], width: d.width, height: d.height })),
    width: largest.width,
    height: largest.height,
    alt: row.alt ?? "",
    caption: row.caption ?? null,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string").slice(0, 20) : [],
    focal: { x: clamp(Number(row.focal_x)), y: clamp(Number(row.focal_y)) },
    blurDataURL: row.blur_data_url && row.blur_data_url.startsWith("data:image/") ? row.blur_data_url : undefined,
    takenOn: row.taken_on ?? null,
  };
}
