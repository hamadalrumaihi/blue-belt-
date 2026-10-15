import "server-only";
import { cache } from "react";
import type { PhotoCategory } from "@/lib/photos/manifest";
import { normalizeSearchTerm } from "@/lib/studio/search";
import { createClient } from "@/lib/supabase/server";
import type { PhotoMediaAssetRow } from "@/lib/supabase/database.types";
import { groupPlacements } from "./placements";
import { isMediaCategory, isMediaStatus, PRIVATE_BUCKET, readDerivatives, toMediaAsset, type MediaAsset, type MediaStatus } from "./types";

type Client = Awaited<ReturnType<typeof createClient>>;

/** How long the owner's own preview links for unpublished copies stay valid. */
export const OWNER_PREVIEW_URL_SECONDS = 60 * 60;

/**
 * Owner models with preview URLs. Published assets use public URLs; every
 * other processed asset's smallest and largest copies are signed from the
 * private bucket with the owner's own session (the storage select policy
 * limits that to the owner's folder). Signing failures leave the URL null.
 */
export async function toMediaAssetsWithPreview(supabase: Client, rows: PhotoMediaAssetRow[]): Promise<MediaAsset[]> {
  const base = supabasePublicBase();
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.status === "published" || row.status === "draft" || row.status === "failed" || row.status === "processing") continue;
    const list = readDerivatives(row.derivatives);
    if (list.length) {
      keys.add(list[0].key);
      keys.add(list[list.length - 1].key);
    }
  }
  const signed: Record<string, string> = {};
  if (keys.size) {
    const { data } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrls([...keys], OWNER_PREVIEW_URL_SECONDS);
    for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) signed[d.path] = d.signedUrl;
  }
  return rows.map((row) => toMediaAsset(row, base, signed));
}

/**
 * Owner reads through the user client, so RLS (photo_is_owner_user) is the
 * authority: a staff or client session gets empty lists, never an error.
 */
export function supabasePublicBase(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
}

export type MediaFilter = { status?: MediaStatus | "all"; category?: PhotoCategory | null; search?: string | null; limit?: number };

export async function listMediaAssets(filter: MediaFilter = {}): Promise<MediaAsset[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_media_assets").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: false });
  if (filter.status && filter.status !== "all" && isMediaStatus(filter.status)) q = q.eq("status", filter.status);
  if (filter.category && isMediaCategory(filter.category)) q = q.eq("category", filter.category);
  const term = normalizeSearchTerm(filter.search);
  if (term) {
    const like = `%${term}%`;
    q = q.or(`alt.ilike.${like},caption.ilike.${like}`);
  }
  q = q.limit(Math.min(Math.max(filter.limit ?? 500, 1), 2000));
  const { data } = await q;
  return toMediaAssetsWithPreview(supabase, data ?? []);
}

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_media_assets").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const [asset] = await toMediaAssetsWithPreview(supabase, [data]);
  return asset ?? null;
}

export type MediaCounts = Record<MediaStatus, number> & { total: number; needsReview: number; unconfirmedRights: number };

export async function countMedia(): Promise<MediaCounts> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_media_assets").select("status, needs_review, rights_confirmed, guardian_ok");
  const counts: MediaCounts = { draft: 0, processing: 0, ready: 0, published: 0, archived: 0, failed: 0, total: 0, needsReview: 0, unconfirmedRights: 0 };
  for (const r of data ?? []) {
    counts[r.status]++;
    counts.total++;
    if (r.needs_review && !r.guardian_ok && r.status !== "archived") counts.needsReview++;
    if (!r.rights_confirmed && (r.status === "ready" || r.status === "published")) counts.unconfirmedRights++;
  }
  return counts;
}

export type StorageUsage = { originalsBytes: number; derivativesBytes: number; assets: number; derivatives: number };

/** Estimated from the rows (no bucket listing): originals in the private bucket plus web copies in the public one. */
export async function storageUsage(): Promise<StorageUsage> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_media_assets").select("original_bytes, derivatives, status");
  const usage: StorageUsage = { originalsBytes: 0, derivativesBytes: 0, assets: 0, derivatives: 0 };
  for (const r of data ?? []) {
    usage.assets++;
    usage.originalsBytes += Number(r.original_bytes) || 0;
    for (const d of readDerivatives(r.derivatives)) {
      usage.derivatives++;
      usage.derivativesBytes += d.bytes;
    }
  }
  return usage;
}

/** Every placement of the signed-in owner, grouped and ordered. */
export const loadOwnerPlacements = cache(async (): Promise<Record<string, string[]>> => {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_media_placements").select("asset_id, placement, position");
  return groupPlacements(data ?? []);
});

/** Rows the owner may see, for actions that need the raw columns. */
export async function ownerRowsByIds(ids: string[]): Promise<PhotoMediaAssetRow[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("photo_media_assets").select("*").in("id", ids);
  return data ?? [];
}
