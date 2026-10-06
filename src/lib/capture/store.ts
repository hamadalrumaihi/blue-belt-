import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, PhotoCaptureRow } from "@/lib/supabase/database.types";
import type { CaptureEnvelope } from "./envelope";

type Client = SupabaseClient<Database>;

/**
 * Capture ledger access. Every read and write is scoped by owner_id
 * explicitly (RLS also enforces it for session clients; the service client
 * used by machine intake relies on this scoping, so it is never optional).
 */

/** A capture row older than this and still "received" is treated as abandoned, not in flight. */
export const IN_FLIGHT_GRACE_MS = 2 * 60 * 1000;

export type RegisterOutcome =
  | { kind: "new"; row: PhotoCaptureRow }
  | { kind: "replay"; row: PhotoCaptureRow }
  | { kind: "in_flight"; row: PhotoCaptureRow };

/**
 * Inserts the capture, or returns the existing row when the same capture id
 * was already received for this owner (replay). An abandoned "received" row
 * (crash mid-apply) is taken over instead of blocking forever.
 */
export async function registerCapture(supabase: Client, ownerId: string, env: CaptureEnvelope, sourceKey: string, now: Date): Promise<RegisterOutcome> {
  const insert: Database["public"]["Tables"]["photo_captures"]["Insert"] = {
    owner_id: ownerId,
    capture_id: env.captureId,
    source_key: sourceKey,
    source_url: env.sourceUrl,
    final_url: env.finalUrl,
    transport: env.transport,
    captured_at: env.capturedAt,
    received_at: env.receivedAt,
    content_hash: env.contentHash,
    bytes: env.bytes,
    completeness: env.completeness,
    status: "received",
  };
  const { data, error } = await supabase.from("photo_captures").insert(insert).select("*").single();
  if (!error && data) return { kind: "new", row: data };
  if (error && error.code !== "23505") throw new Error(`photo_captures insert: ${error.message}`);

  const { data: existing, error: readError } = await supabase.from("photo_captures").select("*").eq("owner_id", ownerId).eq("capture_id", env.captureId).maybeSingle();
  if (readError || !existing) throw new Error(`photo_captures lookup: ${readError?.message ?? "missing after conflict"}`);
  if (existing.status !== "received") return { kind: "replay", row: existing };
  const age = now.getTime() - new Date(existing.received_at).getTime();
  if (age < IN_FLIGHT_GRACE_MS) return { kind: "in_flight", row: existing };
  // Abandoned: take it over (re-stamp received_at so a second taker sees it in flight).
  const { data: taken } = await supabase.from("photo_captures").update({ received_at: now.toISOString(), status: "received" }).eq("id", existing.id).eq("owner_id", ownerId).select("*").single();
  return { kind: "new", row: taken ?? existing };
}

/** captured_at of the newest APPLIED capture of this owner's source, or null. */
export async function latestAppliedCaptureAt(supabase: Client, ownerId: string, sourceKey: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("photo_captures")
    .select("captured_at")
    .eq("owner_id", ownerId)
    .eq("source_key", sourceKey)
    .eq("status", "applied")
    .order("captured_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`photo_captures latest: ${error.message}`);
  return data?.[0]?.captured_at ?? null;
}

export async function markCaptureApplied(supabase: Client, ownerId: string, id: string, update: { appliedAt: string; athleteCount: number; outcome: Json; diagnostics: Json }): Promise<void> {
  const { error } = await supabase
    .from("photo_captures")
    .update({ status: "applied", applied_at: update.appliedAt, athlete_count: update.athleteCount, outcome: update.outcome, diagnostics: update.diagnostics, reject_code: null })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw new Error(`photo_captures applied: ${error.message}`);
}

export async function markCaptureRejected(supabase: Client, ownerId: string, id: string, code: string, diagnostics: Json = {}): Promise<void> {
  const { error } = await supabase.from("photo_captures").update({ status: "rejected", reject_code: code, diagnostics }).eq("id", id).eq("owner_id", ownerId);
  if (error) throw new Error(`photo_captures rejected: ${error.message}`);
}

/**
 * Gives up this request's in-flight claim on a capture that wrote nothing
 * (every athlete lost the version race or failed transiently). The row stays
 * "received" but its received_at is pushed past the in-flight grace window, so
 * the uploader's retry takes it over at once instead of being told it is still
 * in flight (or, worse, that it was refused for good).
 */
export async function releaseCapture(supabase: Client, ownerId: string, id: string): Promise<void> {
  const { error } = await supabase.from("photo_captures").update({ received_at: new Date(0).toISOString() }).eq("id", id).eq("owner_id", ownerId).eq("status", "received");
  if (error) throw new Error(`photo_captures release: ${error.message}`);
}
