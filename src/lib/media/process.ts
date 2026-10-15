import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, PhotoMediaAssetRow } from "@/lib/supabase/database.types";
import { DERIVATIVE_WIDTHS, PRIVATE_BUCKET, PUBLIC_BUCKET, type Derivative } from "./types";
import { derivativeKey, inspectImage, isOriginalKeyFor } from "./validate";

type Client = SupabaseClient<Database>;

/**
 * Turns an uploaded original into web copies. Runs with the SERVICE client
 * because the public bucket has no authenticated write policy (by design:
 * nothing but this code puts bytes where visitors can fetch them).
 *
 *  1. download the original from the private bucket (key must be the row's own)
 *  2. decode with sharp; re-check the real format, size and animation rules
 *  3. for each width (640/1280/1920/2560, never upscaling) write an sRGB JPEG
 *     with EVERY piece of metadata removed (EXIF, GPS, camera, ICC, XMP)
 *  4. a 20 px blur placeholder as a data URL
 *  5. upload the derivatives to "<ownerId>/<sha256>/<width>.jpg" in the public bucket
 *
 * Status transitions are the caller's job (processing → ready | failed); this
 * function returns the facts or throws with a message fit for the owner.
 */
export type ProcessResult = { width: number; height: number; derivatives: Derivative[]; blurDataURL: string; format: string };
export type RenderedDerivative = Derivative & { buffer: Buffer };
export type RenderResult = Omit<ProcessResult, "derivatives"> & { derivatives: RenderedDerivative[] };

export const JPEG_QUALITY = 84;

/** The derivative widths for an original of width `w`: standard widths below w, plus w itself (capped at the largest standard width) so there is always a "largest". */
export function derivativeWidthsFor(w: number): number[] {
  const maxStandard = DERIVATIVE_WIDTHS[DERIVATIVE_WIDTHS.length - 1];
  const widths = new Set<number>(DERIVATIVE_WIDTHS.filter((x) => x < w));
  widths.add(Math.min(w, maxStandard));
  return [...widths].sort((a, b) => a - b);
}

export async function renderDerivatives(original: Buffer, ownerId: string, sha256: string, mime: string): Promise<RenderResult> {
  const inspected = await inspectImage(original, mime);
  if (!inspected.ok) throw new Error(inspected.error);
  const { default: sharp } = await import("sharp");
  // .rotate() applies the EXIF orientation to the pixels; the EXIF itself is dropped
  // because withMetadata() is never called. withIccProfile('srgb', attach:false) converts
  // from the embedded profile to sRGB and then leaves no profile in the file.
  const base = sharp(original, { failOn: "error", limitInputPixels: 12000 * 12000 }).rotate();
  const derivatives: RenderedDerivative[] = [];
  for (const width of derivativeWidthsFor(inspected.width)) {
    const out = await base
      .clone()
      .resize({ width, withoutEnlargement: true })
      .withIccProfile("srgb", { attach: false })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true })
      .toBuffer({ resolveWithObject: true });
    derivatives.push({ key: derivativeKey(ownerId, sha256, out.info.width), width: out.info.width, height: out.info.height, bytes: out.info.size, buffer: out.data });
  }
  const blur = await base.clone().resize(20, 20, { fit: "inside" }).withIccProfile("srgb", { attach: false }).jpeg({ quality: 40 }).toBuffer();
  return { width: inspected.width, height: inspected.height, derivatives, blurDataURL: `data:image/jpeg;base64,${blur.toString("base64")}`, format: inspected.format };
}

/** Downloads, renders and uploads. Throws on any failure; the caller records the message on the row. */
export async function processAsset(service: Client, row: Pick<PhotoMediaAssetRow, "id" | "owner_id" | "content_sha256" | "original_key" | "mime">): Promise<ProcessResult> {
  if (!isOriginalKeyFor(row.original_key, row.owner_id)) throw new Error("The original's storage key is not valid for this owner.");
  const { data: blob, error: downloadError } = await service.storage.from(PRIVATE_BUCKET).download(row.original_key);
  if (downloadError || !blob) throw new Error(`The original could not be read from storage (${downloadError?.message ?? "no data"}). Upload it again.`);
  const original = Buffer.from(await blob.arrayBuffer());
  const rendered = await renderDerivatives(original, row.owner_id, row.content_sha256, row.mime);
  const uploaded: Derivative[] = [];
  for (const d of rendered.derivatives) {
    const { error } = await service.storage.from(PUBLIC_BUCKET).upload(d.key, d.buffer, { contentType: "image/jpeg", cacheControl: "31536000", upsert: true });
    if (error) throw new Error(`A web copy could not be stored (${error.message}).`);
    uploaded.push({ key: d.key, width: d.width, height: d.height, bytes: d.bytes });
  }
  return { width: rendered.width, height: rendered.height, blurDataURL: rendered.blurDataURL, format: rendered.format, derivatives: uploaded };
}

/** Removes every derivative of an asset from the public bucket (unpublish is a soft hide; this is the hard removal used on archive). */
export async function removeDerivatives(service: Client, derivatives: Derivative[]): Promise<void> {
  const keys = derivatives.map((d) => d.key);
  if (!keys.length) return;
  const { error } = await service.storage.from(PUBLIC_BUCKET).remove(keys);
  if (error) throw new Error(`Web copies could not be removed (${error.message}).`);
}

export function derivativesJson(list: Derivative[]): Json {
  return list.map((d) => ({ key: d.key, width: d.width, height: d.height, bytes: d.bytes }));
}
