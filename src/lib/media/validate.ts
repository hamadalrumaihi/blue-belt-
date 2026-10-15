import { isUuid } from "@/lib/validation";
import { ACCEPTED_MIMES, friendlyMimeError, normalizeMime } from "./mime";

export { ACCEPTED_MIMES, friendlyMimeError, normalizeMime };
import { MEDIA_MAX_BYTES, MEDIA_MAX_EDGE, MEDIA_MIN_LONG_EDGE } from "./types";

/**
 * Validation for the media library: the upload request (before a signed URL
 * is issued), the bytes themselves (after they land in the private bucket)
 * and the storage keys. Pure apart from `inspectImage`, which decodes with
 * sharp; everything is unit-tested with sharp mocked.
 */
/** What sharp reports for each accepted mime (HEIC/HEIF both decode as "heif"). */
const FORMAT_FOR_MIME: Record<string, string[]> = {
  "image/jpeg": ["jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/heic": ["heif"],
  "image/heif": ["heif"],
  "image/tiff": ["tiff"],
};

const SHA256_RE = /^[0-9a-f]{64}$/;
const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/;
const DERIVATIVE_KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f]{64}\/\d{3,5}\.jpg$/;

export type UploadRequest = { sha256: string; bytes: number; mime: string; filename: string };
export type UploadRequestResult = { ok: true; value: UploadRequest & { ext: string } } | { ok: false; error: string };

/** Checks the client's claim before anything is written. The bytes are checked again after upload. */
export function validateUploadRequest(input: unknown): UploadRequestResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "The upload request could not be read." };
  const { sha256, bytes, mime: rawMime, filename } = input as Record<string, unknown>;
  if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) return { ok: false, error: "The file fingerprint is missing. Reload the page and try again." };
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) return { ok: false, error: "The file is empty." };
  if (bytes > MEDIA_MAX_BYTES) return { ok: false, error: `The file is larger than ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB. Export a smaller JPEG.` };
  const name = typeof filename === "string" ? filename.trim().slice(0, 255) : "";
  const mime = normalizeMime(rawMime, name);
  const ext = ACCEPTED_MIMES[mime];
  if (!ext) return { ok: false, error: friendlyMimeError(mime) };
  return { ok: true, value: { sha256, bytes, mime, filename: name, ext } };
}

/** Immutable, traversal-safe original key: "<ownerId>/<sha256>.<ext>". Throws on bad input (never from user data directly). */
export function originalKey(ownerId: string, sha256: string, ext: string): string {
  if (!isUuid(ownerId)) throw new Error("originalKey: ownerId must be a UUID");
  if (!SHA256_RE.test(sha256)) throw new Error("originalKey: sha256 must be 64 hex characters");
  if (!/^[a-z0-9]{2,5}$/.test(ext)) throw new Error("originalKey: bad extension");
  const key = `${ownerId.toLowerCase()}/${sha256}.${ext}`;
  if (!KEY_RE.test(key)) throw new Error("originalKey: produced an unsafe key");
  return key;
}

/** Derivative key in the public bucket: "<ownerId>/<sha256>/<width>.jpg". */
export function derivativeKey(ownerId: string, sha256: string, width: number): string {
  if (!isUuid(ownerId)) throw new Error("derivativeKey: ownerId must be a UUID");
  if (!SHA256_RE.test(sha256)) throw new Error("derivativeKey: sha256 must be 64 hex characters");
  if (!Number.isInteger(width) || width < 100 || width > 99999) throw new Error("derivativeKey: bad width");
  const key = `${ownerId.toLowerCase()}/${sha256}/${width}.jpg`;
  if (!DERIVATIVE_KEY_RE.test(key)) throw new Error("derivativeKey: produced an unsafe key");
  return key;
}

export function isOriginalKeyFor(key: string, ownerId: string): boolean {
  return KEY_RE.test(key) && key.startsWith(`${ownerId.toLowerCase()}/`);
}
export function isDerivativeKey(key: string): boolean {
  return DERIVATIVE_KEY_RE.test(key);
}
export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

export type ImageInspection = { ok: true; width: number; height: number; format: string } | { ok: false; error: string };

/** The subset of sharp's metadata the checks need, so tests can feed values without decoding. */
export type ImageMeta = { format?: string; width?: number; height?: number; pages?: number; orientation?: number; delay?: number[] };

/** Pure rules over decoded metadata: real format vs claimed mime, size bounds, no SVG/GIF, no animation. */
export function checkImageMeta(meta: ImageMeta | null, claimedMime: string): ImageInspection {
  if (!meta || !meta.format) return { ok: false, error: "The file is not a photograph sharp can decode." };
  if (meta.format === "svg") return { ok: false, error: "SVG files are not accepted." };
  if (meta.format === "gif") return { ok: false, error: "GIF files are not accepted." };
  if ((meta.pages ?? 1) > 1 || (meta.delay && meta.delay.length > 1)) return { ok: false, error: "Animated images are not accepted." };
  const allowed = FORMAT_FOR_MIME[claimedMime];
  if (!allowed) return { ok: false, error: friendlyMimeError(claimedMime) };
  if (!allowed.includes(meta.format)) return { ok: false, error: `The file is a ${meta.format.toUpperCase()}, not the ${claimedMime.replace("image/", "").toUpperCase()} it was described as.` };
  if (!meta.width || !meta.height) return { ok: false, error: "The image has no dimensions." };
  // EXIF orientation 5..8 rotates by 90 degrees; the long edge is the same either way.
  const long = Math.max(meta.width, meta.height);
  const short = Math.min(meta.width, meta.height);
  if (long < MEDIA_MIN_LONG_EDGE) return { ok: false, error: `The photograph is too small for the web (${long} px on its long edge; at least ${MEDIA_MIN_LONG_EDGE} px is needed).` };
  if (long > MEDIA_MAX_EDGE) return { ok: false, error: `The photograph is too large (${long} px; the limit is ${MEDIA_MAX_EDGE} px). Export a smaller copy.` };
  if (short < 1) return { ok: false, error: "The image has no dimensions." };
  const rotated = (meta.orientation ?? 1) >= 5;
  return { ok: true, width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height, format: meta.format };
}

/** Decodes the header with sharp (never the full pixels) and applies checkImageMeta. */
export async function inspectImage(buffer: Buffer, claimedMime: string): Promise<ImageInspection> {
  if (buffer.length === 0) return { ok: false, error: "The file is empty." };
  if (buffer.length > MEDIA_MAX_BYTES) return { ok: false, error: `The file is larger than ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB.` };
  const { default: sharp } = await import("sharp");
  let meta: ImageMeta | null = null;
  try {
    const m = await sharp(buffer, { failOn: "error", limitInputPixels: MEDIA_MAX_EDGE * MEDIA_MAX_EDGE }).metadata();
    meta = { format: m.format, width: m.width, height: m.height, pages: m.pages, orientation: m.orientation, delay: m.delay };
  } catch (err) {
    return { ok: false, error: `The file could not be decoded (${err instanceof Error ? err.message.replace(/^Input buffer contains unsupported image format$/, "unsupported format") : "unsupported format"}).` };
  }
  return checkImageMeta(meta, claimedMime);
}
