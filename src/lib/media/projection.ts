import type { PhotoMediaAssetRow } from "@/lib/supabase/database.types";
import type { PublicMediaItem } from "./public";
import { publicObjectUrl, readDerivatives } from "./types";

/**
 * The ONLY path from a database row to something a visitor can see. Pure,
 * explicit field by field: no spread of the row, so a new column can never
 * leak by accident. Tested in tests/media-projection.test.ts, which asserts
 * the absence of owner ids, original keys, source labels, review notes and
 * anything that is not in PublicMediaItem.
 */
export const PUBLIC_MEDIA_FIELDS = ["id", "src", "sources", "width", "height", "alt", "caption", "category", "tags", "focal", "blurDataURL", "takenOn"] as const;

export type PublicProjectionInput = Pick<PhotoMediaAssetRow, "id" | "status" | "derivatives" | "blur_data_url" | "alt" | "caption" | "category" | "tags" | "focal_x" | "focal_y" | "taken_on">;

/**
 * Returns null unless the asset is published (or `includeReady` for a studio
 * preview) and has at least one derivative in the public bucket. Nothing
 * from the private bucket can appear: derivative keys are validated against
 * the public key shape and turned into public-bucket URLs only.
 */
export function toPublicMediaItem(row: PublicProjectionInput, publicBase: string, { includeReady = false }: { includeReady?: boolean } = {}): PublicMediaItem | null {
  if (row.status !== "published" && !(includeReady && row.status === "ready")) return null;
  const derivatives = readDerivatives(row.derivatives);
  if (!derivatives.length) return null;
  const largest = derivatives[derivatives.length - 1];
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
  return {
    id: row.id,
    src: publicObjectUrl(publicBase, largest.key),
    sources: derivatives.map((d) => ({ src: publicObjectUrl(publicBase, d.key), width: d.width, height: d.height })),
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
