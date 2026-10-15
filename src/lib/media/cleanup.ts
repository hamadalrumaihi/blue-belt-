import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { PRIVATE_BUCKET } from "./types";

type Client = SupabaseClient<Database>;

export type CleanupResult = { scanned: number; removedObjects: number; deletedRows: number; errors: string[] };

/**
 * Orphan cleanup: a browser that created an upload and never finalised it
 * leaves a `draft` row and, possibly, an original in the private bucket.
 * Deletes both for drafts older than `olderThanHours`. Only rows that never
 * left `draft` are touched: processing, ready, published, archived and
 * failed rows all represent a confirmed original and are kept.
 * Runs with the service client (scheduled, no user session).
 */
export async function cleanupAbandonedUploads(service: Client, olderThanHours = 24, now = new Date()): Promise<CleanupResult> {
  const hours = Number.isFinite(olderThanHours) && olderThanHours > 0 ? olderThanHours : 24;
  const cutoff = new Date(now.getTime() - hours * 3600 * 1000).toISOString();
  const result: CleanupResult = { scanned: 0, removedObjects: 0, deletedRows: 0, errors: [] };
  const { data: drafts, error } = await service.from("photo_media_assets").select("id, original_key").eq("status", "draft").lt("created_at", cutoff).limit(500);
  if (error) {
    result.errors.push(error.message);
    return result;
  }
  result.scanned = drafts?.length ?? 0;
  if (!drafts?.length) return result;
  const keys = drafts.map((d) => d.original_key);
  const { data: removed, error: removeError } = await service.storage.from(PRIVATE_BUCKET).remove(keys);
  // A missing object is not an error: the browser may never have uploaded it.
  if (removeError) result.errors.push(`storage: ${removeError.message}`);
  result.removedObjects = removed?.length ?? 0;
  const { error: deleteError, count } = await service.from("photo_media_assets").delete({ count: "exact" }).in("id", drafts.map((d) => d.id)).eq("status", "draft");
  if (deleteError) result.errors.push(`rows: ${deleteError.message}`);
  result.deletedRows = count ?? 0;
  return result;
}
