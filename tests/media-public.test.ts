import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T extends (...a: never[]) => unknown>(fn: T) => fn }));

const viewer: { role: "owner" | "staff" | "client" | null } = { role: null };
vi.mock("@/lib/roles", () => ({
  resolveViewer: async () => (viewer.role ? { userId: "u", email: null, role: viewer.role } : null),
  isStudioRole: (r: string) => r === "owner" || r === "staff",
}));
const OWNER = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/studio/queries", () => ({ loadPublicStudio: async () => ({ studio: { owner_id: OWNER }, services: [] }) }));

const tables: Record<string, unknown[]> = { photo_media_assets: [], photo_media_placements: [] };
const signedUrls = vi.fn(async (bucket: string, paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://x.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=t`, signedURL: "", error: null })), error: null }));
function chain(table: string) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) self[m] = () => self;
  self.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: tables[table], error: null }).then(resolve);
  return self;
}
vi.mock("@/lib/supabase/service", () => ({
  isServiceClientConfigured: () => true,
  createServiceClient: () => ({ from: (t: string) => chain(t), storage: { from: (bucket: string) => ({ createSignedUrls: (paths: string[]) => signedUrls(bucket, paths) }) } }),
}));

import { loadPlacedMedia, loadPublicMedia } from "@/lib/media/public";
import { loadLibraryGallery } from "@/lib/media/site-gallery";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const asset = (id: string, sha: string, status: "published" | "ready") => ({ id, status, derivatives: [{ key: `${OWNER}/${sha}/1280.jpg`, width: 1280, height: 853, bytes: 1 }], blur_data_url: null, alt: "alt", caption: null, category: "tournament_action", tags: [], focal_x: 0.5, focal_y: 0.5, taken_on: null, sort_order: 0, published_at: null });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  viewer.role = null;
  signedUrls.mockClear();
  tables.photo_media_assets = [asset(A, SHA_A, "ready"), asset(B, SHA_B, "published")];
  tables.photo_media_placements = [
    { asset_id: A, placement: "hero", position: 0 },
    { asset_id: A, placement: "featured", position: 0 },
    { asset_id: B, placement: "featured", position: 1 },
  ];
});

describe("anonymous visitors", () => {
  it("see published assets only, as public URLs, with no preview notice and no signed URLs minted", async () => {
    const items = await loadPublicMedia({ placement: "featured" });
    expect(items.map((i) => i.id)).toEqual([B]);
    expect(items[0].src).toBe(`https://x.supabase.co/storage/v1/object/public/bbm-media-public/${OWNER}/${SHA_B}/1280.jpg`);
    expect(await loadPublicMedia({ placement: "featured", preview: true })).toHaveLength(1); // preview flag ignored without a studio session
    const placed = await loadPlacedMedia({ preview: true });
    expect(placed?.pending).toBe(false);
    expect(placed?.published).toBe(true);
    expect(placed?.byPlacement.hero).toEqual([]);
    expect(signedUrls).not.toHaveBeenCalled();
  });

  it("get the manifest fallback (null library gallery) when only unpublished work is placed", async () => {
    tables.photo_media_assets = [asset(A, SHA_A, "ready")];
    tables.photo_media_placements = [{ asset_id: A, placement: "hero", position: 0 }];
    expect(await loadLibraryGallery({ preview: true })).toBeNull();
    const placed = await loadPlacedMedia({ preview: true });
    expect(placed).toMatchObject({ pending: false, published: false });
  });
});

describe("studio preview", () => {
  it("includes ready assets through short-lived signed private URLs and flags them as pending", async () => {
    viewer.role = "owner";
    const items = await loadPublicMedia({ placement: "featured", preview: true });
    expect(items.map((i) => i.id)).toEqual([A, B]);
    expect(items[0].src).toContain("/object/sign/bbm-media-private/");
    expect(items[1].src).toContain("/object/public/bbm-media-public/");
    expect(signedUrls).toHaveBeenCalledWith("bbm-media-private", [`${OWNER}/${SHA_A}/1280.jpg`]);
    const gallery = await loadLibraryGallery({ preview: true });
    expect(gallery?.hero?.id).toBe(A);
    expect(gallery?.pending).toBe(true);
    expect(gallery?.published).toBe(true);
  });

  it("still hides ready assets when preview is not requested", async () => {
    viewer.role = "staff";
    expect((await loadPublicMedia({ placement: "featured" })).map((i) => i.id)).toEqual([B]);
    expect(signedUrls).not.toHaveBeenCalled();
  });
});
