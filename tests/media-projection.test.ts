import { describe, expect, it } from "vitest";
import { PUBLIC_MEDIA_FIELDS, toPublicMediaItem } from "@/lib/media/projection";
import { publicItemToSitePhoto } from "@/lib/media/site-gallery-pure";
import type { PhotoMediaAssetRow } from "@/lib/supabase/database.types";

const OWNER = "11111111-1111-4111-8111-111111111111";
const SHA = "b".repeat(64);
const BASE = "https://example.supabase.co";

function row(overrides: Partial<PhotoMediaAssetRow> = {}): PhotoMediaAssetRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    owner_id: OWNER,
    status: "published",
    content_sha256: SHA,
    original_key: `${OWNER}/${SHA}.jpg`,
    original_bytes: 9_000_000,
    original_width: 6000,
    original_height: 4000,
    mime: "image/jpeg",
    derivatives: [
      { key: `${OWNER}/${SHA}/2560.jpg`, width: 2560, height: 1707, bytes: 900_000 },
      { key: `${OWNER}/${SHA}/640.jpg`, width: 640, height: 427, bytes: 60_000 },
      { key: `${OWNER}/${SHA}/1280.jpg`, width: 1280, height: 853, bytes: 220_000 },
    ],
    blur_data_url: "data:image/jpeg;base64,AAAA",
    alt: "A grappler passes guard during a tournament match",
    caption: "Qatar Open 2026",
    category: "tournament_action",
    tags: ["bjj", "gi"],
    focal_x: 0.62,
    focal_y: 0.4,
    sort_order: 3,
    taken_on: "2026-03-14",
    source: "cli_import",
    source_label: "deadbeef1234",
    rights_confirmed: true,
    guardian_ok: false,
    needs_review: false,
    review_note: "possible minor",
    error: null,
    published_at: "2026-10-01T00:00:00.000Z",
    archived_at: null,
    created_at: "2026-09-30T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const FORBIDDEN = ["owner_id", "ownerId", "original_key", "originalKey", "source", "source_label", "sourceLabel", "review_note", "reviewNote", "error", "mime", "content_sha256", "sha256", "rights_confirmed", "guardian_ok", "needs_review", "status", "original_bytes", "created_at", "updated_at"];

describe("public projection", () => {
  it("returns only the contract fields, in ascending width, with public-bucket URLs", () => {
    const item = toPublicMediaItem(row(), BASE);
    expect(item).not.toBeNull();
    expect(Object.keys(item!).sort()).toEqual([...PUBLIC_MEDIA_FIELDS].sort());
    expect(item!.src).toBe(`${BASE}/storage/v1/object/public/bbm-media-public/${OWNER}/${SHA}/2560.jpg`);
    expect(item!.sources.map((s) => s.width)).toEqual([640, 1280, 2560]);
    expect(item!.width).toBe(2560);
    expect(item!.height).toBe(1707);
    expect(item!.focal).toEqual({ x: 0.62, y: 0.4 });
    expect(item!.blurDataURL).toBe("data:image/jpeg;base64,AAAA");
    expect(item!.takenOn).toBe("2026-03-14");
  });

  it("never carries a forbidden field, the sha in any key except the URL path, or a private-bucket path", () => {
    const item = toPublicMediaItem(row(), BASE)!;
    const json = JSON.stringify(item);
    for (const f of FORBIDDEN) expect(Object.keys(item)).not.toContain(f);
    expect(json).not.toContain("bbm-media-private");
    expect(json).not.toContain(`${SHA}.jpg`);
    expect(json).not.toContain("deadbeef1234");
    expect(json).not.toContain("possible minor");
    for (const s of item.sources) expect(s.src).toContain("/object/public/bbm-media-public/");
    expect(json).not.toContain(OWNER + '"'); // the owner id only ever appears inside a public URL path
  });

  it("hides anything not published; ready only with the explicit preview flag", () => {
    expect(toPublicMediaItem(row({ status: "ready" }), BASE)).toBeNull();
    expect(toPublicMediaItem(row({ status: "ready" }), BASE, { includeReady: true })).not.toBeNull();
    for (const status of ["draft", "processing", "archived", "failed"] as const) {
      expect(toPublicMediaItem(row({ status }), BASE)).toBeNull();
      expect(toPublicMediaItem(row({ status }), BASE, { includeReady: true })).toBeNull();
    }
  });

  it("refuses a published row without web copies, and drops malformed or private-looking derivative keys", () => {
    expect(toPublicMediaItem(row({ derivatives: [] }), BASE)).toBeNull();
    expect(toPublicMediaItem(row({ derivatives: "nope" as unknown as PhotoMediaAssetRow["derivatives"] }), BASE)).toBeNull();
    const item = toPublicMediaItem(row({ derivatives: [{ key: `${OWNER}/${SHA}.jpg`, width: 6000, height: 4000, bytes: 1 }, { key: `${OWNER}/${SHA}/1280.jpg`, width: 1280, height: 853, bytes: 1 }] }), BASE)!;
    expect(item.sources).toHaveLength(1);
    expect(item.src).toContain("/1280.jpg");
  });

  it("clamps the focal point and ignores a blur that is not a data URL", () => {
    const item = toPublicMediaItem(row({ focal_x: 7, focal_y: -1, blur_data_url: "https://evil.example/x.jpg" }), BASE)!;
    expect(item.focal).toEqual({ x: 1, y: 0 });
    expect(item.blurDataURL).toBeUndefined();
  });

  it("maps onto the SitePhoto shape the home page consumes, with the focal point deciding the text side", () => {
    const left = publicItemToSitePhoto(toPublicMediaItem(row({ focal_x: 0.8 }), BASE)!);
    expect(left.textSpace).toBe("left");
    expect(left.needsReview).toBe(false);
    expect(left.folder).toBeNull();
    expect(left.src).toContain("/2560.jpg");
    expect(publicItemToSitePhoto(toPublicMediaItem(row({ focal_x: 0.2 }), BASE)!).textSpace).toBe("right");
    expect(publicItemToSitePhoto(toPublicMediaItem(row({ focal_x: 0.5 }), BASE)!).textSpace).toBe("none");
  });
});
