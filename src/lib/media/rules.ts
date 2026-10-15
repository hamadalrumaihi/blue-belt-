import type { PhotoMediaAssetRow } from "@/lib/supabase/database.types";
import { isPlainObject } from "@/lib/validation";
import { isMediaCategory, MEDIA_ALT_MAX, MEDIA_CAPTION_MAX, MEDIA_REVIEW_NOTE_MAX, MEDIA_TAG_MAX, MEDIA_TAGS_MAX, readDerivatives } from "./types";

/**
 * Pure rules shared by the server actions and the owner UI, so both agree
 * and both are unit-tested without a database.
 */

/** Why an asset may not be published right now, or null when it may. */
export function publishBlocker(row: Pick<PhotoMediaAssetRow, "status" | "rights_confirmed" | "needs_review" | "guardian_ok" | "derivatives">): string | null {
  if (row.status === "published") return null;
  if (row.status !== "ready") return `Only ready assets can be published (this one is ${row.status}).`;
  if (!readDerivatives(row.derivatives).length) return "No web copies exist yet; process the asset first.";
  if (!row.rights_confirmed) return "Confirm you hold the rights to publish this photograph first.";
  if (row.needs_review && !row.guardian_ok) return "This photograph is flagged for review (possible minor, private session or third-party branding). Confirm permission first.";
  return null;
}

export type MediaMetaPatch = {
  alt?: string;
  caption?: string | null;
  category?: string;
  tags?: string[];
  focal?: { x: number; y: number };
  sort_order?: number;
  rights_confirmed?: boolean;
  guardian_ok?: boolean;
  taken_on?: string | null;
  review_note?: string | null;
};

/** Validates a patch from the owner's UI. Unknown keys are ignored; bad values are an error; rights/guardian flags only come from here. */
export function parseMetaPatch(input: unknown): { ok: true; patch: Partial<PhotoMediaAssetRow> } | { ok: false; error: string } {
  if (!isPlainObject(input)) return { ok: false, error: "Nothing to update." };
  const patch: Partial<PhotoMediaAssetRow> = {};
  if ("alt" in input) {
    if (typeof input.alt !== "string") return { ok: false, error: "Alt text must be text." };
    patch.alt = input.alt.trim().slice(0, MEDIA_ALT_MAX);
  }
  if ("caption" in input) {
    if (input.caption !== null && typeof input.caption !== "string") return { ok: false, error: "Caption must be text." };
    patch.caption = input.caption ? input.caption.trim().slice(0, MEDIA_CAPTION_MAX) || null : null;
  }
  if ("review_note" in input) {
    if (input.review_note !== null && typeof input.review_note !== "string") return { ok: false, error: "Review note must be text." };
    patch.review_note = input.review_note ? input.review_note.trim().slice(0, MEDIA_REVIEW_NOTE_MAX) || null : null;
  }
  if ("category" in input) {
    if (!isMediaCategory(input.category)) return { ok: false, error: "Unknown category." };
    patch.category = input.category;
  }
  if ("tags" in input) {
    if (!Array.isArray(input.tags) || !input.tags.every((t) => typeof t === "string")) return { ok: false, error: "Tags must be a list of words." };
    patch.tags = [...new Set((input.tags as string[]).map((t) => t.trim().toLowerCase().slice(0, MEDIA_TAG_MAX)).filter(Boolean))].slice(0, MEDIA_TAGS_MAX);
  }
  if ("focal" in input) {
    const f = input.focal;
    if (!isPlainObject(f) || typeof f.x !== "number" || typeof f.y !== "number" || !Number.isFinite(f.x) || !Number.isFinite(f.y)) return { ok: false, error: "The focal point must be two numbers." };
    patch.focal_x = Math.round(Math.min(1, Math.max(0, f.x)) * 1000) / 1000;
    patch.focal_y = Math.round(Math.min(1, Math.max(0, f.y)) * 1000) / 1000;
  }
  if ("sort_order" in input) {
    if (typeof input.sort_order !== "number" || !Number.isInteger(input.sort_order) || Math.abs(input.sort_order) > 1_000_000) return { ok: false, error: "Sort order must be a whole number." };
    patch.sort_order = input.sort_order;
  }
  if ("rights_confirmed" in input) {
    if (typeof input.rights_confirmed !== "boolean") return { ok: false, error: "Rights confirmation must be yes or no." };
    patch.rights_confirmed = input.rights_confirmed;
  }
  if ("guardian_ok" in input) {
    if (typeof input.guardian_ok !== "boolean") return { ok: false, error: "Guardian permission must be yes or no." };
    patch.guardian_ok = input.guardian_ok;
  }
  if ("taken_on" in input) {
    if (input.taken_on !== null && (typeof input.taken_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.taken_on))) return { ok: false, error: "The date must be YYYY-MM-DD." };
    patch.taken_on = input.taken_on;
  }
  if (!Object.keys(patch).length) return { ok: false, error: "Nothing to update." };
  return { ok: true, patch };
}

/** Parses the sha256 / bytes / mime / name the browser computed, the same way on both sides. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
