"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { removeDerivatives, derivativesJson, processAsset } from "@/lib/media/process";
import { parsePlacement, placementRows } from "@/lib/media/placements";
import { supabasePublicBase } from "@/lib/media/queries";
import { parseMetaPatch, publishBlocker } from "@/lib/media/rules";
import { PRIVATE_BUCKET, readDerivatives, toMediaAsset, type MediaAsset, type MediaPlacement } from "@/lib/media/types";
import { originalKey, validateUploadRequest } from "@/lib/media/validate";
import { requireOwner } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { Json, PhotoMediaAssetRow } from "@/lib/supabase/database.types";
import { isUuid } from "@/lib/validation";

/**
 * Owner-only media actions. Every action starts with requireOwner(): staff
 * and client accounts are refused before any query, and RLS
 * (photo_is_owner_user) refuses them again in the database. Rows are
 * read and written with the user client; only derivative processing uses
 * the service client, because the public bucket accepts writes from the
 * service role alone. Nothing here notifies anyone.
 */
type Client = Awaited<ReturnType<typeof createClient>>;
type Owner = { ok: true; supabase: Client; userId: string } | { ok: false; error: string };
export type MediaResult = { ok: true } | { ok: false; error: string };
export type MediaBatchResult = { ok: true; done: string[]; skipped: Array<{ id: string; reason: string }> } | { ok: false; error: string };

const PUBLIC_PATHS = ["/", "/services", "/work", "/how-it-works", "/media"] as const;

async function owner(): Promise<Owner> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error.replace("use pricing", "manage media") };
  const supabase = await createClient();
  return { ok: true, supabase, userId: guard.viewer.userId };
}

function revalidateMedia() {
  for (const p of PUBLIC_PATHS) revalidatePath(p);
  revalidatePath("/services", "layout");
}

async function audit(supabase: Client, userId: string, action: string, entityId: string | null, data: Record<string, Json | undefined> = {}) {
  await writeAudit(supabase, { ownerId: userId, actorId: userId, entity: "studio", entityId, action: `media.${action}`, data });
}

function uuidList(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 200) return null;
  const ids = [...new Set(input)];
  return ids.every(isUuid) ? (ids as string[]) : null;
}

// ---------------------------------------------------------------------------
// Upload: sign → browser uploads to the private bucket → finalize
// ---------------------------------------------------------------------------

export type CreateUploadResult =
  | { ok: true; kind: "upload"; assetId: string; path: string; token: string; signedUrl: string }
  | { ok: true; kind: "duplicate"; asset: MediaAsset }
  | { ok: true; kind: "retry"; asset: MediaAsset }
  | { ok: false; error: string };

/**
 * Step 1. Validates the claim (fingerprint, size, type), returns the
 * existing asset when the same bytes were uploaded before (no second
 * upload), otherwise inserts a `draft` row and mints a signed upload URL for
 * "<owner>/<sha256>.<ext>" in the private bucket. The URL is minted with the
 * owner's own session, so the storage policy (own folder only) is what
 * authorises it; the service role is not involved.
 */
export async function createMediaUpload(input: unknown): Promise<CreateUploadResult> {
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const parsed = validateUploadRequest(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { sha256, bytes, mime, ext } = parsed.value;
  const { supabase, userId } = o;
  const base = supabasePublicBase();

  const { data: existing } = await supabase.from("photo_media_assets").select("*").eq("owner_id", userId).eq("content_sha256", sha256).maybeSingle();
  if (existing && existing.status !== "draft") {
    if (existing.status === "failed") return { ok: true, kind: "retry", asset: toMediaAsset(existing, base) };
    return { ok: true, kind: "duplicate", asset: toMediaAsset(existing, base) };
  }

  const key = originalKey(userId, sha256, ext);
  let assetId = existing?.id ?? null;
  if (!assetId) {
    const { data: inserted, error } = await supabase
      .from("photo_media_assets")
      .insert({ owner_id: userId, status: "draft", content_sha256: sha256, original_key: key, original_bytes: bytes, mime, source: "web_upload" })
      .select("id")
      .single();
    if (error || !inserted) return { ok: false, error: error?.message ?? "The upload could not be registered." };
    assetId = inserted.id;
  }
  const { data: signed, error: signError } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUploadUrl(key, { upsert: true });
  if (signError || !signed) return { ok: false, error: `The upload could not be authorised (${signError?.message ?? "no URL"}). Check that the storage buckets exist (docs/media-library.md).` };
  await audit(supabase, userId, "upload.created", assetId, { bytes, mime });
  return { ok: true, kind: "upload", assetId, path: signed.path, token: signed.token, signedUrl: signed.signedUrl };
}

export type FinalizeResult = { ok: true; asset: MediaAsset } | { ok: false; error: string; asset?: MediaAsset };

/**
 * Step 2 (and retry from `failed`). Marks the row `processing`, reads the
 * original from the private bucket, validates the real bytes, renders the
 * web copies into the public bucket and marks the row `ready`; any failure
 * marks it `failed` with a message the owner can act on.
 */
export async function finalizeMediaUpload(assetId: unknown): Promise<FinalizeResult> {
  if (!isUuid(assetId)) return { ok: false, error: "Invalid asset id." };
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, userId } = o;
  const base = supabasePublicBase();
  const { data: row } = await supabase.from("photo_media_assets").select("*").eq("id", assetId).eq("owner_id", userId).maybeSingle();
  if (!row) return { ok: false, error: "Asset not found." };
  if (row.status !== "draft" && row.status !== "failed" && row.status !== "processing") return { ok: true, asset: toMediaAsset(row, base) };
  if (!isServiceClientConfigured()) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server, so web copies cannot be made. The original is stored; retry once it is configured.", asset: toMediaAsset(row, base) };

  await supabase.from("photo_media_assets").update({ status: "processing", error: null }).eq("id", assetId).eq("owner_id", userId);
  const service = createServiceClient();
  try {
    const result = await processAsset(service, row);
    const { data: updated, error } = await supabase
      .from("photo_media_assets")
      .update({ status: "ready", error: null, original_width: result.width, original_height: result.height, derivatives: derivativesJson(result.derivatives), blur_data_url: result.blurDataURL })
      .eq("id", assetId)
      .eq("owner_id", userId)
      .select("*")
      .single();
    if (error || !updated) throw new Error(error?.message ?? "The asset could not be updated.");
    await audit(supabase, userId, "processed", assetId, { width: result.width, height: result.height, derivatives: result.derivatives.length });
    revalidatePath("/media");
    return { ok: true, asset: toMediaAsset(updated, base) };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const { data: failed } = await supabase.from("photo_media_assets").update({ status: "failed", error: message }).eq("id", assetId).eq("owner_id", userId).select("*").single();
    await audit(supabase, userId, "failed", assetId, { error: message });
    return { ok: false, error: message, asset: failed ? toMediaAsset(failed, base) : undefined };
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function transition(ids: unknown, action: string, allowed: (row: PhotoMediaAssetRow) => string | null, patch: (row: PhotoMediaAssetRow) => Partial<PhotoMediaAssetRow>, after?: (rows: PhotoMediaAssetRow[]) => Promise<void>): Promise<MediaBatchResult> {
  const list = uuidList(ids);
  if (!list) return { ok: false, error: "Choose at least one asset." };
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, userId } = o;
  const { data: rows } = await supabase.from("photo_media_assets").select("*").eq("owner_id", userId).in("id", list);
  const found = new Map((rows ?? []).map((r) => [r.id, r]));
  const done: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const changed: PhotoMediaAssetRow[] = [];
  for (const id of list) {
    const row = found.get(id);
    if (!row) {
      skipped.push({ id, reason: "Not found." });
      continue;
    }
    const reason = allowed(row);
    if (reason) {
      skipped.push({ id, reason });
      continue;
    }
    const { error } = await supabase.from("photo_media_assets").update(patch(row)).eq("id", id).eq("owner_id", userId).eq("status", row.status);
    if (error) {
      skipped.push({ id, reason: error.message });
      continue;
    }
    done.push(id);
    changed.push(row);
  }
  if (after && changed.length) await after(changed);
  if (done.length) {
    await audit(supabase, userId, action, done.length === 1 ? done[0] : null, { ids: done, skipped: skipped.length });
    revalidateMedia();
  }
  return { ok: true, done, skipped };
}

/** ready → published. Requires rights_confirmed, and guardian_ok when the asset needs review. Classification never sets those. */
export async function publishMedia(ids: unknown): Promise<MediaBatchResult> {
  const now = new Date().toISOString();
  return transition(ids, "published", (row) => (row.status === "published" ? "Already published." : publishBlocker(row)), () => ({ status: "published", published_at: now, archived_at: null }));
}

/** published → ready. The derivatives stay in the public bucket until archived; see docs/media-library.md on what unpublish can and cannot retract. */
export async function unpublishMedia(ids: unknown): Promise<MediaBatchResult> {
  return transition(ids, "unpublished", (row) => (row.status === "published" ? null : "Not published."), () => ({ status: "ready" }));
}

/** ready | published | failed → archived. Web copies are removed from the public bucket; the original stays in the private bucket so restore can rebuild them. */
export async function archiveMedia(ids: unknown): Promise<MediaBatchResult> {
  const now = new Date().toISOString();
  return transition(
    ids,
    "archived",
    (row) => (row.status === "ready" || row.status === "published" || row.status === "failed" ? null : `Cannot archive a ${row.status} asset.`),
    () => ({ status: "archived", archived_at: now, derivatives: [] as Json }),
    async (rows) => {
      if (!isServiceClientConfigured()) return;
      const service = createServiceClient();
      for (const row of rows) await removeDerivatives(service, readDerivatives(row.derivatives)).catch(() => undefined);
    },
  );
}

/** archived → ready, re-rendering the web copies from the kept original. */
export async function restoreMedia(ids: unknown): Promise<MediaBatchResult> {
  const result = await transition(ids, "restored", (row) => (row.status === "archived" ? null : "Not archived."), () => ({ status: "failed", archived_at: null, error: null }));
  if (!result.ok) return result;
  for (const id of result.done) {
    const fin = await finalizeMediaUpload(id);
    if (!fin.ok) result.skipped.push({ id, reason: fin.error });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function updateMediaMeta(id: unknown, input: unknown): Promise<{ ok: true; asset: MediaAsset } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: "Invalid asset id." };
  const parsed = parseMetaPatch(input);
  if (!parsed.ok) return parsed;
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, userId } = o;
  const { data, error } = await supabase.from("photo_media_assets").update(parsed.patch).eq("id", id).eq("owner_id", userId).select("*").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Asset not found." };
  // A published asset whose confirmations were withdrawn goes back to ready immediately.
  if (data.status === "published" && publishBlocker({ ...data, status: "ready" })) {
    await supabase.from("photo_media_assets").update({ status: "ready" }).eq("id", id).eq("owner_id", userId);
    data.status = "ready";
  }
  await audit(supabase, userId, "meta.updated", data.id, { fields: Object.keys(parsed.patch) });
  revalidateMedia();
  return { ok: true, asset: toMediaAsset(data, supabasePublicBase()) };
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

/** Replaces one placement's ordered list. Ids must be the owner's own non-archived assets; the hero keeps one. */
export async function setPlacement(placement: unknown, orderedIds: unknown): Promise<MediaResult> {
  const canonical = parsePlacement(placement);
  if (!canonical) return { ok: false, error: "Unknown placement." };
  if (!Array.isArray(orderedIds) || orderedIds.length > 200 || !orderedIds.every(isUuid)) return { ok: false, error: "The list of photographs could not be read." };
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, userId } = o;
  const ids = orderedIds as string[];
  if (ids.length) {
    const { data: rows } = await supabase.from("photo_media_assets").select("id, status").eq("owner_id", userId).in("id", ids);
    const usable = new Set((rows ?? []).filter((r) => r.status === "ready" || r.status === "published").map((r) => r.id));
    const missing = ids.filter((id) => !usable.has(id));
    if (missing.length) return { ok: false, error: "Only ready or published photographs can be placed." };
  }
  const rows = placementRows(canonical as MediaPlacement, ids).map((r) => ({ ...r, owner_id: userId }));
  const { error: delError } = await supabase.from("photo_media_placements").delete().eq("owner_id", userId).eq("placement", canonical);
  if (delError) return { ok: false, error: delError.message };
  if (rows.length) {
    const { error } = await supabase.from("photo_media_placements").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  await audit(supabase, userId, "placement.set", null, { placement: canonical, count: rows.length });
  revalidateMedia();
  return { ok: true };
}
