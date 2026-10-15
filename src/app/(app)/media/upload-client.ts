"use client";

import { createMediaUpload, finalizeMediaUpload, type CreateUploadResult, type FinalizeResult } from "@/lib/actions/media";
import { ACCEPTED_MIMES, friendlyMimeError, normalizeMime } from "@/lib/media/mime";
import { MEDIA_MAX_BYTES, PRIVATE_BUCKET, type MediaAsset } from "@/lib/media/types";
import { createClient } from "@/lib/supabase/client";

/**
 * The browser side of an upload. The bytes go straight from the browser to
 * the private bucket through a signed URL, so the Next.js server never
 * carries the file (no serverless body limit). The server only validates
 * the claim, signs, and afterwards reads the object itself to process it.
 */
export type UploadStage = "queued" | "hashing" | "signing" | "uploading" | "processing" | "done" | "duplicate" | "failed";
export type UploadItem = { key: string; file: File; stage: UploadStage; progress: number; message: string | null; asset: MediaAsset | null; assetId: string | null };

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Client-side pre-check so an obviously wrong file never reaches the server. */
export function precheck(file: File): string | null {
  const mime = normalizeMime(file.type, file.name);
  if (!ACCEPTED_MIMES[mime]) return friendlyMimeError(mime);
  if (file.size <= 0) return "The file is empty.";
  if (file.size > MEDIA_MAX_BYTES) return `Larger than ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB. Export a smaller JPEG.`;
  return null;
}

export type UploadOutcome = { stage: "done" | "duplicate" | "failed"; asset: MediaAsset | null; assetId: string | null; message: string | null };

export async function runUpload(file: File, onStage: (stage: UploadStage, progress: number) => void): Promise<UploadOutcome> {
  const pre = precheck(file);
  if (pre) return { stage: "failed", asset: null, assetId: null, message: pre };
  onStage("hashing", 0.05);
  const sha256 = await sha256Hex(file);
  const mime = normalizeMime(file.type, file.name);
  onStage("signing", 0.15);
  const created: CreateUploadResult = await createMediaUpload({ sha256, bytes: file.size, mime, filename: file.name });
  if (!created.ok) return { stage: "failed", asset: null, assetId: null, message: created.error };
  if (created.kind === "duplicate") return { stage: "duplicate", asset: created.asset, assetId: created.asset.id, message: `Already in the library (${created.asset.status}).` };
  let assetId: string;
  if (created.kind === "retry") {
    assetId = created.asset.id;
  } else {
    assetId = created.assetId;
    onStage("uploading", 0.25);
    const supabase = createClient();
    const { error } = await supabase.storage.from(PRIVATE_BUCKET).uploadToSignedUrl(created.path, created.token, file, { contentType: mime, upsert: true, cacheControl: "0" });
    if (error) return { stage: "failed", asset: null, assetId, message: `Upload failed: ${error.message}` };
  }
  onStage("processing", 0.7);
  const fin: FinalizeResult = await finalizeMediaUpload(assetId);
  if (!fin.ok) return { stage: "failed", asset: fin.asset ?? null, assetId, message: fin.error };
  onStage("done", 1);
  return { stage: "done", asset: fin.asset, assetId, message: null };
}
