import type { PhotoCategory } from "@/lib/photos/manifest";
import type { Json, PhotoMediaAssetRow, PhotoMediaPlacementRow } from "@/lib/supabase/database.types";

/**
 * Shared vocabulary of the media library. Pure types and constants; no
 * Supabase, no sharp, no "server-only" so client components and tests can
 * import it.
 */
/** Where a photograph is used on the site. `service:<slot>` uses the manifest service slots (src/lib/photos/manifest.ts). */
export type MediaPlacement = "hero" | "featured" | "work" | `service:${string}`;

export const PRIVATE_BUCKET = "bbm-media-private";
export const PUBLIC_BUCKET = "bbm-media-public";

export const MEDIA_STATUSES = ["draft", "processing", "ready", "published", "archived", "failed"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];
export const MEDIA_SOURCES = ["web_upload", "cli_import", "manifest"] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];

export const MEDIA_CATEGORIES: readonly PhotoCategory[] = ["tournament_action", "athlete_portrait", "training_session", "team_club", "coaching_moment", "victory_podium", "behind_the_scenes", "brand_general"];
export const MEDIA_CATEGORY_LABEL: Record<PhotoCategory, string> = {
  tournament_action: "Tournament action",
  athlete_portrait: "Athlete portrait",
  training_session: "Training session",
  team_club: "Team / club",
  coaching_moment: "Coaching",
  victory_podium: "Victory / podium",
  behind_the_scenes: "Behind the scenes",
  brand_general: "Brand",
};

export function isMediaStatus(v: unknown): v is MediaStatus {
  return typeof v === "string" && (MEDIA_STATUSES as readonly string[]).includes(v);
}
export function isMediaCategory(v: unknown): v is PhotoCategory {
  return typeof v === "string" && (MEDIA_CATEGORIES as readonly string[]).includes(v);
}

/** One web copy in the public bucket. */
export type Derivative = { key: string; width: number; height: number; bytes: number };

/** The widths generated for every asset (never upscaled; see process.ts). */
export const DERIVATIVE_WIDTHS = [640, 1280, 1920, 2560] as const;

/** Limits enforced before an upload is signed and again when the bytes are inspected. */
export const MEDIA_MAX_BYTES = 40 * 1024 * 1024;
export const MEDIA_MIN_LONG_EDGE = 1200;
export const MEDIA_MAX_EDGE = 8000;
export const MEDIA_ALT_MAX = 300;
export const MEDIA_CAPTION_MAX = 500;
export const MEDIA_TAG_MAX = 40;
export const MEDIA_TAGS_MAX = 20;
export const MEDIA_REVIEW_NOTE_MAX = 500;

/** What the owner's media manager works with: the row plus resolved public URLs (none for drafts). */
export type MediaAsset = {
  id: string;
  status: MediaStatus;
  sha256: string;
  mime: string;
  originalBytes: number;
  width: number | null;
  height: number | null;
  derivatives: Derivative[];
  /** Smallest derivative for thumbnails: a public URL when published, else a short-lived signed URL from the private bucket; null until processed or when no signed URL was resolved. */
  thumbUrl: string | null;
  /** Largest derivative; same rules as thumbUrl. */
  previewUrl: string | null;
  blurDataURL: string | null;
  alt: string;
  caption: string | null;
  category: PhotoCategory;
  tags: string[];
  focal: { x: number; y: number };
  sortOrder: number;
  takenOn: string | null;
  source: MediaSource;
  sourceLabel: string | null;
  rightsConfirmed: boolean;
  guardianOk: boolean;
  needsReview: boolean;
  reviewNote: string | null;
  error: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaPlacementRow = Pick<PhotoMediaPlacementRow, "asset_id" | "placement" | "position">;

export function readDerivatives(value: Json | null | undefined): Derivative[] {
  if (!Array.isArray(value)) return [];
  const out: Derivative[] = [];
  for (const d of value) {
    if (typeof d !== "object" || d === null || Array.isArray(d)) continue;
    const { key, width, height, bytes } = d as Record<string, Json | undefined>;
    if (typeof key !== "string" || typeof width !== "number" || typeof height !== "number" || typeof bytes !== "number") continue;
    if (!/^[0-9a-f-]{36}\/[0-9a-f]{64}\/\d{3,5}\.jpg$/.test(key)) continue;
    out.push({ key, width, height, bytes });
  }
  return out.sort((a, b) => a.width - b.width);
}

/** Public object URL for a key in the public bucket. `base` is the Supabase project URL. */
export function publicObjectUrl(base: string, key: string): string {
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${PUBLIC_BUCKET}/${key}`;
}

/**
 * Owner-side model from a row. Derivatives live in the private bucket until
 * published; `signed` maps a derivative key to a short-lived signed URL for
 * the owner's own preview (queries.ts resolves them). The public projection
 * lives in projection.ts and never uses this.
 */
export function toMediaAsset(row: PhotoMediaAssetRow, publicBase: string, signed: Record<string, string> = {}): MediaAsset {
  const derivatives = readDerivatives(row.derivatives);
  const smallest = derivatives[0];
  const largest = derivatives[derivatives.length - 1];
  const processed = row.status === "ready" || row.status === "published" || row.status === "archived";
  const urlFor = (d: Derivative | undefined): string | null => {
    if (!processed || !d) return null;
    if (row.status === "published") return publicObjectUrl(publicBase, d.key);
    return signed[d.key] ?? null;
  };
  return {
    id: row.id,
    status: row.status,
    sha256: row.content_sha256,
    mime: row.mime,
    originalBytes: Number(row.original_bytes),
    width: row.original_width,
    height: row.original_height,
    derivatives,
    thumbUrl: urlFor(smallest),
    previewUrl: urlFor(largest),
    blurDataURL: row.blur_data_url,
    alt: row.alt,
    caption: row.caption,
    category: row.category,
    tags: row.tags ?? [],
    focal: { x: Number(row.focal_x), y: Number(row.focal_y) },
    sortOrder: row.sort_order,
    takenOn: row.taken_on,
    source: row.source,
    sourceLabel: row.source_label,
    rightsConfirmed: row.rights_confirmed,
    guardianOk: row.guardian_ok,
    needsReview: row.needs_review,
    reviewNote: row.review_note,
    error: row.error,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const MEDIA_STATUS_LABEL: Record<MediaStatus, string> = {
  draft: "Uploading",
  processing: "Processing",
  ready: "Ready",
  published: "Published",
  archived: "Archived",
  failed: "Failed",
};
