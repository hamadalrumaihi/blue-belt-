// Shared helpers for the photo curation pipeline: discovery, hashing, EXIF,
// technical quality signals and perceptual hashes. Pure Node + sharp; no
// network. Every function here is deterministic for the same input bytes.
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const SUPPORTED = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".heif", ".avif"]);

/**
 * Folders that never hold photographs worth scanning on an external drive:
 * OS and application data, caches, previews, raw sidecars, editing scratch.
 */
const SKIP_DIRS = /^(\$recycle\.bin|system volume information|\.trashes|\.spotlight-v100|\.fseventsd|found\.\d+|windows|program files( \(x86\))?|programdata|appdata|node_modules|\.git|\.cache|cache|caches|thumbnails|\.thumbnails|previews|.*\.lrdata|.*\.lrcat-data|.*previews\.lrdata|capture one|.*\.cocatalog|adobe|lightroom|_gsdata_|temp|tmp)$/i;
/** Lightroom, Capture One and OS writes that look like images but are not photographs. */
const SKIP_FILES = /(^thumbs\.db$|^desktop\.ini$|^\._|-preview\.jpg$|_thumb\.jpg$|\.lrprev$)/i;

export function isSkippedDir(name) {
  return name.startsWith(".") || SKIP_DIRS.test(name);
}

/**
 * Every supported image under `root`, recursively, sorted for stable ids.
 * `onDir` is told about each folder visited so long scans can show progress.
 * Unreadable folders are skipped, never fatal.
 */
export async function discover(root, { extensions = SUPPORTED, onDir } = {}) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    onDir?.(dir, out.length);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!isSkippedDir(e.name)) await walk(full);
      } else if (e.isFile() && extensions.has(path.extname(e.name).toLowerCase()) && !SKIP_FILES.test(e.name)) out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

/**
 * Inventory entry without decoding the pixels: size, modification time,
 * dimensions and EXIF from the file header. Fast enough for tens of
 * thousands of files; the pixel-level analysis happens later and only once.
 */
export async function quickInfo(file, root) {
  const st = await stat(file);
  let meta = null;
  try {
    meta = await sharp(file, { failOn: "none" }).metadata();
  } catch {
    /* counted as unreadable below */
  }
  const relative = path.relative(root, file);
  return {
    file: relative,
    name: path.basename(file),
    dir: path.dirname(relative) || ".",
    bytes: st.size,
    mtimeMs: Math.round(st.mtimeMs),
    width: meta?.width ?? null,
    height: meta?.height ?? null,
    format: meta?.format ?? null,
    exif: readExif(meta?.exif),
    readable: Boolean(meta?.width && meta?.height),
  };
}

export async function sha256File(file) {
  const buf = await readFile(file);
  return createHash("sha256").update(buf).digest("hex");
}

/** Minimal EXIF reader: DateTimeOriginal, Make, Model. Returns nulls when absent or unreadable; never throws. */
export function readExif(exif) {
  const out = { takenAt: null, make: null, model: null };
  if (!exif || exif.length < 16) return out;
  try {
    let base = 0;
    if (exif.subarray(0, 6).toString("latin1") === "Exif\0\0") base = 6;
    const le = exif.subarray(base, base + 2).toString("latin1") === "II";
    const u16 = (o) => (le ? exif.readUInt16LE(o) : exif.readUInt16BE(o));
    const u32 = (o) => (le ? exif.readUInt32LE(o) : exif.readUInt32BE(o));
    const ascii = (off, len) => exif.subarray(base + off, base + off + len).toString("latin1").replace(/\0+$/, "").trim();
    const readIfd = (off, want) => {
      const n = u16(base + off);
      const found = {};
      for (let i = 0; i < n; i++) {
        const e = base + off + 2 + i * 12;
        if (e + 12 > exif.length) break;
        const tag = u16(e);
        const type = u16(e + 2);
        const count = u32(e + 4);
        const valueOff = count * (type === 2 ? 1 : 4) > 4 ? u32(e + 8) : e + 8 - base;
        if (want.has(tag)) found[tag] = type === 2 ? ascii(valueOff, count) : u32(e + 8);
      }
      return found;
    };
    const ifd0 = readIfd(u32(base + 4), new Set([0x010f, 0x0110, 0x8769]));
    if (typeof ifd0[0x010f] === "string") out.make = ifd0[0x010f];
    if (typeof ifd0[0x0110] === "string") out.model = ifd0[0x0110];
    if (typeof ifd0[0x8769] === "number") {
      const sub = readIfd(ifd0[0x8769], new Set([0x9003]));
      const dt = sub[0x9003];
      const m = typeof dt === "string" && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(dt);
      if (m) out.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    }
  } catch {
    /* unreadable EXIF is not an error */
  }
  return out;
}

/** Difference hash on a 9x8 grey thumbnail: 64 bits as a hex string. Near-identical frames differ in a few bits. */
export async function dhash(image) {
  const { data } = await image.clone().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] < data[y * 9 + x + 1] ? "1" : "0";
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

/** Mean RGB of a 4x4 grid (48 bytes, hex). Pairs with the dHash so two frames with the same luminance layout but different colours are not called duplicates. */
export async function colorSignature(image) {
  const { data } = await image.clone().removeAlpha().resize(4, 4, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return Buffer.from(data.subarray(0, 48)).toString("hex");
}

/** Mean absolute difference (0..255) between two colour signatures. */
export function colorDistance(a, b) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  let sum = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) sum += Math.abs(x[i] - y[i]);
  return sum / Math.min(x.length, y.length);
}

export function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * Technical signals from a 768px grey working copy:
 *  - sharpness: variance of the Laplacian (higher = more edge energy)
 *  - noise: median absolute Laplacian in low-gradient areas (sensor noise proxy)
 *  - exposure: mean luminance 0..1, fraction of clipped shadows and highlights
 *  - contrast: luminance standard deviation
 * These are decision support only; the vision pass judges intent (motion blur can be the picture).
 */
export async function technicalMetrics(image) {
  const { data, info } = await image.clone().greyscale().resize(768, 768, { fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    sum += v;
    sumSq += v * v;
    if (v <= 8) dark++;
    if (v >= 247) bright++;
  }
  const n = data.length;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const lap = [];
  const flatLap = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const c = data[i];
      const l = data[i - w] + data[i + w] + data[i - 1] + data[i + 1] - 4 * c;
      lap.push(l);
      const grad = Math.abs(data[i + 1] - data[i - 1]) + Math.abs(data[i + w] - data[i - w]);
      if (grad < 6) flatLap.push(Math.abs(l));
    }
  }
  const lapMean = lap.reduce((a, b) => a + b, 0) / lap.length;
  const sharpness = lap.reduce((a, b) => a + (b - lapMean) ** 2, 0) / lap.length;
  flatLap.sort((a, b) => a - b);
  const noise = flatLap.length ? flatLap[Math.floor(flatLap.length / 2)] : 0;
  return {
    sharpness: Math.round(sharpness * 10) / 10,
    noise,
    exposure: { mean: Math.round((mean / 255) * 1000) / 1000, shadowsClipped: Math.round((dark / n) * 1000) / 1000, highlightsClipped: Math.round((bright / n) * 1000) / 1000 },
    contrast: Math.round((std / 255) * 1000) / 1000,
  };
}

/** Validates and measures one file. Returns ok:false (with a reason) for anything sharp cannot decode. */
export async function inspect(file) {
  const st = await stat(file);
  const image = sharp(file, { failOn: "error" }).rotate();
  let meta;
  try {
    meta = await image.metadata();
  } catch (err) {
    return { ok: false, reason: `unreadable: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!meta.width || !meta.height) return { ok: false, reason: "no dimensions" };
  // After .rotate() the EXIF orientation is applied; swap the reported size for 90/270 degree files.
  const swap = meta.orientation && meta.orientation >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;
  const [sha, hash, color, metrics] = await Promise.all([sha256File(file), dhash(image), colorSignature(image), technicalMetrics(image)]);
  return {
    ok: true,
    id: sha.slice(0, 12),
    sha256: sha,
    bytes: st.size,
    format: meta.format,
    width,
    height,
    orientation: width >= height * 1.15 ? "landscape" : height >= width * 1.15 ? "portrait" : "square",
    longEdge: Math.max(width, height),
    megapixels: Math.round((width * height) / 1e5) / 10,
    exif: readExif(meta.exif),
    dhash: hash,
    colorSig: color,
    metrics,
  };
}

/** A 1024px JPEG for the vision pass (about a thousand tokens per image). */
export async function visionJpeg(file) {
  return sharp(file, { failOn: "error" }).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}

/** Percentile of `v` within `values` (0..1); used to normalise sharpness across one batch. */
export function percentile(values, v) {
  if (!values.length) return 0.5;
  const below = values.filter((x) => x < v).length;
  return below / values.length;
}

// ---------------------------------------------------------------------------
// Media library import helpers (scripts/photos/import.mjs). Mirrors
// src/lib/media/process.ts: same widths, same JPEG settings, same metadata
// policy, so a photograph imported from the PC and one uploaded in the
// browser produce identical web copies.
// ---------------------------------------------------------------------------

/** Derivative widths; never upscaled. Keep in sync with DERIVATIVE_WIDTHS in src/lib/media/types.ts. */
export const WEB_WIDTHS = [640, 1280, 1920, 2560];
export const WEB_JPEG_QUALITY = 84;
export const MEDIA_MIN_LONG_EDGE = 1200;
export const MEDIA_MAX_EDGE = 12000;
export const MEDIA_MAX_BYTES = 40 * 1024 * 1024;

/** The widths for an original of width `w`: standard widths below w plus min(w, largest) so there is always a "largest". */
export function webWidthsFor(w) {
  const largest = WEB_WIDTHS[WEB_WIDTHS.length - 1];
  const set = new Set(WEB_WIDTHS.filter((x) => x < w));
  set.add(Math.min(w, largest));
  return [...set].sort((a, b) => a - b);
}

/**
 * sRGB JPEG web copies at each width plus a 20 px blur placeholder. Every
 * piece of metadata is dropped (no withMetadata call; the ICC profile is used
 * for the sRGB conversion and then not attached). Returns buffers; the caller
 * uploads them. `width`/`height` are the oriented dimensions.
 */
export async function buildWebDerivatives(buffer) {
  const base = sharp(buffer, { failOn: "error", limitInputPixels: MEDIA_MAX_EDGE * MEDIA_MAX_EDGE }).rotate();
  const meta = await base.metadata();
  const swap = meta.orientation && meta.orientation >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;
  const derivatives = [];
  for (const w of webWidthsFor(width)) {
    const out = await base.clone().resize({ width: w, withoutEnlargement: true }).withIccProfile("srgb", { attach: false }).jpeg({ quality: WEB_JPEG_QUALITY, mozjpeg: true, progressive: true }).toBuffer({ resolveWithObject: true });
    derivatives.push({ width: out.info.width, height: out.info.height, bytes: out.info.size, buffer: out.data });
  }
  const blur = await base.clone().resize(20, 20, { fit: "inside" }).withIccProfile("srgb", { attach: false }).jpeg({ quality: 40 }).toBuffer();
  return { width, height, format: meta.format, derivatives, blurDataURL: `data:image/jpeg;base64,${blur.toString("base64")}` };
}

/** Non-identifying origin label stored in the database: 12 hex characters of the basename's SHA-256. Never a path. */
export function basenameHash(file) {
  return createHash("sha256").update(path.basename(file).toLowerCase()).digest("hex").slice(0, 12);
}

export const MIME_FOR_FORMAT = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", tiff: "image/tiff", heif: "image/heic" };
export const EXT_FOR_FORMAT = { jpeg: "jpg", png: "png", webp: "webp", tiff: "tif", heif: "heic" };
