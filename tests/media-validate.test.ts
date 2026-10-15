import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { checkImageMeta, derivativeKey, isDerivativeKey, isOriginalKeyFor, normalizeMime, originalKey, validateUploadRequest } from "@/lib/media/validate";
import { derivativeWidthsFor } from "@/lib/media/process";
import { MEDIA_MAX_BYTES, readDerivatives } from "@/lib/media/types";

const OWNER = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);

describe("upload request validation", () => {
  const good = { sha256: SHA, bytes: 1024 * 1024, mime: "image/jpeg", filename: "DSC_0001.jpg" };

  it("accepts a JPEG claim and derives the extension", () => {
    const r = validateUploadRequest(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ext).toBe("jpg");
  });

  it("rejects a bad fingerprint, empty and oversized files", () => {
    expect(validateUploadRequest({ ...good, sha256: "nope" }).ok).toBe(false);
    expect(validateUploadRequest({ ...good, sha256: SHA.toUpperCase() }).ok).toBe(false);
    expect(validateUploadRequest({ ...good, bytes: 0 }).ok).toBe(false);
    expect(validateUploadRequest({ ...good, bytes: MEDIA_MAX_BYTES + 1 }).ok).toBe(false);
    expect(validateUploadRequest({ ...good, bytes: 12.5 }).ok).toBe(false);
    expect(validateUploadRequest(null).ok).toBe(false);
    expect(validateUploadRequest("x").ok).toBe(false);
  });

  it("rejects GIF, SVG and video with a clear message and accepts PNG/WebP/HEIC/TIFF", () => {
    const gif = validateUploadRequest({ ...good, mime: "image/gif", filename: "a.gif" });
    expect(gif).toEqual({ ok: false, error: expect.stringContaining("GIF") });
    expect(validateUploadRequest({ ...good, mime: "image/svg+xml", filename: "a.svg" })).toEqual({ ok: false, error: expect.stringContaining("SVG") });
    expect(validateUploadRequest({ ...good, mime: "video/mp4", filename: "a.mp4" })).toEqual({ ok: false, error: expect.stringContaining("Videos") });
    for (const [mime, ext] of [
      ["image/png", "png"],
      ["image/webp", "webp"],
      ["image/heic", "heic"],
      ["image/tiff", "tif"],
    ]) {
      const r = validateUploadRequest({ ...good, mime, filename: `a.${ext}` });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.ext).toBe(ext);
    }
  });

  it("normalises browser mimes from the file name when the type is missing or odd", () => {
    expect(normalizeMime("", "IMG_1.HEIC")).toBe("image/heic");
    expect(normalizeMime("image/jpg", "a.jpg")).toBe("image/jpeg");
    expect(normalizeMime("application/octet-stream", "a.tiff")).toBe("image/tiff");
    expect(normalizeMime("application/octet-stream", "a.exe")).toBe("application/octet-stream");
  });
});

describe("storage keys", () => {
  it("derives immutable, traversal-safe keys from owner + sha256", () => {
    expect(originalKey(OWNER, SHA, "jpg")).toBe(`${OWNER}/${SHA}.jpg`);
    expect(derivativeKey(OWNER, SHA, 1280)).toBe(`${OWNER}/${SHA}/1280.jpg`);
    expect(isOriginalKeyFor(`${OWNER}/${SHA}.jpg`, OWNER)).toBe(true);
    expect(isOriginalKeyFor(`${OWNER}/${SHA}.jpg`, "22222222-2222-4222-8222-222222222222")).toBe(false);
    expect(isDerivativeKey(`${OWNER}/${SHA}/640.jpg`)).toBe(true);
  });

  it("refuses anything that is not a uuid / sha / plain extension (no paths, no dots, no slashes)", () => {
    expect(() => originalKey("../etc", SHA, "jpg")).toThrow();
    expect(() => originalKey(OWNER, "../../x", "jpg")).toThrow();
    expect(() => originalKey(OWNER, SHA, "../jpg")).toThrow();
    expect(() => originalKey(OWNER, SHA, "jpg/..")).toThrow();
    expect(() => derivativeKey(OWNER, SHA, 1)).toThrow();
    expect(() => derivativeKey(OWNER, SHA, 1280.5)).toThrow();
    expect(isOriginalKeyFor(`${OWNER}/../${SHA}.jpg`, OWNER)).toBe(false);
    expect(isDerivativeKey(`${OWNER}/${SHA}/../640.jpg`)).toBe(false);
    expect(readDerivatives([{ key: `${OWNER}/${SHA}/../640.jpg`, width: 640, height: 400, bytes: 1 }])).toEqual([]);
  });
});

describe("decoded image rules", () => {
  it("accepts a real JPEG of web size and applies the EXIF rotation to the reported dimensions", () => {
    expect(checkImageMeta({ format: "jpeg", width: 4000, height: 2667 }, "image/jpeg")).toEqual({ ok: true, width: 4000, height: 2667, format: "jpeg" });
    expect(checkImageMeta({ format: "jpeg", width: 4000, height: 2667, orientation: 6 }, "image/jpeg")).toEqual({ ok: true, width: 2667, height: 4000, format: "jpeg" });
  });

  it("rejects a format that does not match the claimed mime", () => {
    const r = checkImageMeta({ format: "png", width: 3000, height: 2000 }, "image/jpeg");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PNG, not the JPEG/);
  });

  it("rejects SVG, GIF and animated files whatever they claim", () => {
    expect(checkImageMeta({ format: "svg", width: 3000, height: 3000 }, "image/jpeg").ok).toBe(false);
    expect(checkImageMeta({ format: "gif", width: 3000, height: 3000 }, "image/jpeg").ok).toBe(false);
    expect(checkImageMeta({ format: "webp", width: 3000, height: 3000, pages: 12 }, "image/webp").ok).toBe(false);
    expect(checkImageMeta({ format: "png", width: 3000, height: 3000, delay: [10, 10] }, "image/png").ok).toBe(false);
  });

  it("enforces the 1200 px minimum long edge and the 8000 px maximum", () => {
    expect(checkImageMeta({ format: "jpeg", width: 1199, height: 800 }, "image/jpeg").ok).toBe(false);
    expect(checkImageMeta({ format: "jpeg", width: 800, height: 1200 }, "image/jpeg").ok).toBe(true);
    expect(checkImageMeta({ format: "jpeg", width: 8001, height: 5000 }, "image/jpeg").ok).toBe(false);
    expect(checkImageMeta({ format: "jpeg", width: 8000, height: 5000 }, "image/jpeg").ok).toBe(true);
    expect(checkImageMeta(null, "image/jpeg").ok).toBe(false);
    expect(checkImageMeta({ format: "jpeg" }, "image/jpeg").ok).toBe(false);
  });

  it("maps HEIC/HEIF claims onto sharp's heif format", () => {
    expect(checkImageMeta({ format: "heif", width: 4032, height: 3024 }, "image/heic").ok).toBe(true);
    expect(checkImageMeta({ format: "heif", width: 4032, height: 3024 }, "image/heif").ok).toBe(true);
  });
});

describe("derivative widths", () => {
  it("never upscales and always includes a largest copy", () => {
    expect(derivativeWidthsFor(6000)).toEqual([640, 1280, 1920, 2560]);
    expect(derivativeWidthsFor(2560)).toEqual([640, 1280, 1920, 2560]);
    expect(derivativeWidthsFor(2000)).toEqual([640, 1280, 1920, 2000]);
    expect(derivativeWidthsFor(900)).toEqual([640, 900]);
    expect(derivativeWidthsFor(600)).toEqual([600]);
  });
});
