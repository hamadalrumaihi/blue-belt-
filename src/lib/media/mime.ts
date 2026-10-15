/**
 * Mime helpers shared by the browser uploader and the server validation.
 * Pure: safe to import from client components (validate.ts is not, because
 * it loads sharp).
 */
export const ACCEPTED_MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tif",
};

export const ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff,.jpg,.jpeg,.png,.webp,.heic,.heif,.tif,.tiff";

/** Normalises a browser mime (some report image/jpg, some nothing for HEIC) using the file name as a hint. */
export function normalizeMime(mime: unknown, filename: unknown): string {
  const m = typeof mime === "string" ? mime.trim().toLowerCase() : "";
  if (m === "image/jpg" || m === "image/pjpeg") return "image/jpeg";
  if (m in ACCEPTED_MIMES) return m;
  const name = typeof filename === "string" ? filename.toLowerCase() : "";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const byExt: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff" };
  return byExt[ext] ?? m;
}

export function friendlyMimeError(mime: string): string {
  if (mime === "image/gif") return "GIF files are not accepted. Export a JPEG.";
  if (mime === "image/svg+xml") return "SVG files are not accepted. Export a JPEG.";
  if (mime.startsWith("video/")) return "Videos are not accepted here. Upload photographs (JPEG preferred).";
  return "Only JPEG, PNG, WebP, HEIC or TIFF photographs are accepted. JPEG is best.";
}
