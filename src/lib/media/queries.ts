import "server-only";
import { cache } from "react";
import type { PhotoCategory } from "@/lib/photos/manifest";
import { createClient } from "@/lib/supabase/server";
import type { PhotoMediaAssetRow } from "@/lib/supabase/database.types";
import { groupPlacements } from "./placements";
import { isMediaCategory, isMediaStatus, readDerivatives, toMediaAsset, type MediaAsset, type MediaStatus } from "./types";

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
  if (filter.search?.trim()) {
    const term = filter.search.trim().replace(/[%_,]/g, " ").slice(0, 80);
    q = q.or(`alt.ilike.%${term}%,caption.ilike.%${term}%`);
  }
  q = q.limit(Math.min(Math.max(filter.limit ?? 500, 1), 2000));
  const { data } = await q;
  const base = supabasePublicBase();
  return (data ?? []).map((row) => toMediaAsset(row, base));
}

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_media_assets").select("*").eq("id", id).maybeSingle();
  return data ? toMediaAsset(data, supabasePublicBase()) : null;
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
