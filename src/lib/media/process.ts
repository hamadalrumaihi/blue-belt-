import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, PhotoMediaAssetRow } from "@/lib/supabase/database.types";
import { DERIVATIVE_WIDTHS, MEDIA_MAX_EDGE, PRIVATE_BUCKET, PUBLIC_BUCKET, type Derivative } from "./types";
import { derivativeKey, inspectImage, isDerivativeKey, isOriginalKeyFor } from "./validate";

type Client = SupabaseClient<Database>;

/**
 * Turns an uploaded original into web copies and moves them between the
 * buckets. Runs with the SERVICE client because the public bucket has no
 * authenticated write policy (by design: nothing but this code puts bytes
 * where visitors can fetch them).
 *
 *  processAsset   download the original from the private bucket (key must be the
 *                 row's own), decode ONCE, re-check format/size/animation, render
 *                 sRGB JPEGs at 640/1280/1920/2560 (never upscaling) with EVERY
 *                 piece of metadata removed (EXIF, GPS, camera, ICC, XMP) plus a
 *                 20 px blur, and store them in the PRIVATE bucket at
 *                 "<ownerId>/<sha256>/<width>.jpg". Nothing public yet.
 *  publishDerivatives     copy the private web copies to the public bucket (publishMedia,
 *                         after the rights/guardian guard passed).
 *  removePublicDerivatives delete the public copies (unpublish, archive); the
 *                         private copies stay so a re-publish is a copy, not a render.
 *
 * Status transitions are the caller's job; these functions return facts or
 * throw with a message fit for the owner.
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
  const widths = derivativeWidthsFor(inspected.width);
  const largest = widths[widths.length - 1];
  // One decode of the original: .rotate() applies the EXIF orientation to the pixels and the
  // ICC profile is used for the sRGB conversion. The result is a raw sRGB master at the largest
  // derivative width (at most 2560 px wide); every web copy and the blur are encoded from it,
  // so the 8000 px original is decompressed exactly once. No metadata survives: withMetadata()
  // is never called and the profile is not attached.
  const master = await sharp(original, { failOn: "error", limitInputPixels: MEDIA_MAX_EDGE * MEDIA_MAX_EDGE })
    .rotate()
    .resize({ width: largest, withoutEnlargement: true })
    .withIccProfile("srgb", { attach: false })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const fromMaster = () => sharp(master.data, { raw: { width: master.info.width, height: master.info.height, channels: master.info.channels as 3 | 4 } });
  const derivatives: RenderedDerivative[] = [];
  for (const width of widths) {
    const out = await fromMaster()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true })
      .toBuffer({ resolveWithObject: true });
    derivatives.push({ key: derivativeKey(ownerId, sha256, out.info.width), width: out.info.width, height: out.info.height, bytes: out.info.size, buffer: out.data });
  }
  const blur = await fromMaster().resize(20, 20, { fit: "inside" }).jpeg({ quality: 40 }).toBuffer();
  return { width: inspected.width, height: inspected.height, derivatives, blurDataURL: `data:image/jpeg;base64,${blur.toString("base64")}`, format: inspected.format };
}

/** Downloads, renders and stores the web copies in the PRIVATE bucket. Throws on any failure; the caller records the message on the row. */
export async function processAsset(service: Client, row: Pick<PhotoMediaAssetRow, "id" | "owner_id" | "content_sha256" | "original_key" | "mime">): Promise<ProcessResult> {
  if (!isOriginalKeyFor(row.original_key, row.owner_id)) throw new Error("The original's storage key is not valid for this owner.");
  const { data: blob, error: downloadError } = await service.storage.from(PRIVATE_BUCKET).download(row.original_key);
  if (downloadError || !blob) throw new Error(`The original could not be read from storage (${downloadError?.message ?? "no data"}). Upload it again.`);
  const original = Buffer.from(await blob.arrayBuffer());
  const rendered = await renderDerivatives(original, row.owner_id, row.content_sha256, row.mime);
  const stored: Derivative[] = [];
  for (const d of rendered.derivatives) {
    const { error } = await service.storage.from(PRIVATE_BUCKET).upload(d.key, d.buffer, { contentType: "image/jpeg", cacheControl: "31536000", upsert: true });
    if (error) throw new Error(`A web copy could not be stored (${error.message}).`);
    stored.push({ key: d.key, width: d.width, height: d.height, bytes: d.bytes });
  }
  return { width: rendered.width, height: rendered.height, blurDataURL: rendered.blurDataURL, format: rendered.format, derivatives: stored };
}

function safeKeys(derivatives: Derivative[]): string[] {
  return derivatives.map((d) => d.key).filter(isDerivativeKey);
}

/** Copies an asset's web copies from the private bucket to the public one. Only publishMedia calls this, after its guard. */
export async function publishDerivatives(service: Client, derivatives: Derivative[]): Promise<void> {
  const keys = safeKeys(derivatives);
  if (!keys.length) throw new Error("No web copies exist for this asset.");
  // A stale public copy (from an earlier publish) would make copy() fail; clear it first.
  await service.storage.from(PUBLIC_BUCKET).remove(keys);
  for (const key of keys) {
    const { error } = await service.storage.from(PRIVATE_BUCKET).copy(key, key, { destinationBucket: PUBLIC_BUCKET });
    if (error) throw new Error(`A web copy could not be published (${error.message}).`);
  }
}

/** Removes an asset's web copies from the public bucket (unpublish, archive). Private copies and the original stay. */
export async function removePublicDerivatives(service: Client, derivatives: Derivative[]): Promise<void> {
  const keys = safeKeys(derivatives);
  if (!keys.length) return;
  const { error } = await service.storage.from(PUBLIC_BUCKET).remove(keys);
  if (error) throw new Error(`Web copies could not be removed from the public bucket (${error.message}).`);
}

export function derivativesJson(list: Derivative[]): Json {
  return list.map((d) => ({ key: d.key, width: d.width, height: d.height, bytes: d.bytes }));
}
