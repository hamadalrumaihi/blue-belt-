import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** The fake session: who is signed in and which photo_profiles.role they have. */
const session: { user: { id: string; email: string } | null; role: "owner" | "staff" | "client" } = { user: null, role: "owner" };

vi.mock("@/lib/roles", () => ({
  requireOwner: async () => {
    if (!session.user) return { ok: false, error: "You are signed out." };
    if (session.role !== "owner") return { ok: false, error: "Only the studio owner can use pricing." };
    return { ok: true, viewer: { userId: session.user.id, email: session.user.email, role: "owner" } };
  },
  requireStudioUser: async () => {
    throw new Error("media actions must use requireOwner, not requireStudioUser");
  },
  isStudioRole: (r: string) => r !== "client",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const writeAudit = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/audit", () => ({ writeAudit: (...args: unknown[]) => writeAudit(...(args as [])) }));
const processAsset = vi.fn();
const removeDerivatives = vi.fn(async () => undefined);
vi.mock("@/lib/media/process", () => ({
  processAsset: (...a: unknown[]) => processAsset(...(a as [])),
  removeDerivatives: (...a: unknown[]) => removeDerivatives(...(a as [])),
  derivativesJson: (list: unknown) => list,
}));
const serviceConfigured = { value: true };
const serviceClient = { storage: { from: () => ({}) } };
vi.mock("@/lib/supabase/service", () => ({ isServiceClientConfigured: () => serviceConfigured.value, createServiceClient: () => serviceClient }));

type Result = { data: unknown; error: { message: string } | null; count?: number | null };
const results: Record<string, Result | Result[]> = {};
const writes: Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
const signed = vi.fn(async (path: string) => ({ data: { signedUrl: `https://storage.example/${path}?token=t`, token: "tok", path }, error: null }));

function chain(table: string) {
  const self: Record<string, unknown> = {};
  const filters: Array<[string, unknown]> = [];
  let current: { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> } | null = null;
  const read = { table, filters };
  for (const m of ["select", "order", "limit", "maybeSingle", "single", "is", "not", "or", "gte", "lte", "lt"]) {
    self[m] = () => {
      if (m === "select" && !current) reads.push(read);
      return self;
    };
  }
  for (const f of ["eq", "neq", "in"]) {
    self[f] = (col: string, val: unknown) => {
      filters.push([`${f}:${col}`, val]);
      return self;
    };
  }
  for (const op of ["insert", "update", "delete", "upsert"]) {
    self[op] = (payload?: unknown) => {
      current = { table, op, payload, filters };
      writes.push(current);
      return self;
    };
  }
  self.then = (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => {
    const r = results[table];
    const next = Array.isArray(r) ? (r.shift() ?? { data: null, error: null }) : (r ?? { data: null, error: null });
    return Promise.resolve(next).then(resolve, reject);
  };
  return self;
}

const createClient = vi.fn(async () => ({
  auth: { getUser: async () => ({ data: { user: session.user } }) },
  from: (table: string) => chain(table),
  storage: { from: (bucket: string) => ({ createSignedUploadUrl: (path: string, opts: unknown) => signed(`${bucket}:${path}:${JSON.stringify(opts)}`) }) },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: (...a: unknown[]) => createClient(...(a as [])) }));

import { archiveMedia, createMediaUpload, finalizeMediaUpload, publishMedia, setPlacement, unpublishMedia, updateMediaMeta } from "@/lib/actions/media";
import { parseMetaPatch, publishBlocker } from "@/lib/media/rules";
import type { PhotoMediaAssetRow } from "@/lib/supabase/database.types";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ASSET = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const SHA = "c".repeat(64);
const DERIVS = [{ key: `${OWNER}/${SHA}/1280.jpg`, width: 1280, height: 853, bytes: 1000 }];

function row(overrides: Partial<PhotoMediaAssetRow> = {}): PhotoMediaAssetRow {
  return {
    id: ASSET,
    owner_id: OWNER,
    status: "ready",
    content_sha256: SHA,
    original_key: `${OWNER}/${SHA}.jpg`,
    original_bytes: 5_000_000,
    original_width: 4000,
    original_height: 2667,
    mime: "image/jpeg",
    derivatives: DERIVS,
    blur_data_url: "data:image/jpeg;base64,AA",
    alt: "Alt",
    caption: null,
    category: "tournament_action",
    tags: [],
    focal_x: 0.5,
    focal_y: 0.5,
    sort_order: 0,
    taken_on: null,
    source: "web_upload",
    source_label: null,
    rights_confirmed: true,
    guardian_ok: false,
    needs_review: false,
    review_note: null,
    error: null,
    published_at: null,
    archived_at: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const goodUpload = { sha256: SHA, bytes: 5_000_000, mime: "image/jpeg", filename: "DSC_1.jpg" };

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  writes.length = 0;
  reads.length = 0;
  writeAudit.mockClear();
  createClient.mockClear();
  processAsset.mockReset();
  removeDerivatives.mockClear();
  signed.mockClear();
  serviceConfigured.value = true;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  session.user = { id: OWNER, email: "owner@example.test" };
  session.role = "owner";
});

describe("owner gate", () => {
  it("refuses staff, client and signed-out callers before any query", async () => {
    for (const role of ["staff", "client"] as const) {
      session.role = role;
      const out = await Promise.all([createMediaUpload(goodUpload), finalizeMediaUpload(ASSET), publishMedia([ASSET]), unpublishMedia([ASSET]), archiveMedia([ASSET]), updateMediaMeta(ASSET, { alt: "x" }), setPlacement("hero", [ASSET])]);
      for (const r of out) expect(JSON.stringify(r)).toContain("Only the studio owner can manage media.");
    }
    session.user = null;
    expect(await publishMedia([ASSET])).toEqual({ ok: false, error: "You are signed out." });
    expect(createClient).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("validates ids before touching the database", async () => {
    expect(await finalizeMediaUpload("nope")).toEqual({ ok: false, error: "Invalid asset id." });
    expect(await publishMedia(["nope"])).toEqual({ ok: false, error: "Choose at least one asset." });
    expect(await publishMedia([])).toEqual({ ok: false, error: "Choose at least one asset." });
    expect(await setPlacement("hero", ["x"])).toEqual({ ok: false, error: "The list of photographs could not be read." });
    expect(await setPlacement("banner", [ASSET])).toEqual({ ok: false, error: "Unknown placement." });
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("createMediaUpload", () => {
  it("inserts a draft row with the immutable key and mints a signed URL scoped to the owner's folder", async () => {
    results.photo_media_assets = [{ data: null, error: null }, { data: { id: ASSET }, error: null }];
    const r = await createMediaUpload(goodUpload);
    expect(r).toMatchObject({ ok: true, kind: "upload", assetId: ASSET, token: "tok" });
    const insert = writes.find((w) => w.op === "insert" && w.table === "photo_media_assets");
    expect(insert?.payload).toMatchObject({ owner_id: OWNER, status: "draft", content_sha256: SHA, original_key: `${OWNER}/${SHA}.jpg`, original_bytes: 5_000_000, mime: "image/jpeg", source: "web_upload" });
    expect(insert?.payload).not.toHaveProperty("rights_confirmed");
    expect(signed).toHaveBeenCalledWith(`bbm-media-private:${OWNER}/${SHA}.jpg:{"upsert":true}`);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it("returns the existing asset for the same bytes instead of a second upload", async () => {
    results.photo_media_assets = { data: row({ status: "published" }), error: null };
    const r = await createMediaUpload(goodUpload);
    expect(r).toMatchObject({ ok: true, kind: "duplicate", asset: { id: ASSET, status: "published" } });
    expect(writes).toEqual([]);
    expect(signed).not.toHaveBeenCalled();
  });

  it("offers a retry (no re-upload) when the same bytes failed processing, and re-signs an abandoned draft", async () => {
    results.photo_media_assets = { data: row({ status: "failed", error: "boom" }), error: null };
    expect(await createMediaUpload(goodUpload)).toMatchObject({ ok: true, kind: "retry", asset: { id: ASSET } });
    expect(signed).not.toHaveBeenCalled();
    results.photo_media_assets = { data: row({ status: "draft" }), error: null };
    const again = await createMediaUpload(goodUpload);
    expect(again).toMatchObject({ ok: true, kind: "upload", assetId: ASSET });
    expect(writes.filter((w) => w.op === "insert")).toHaveLength(0);
    expect(signed).toHaveBeenCalledTimes(1);
  });

  it("rejects bad claims without a database round-trip", async () => {
    expect(await createMediaUpload({ ...goodUpload, mime: "image/gif", filename: "a.gif" })).toEqual({ ok: false, error: expect.stringContaining("GIF") });
    expect(await createMediaUpload({ ...goodUpload, bytes: 50 * 1024 * 1024 })).toEqual({ ok: false, error: expect.stringContaining("40 MB") });
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    expect(signed).not.toHaveBeenCalled();
  });
});

describe("finalizeMediaUpload", () => {
  it("moves draft → processing → ready with the rendered facts, through the service client", async () => {
    processAsset.mockResolvedValue({ width: 4000, height: 2667, derivatives: DERIVS, blurDataURL: "data:image/jpeg;base64,AA", format: "jpeg" });
    results.photo_media_assets = [{ data: row({ status: "draft", derivatives: [] }), error: null }, { data: null, error: null }, { data: row({ status: "ready" }), error: null }];
    const r = await finalizeMediaUpload(ASSET);
    expect(r).toMatchObject({ ok: true, asset: { status: "ready", previewUrl: `https://example.supabase.co/storage/v1/object/public/bbm-media-public/${OWNER}/${SHA}/1280.jpg` } });
    expect(processAsset).toHaveBeenCalledWith(serviceClient, expect.objectContaining({ id: ASSET, original_key: `${OWNER}/${SHA}.jpg` }));
    const updates = writes.filter((w) => w.op === "update").map((w) => w.payload as Record<string, unknown>);
    expect(updates[0]).toMatchObject({ status: "processing" });
    expect(updates[1]).toMatchObject({ status: "ready", original_width: 4000, derivatives: DERIVS });
  });

  it("records a failure with the message and allows a retry from failed", async () => {
    processAsset.mockRejectedValue(new Error("The file is a PNG, not the JPEG it was described as."));
    results.photo_media_assets = [{ data: row({ status: "failed", derivatives: [] }), error: null }, { data: null, error: null }, { data: row({ status: "failed", error: "The file is a PNG, not the JPEG it was described as." }), error: null }];
    const r = await finalizeMediaUpload(ASSET);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("PNG"), asset: { status: "failed" } });
    const last = writes.filter((w) => w.op === "update").pop();
    expect(last?.payload).toMatchObject({ status: "failed", error: expect.stringContaining("PNG") });
  });

  it("does not process without the service role and says so", async () => {
    serviceConfigured.value = false;
    results.photo_media_assets = { data: row({ status: "draft", derivatives: [] }), error: null };
    const r = await finalizeMediaUpload(ASSET);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("SUPABASE_SERVICE_ROLE_KEY") });
    expect(processAsset).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("is a no-op that returns the row for an already processed asset", async () => {
    results.photo_media_assets = { data: row({ status: "published" }), error: null };
    expect(await finalizeMediaUpload(ASSET)).toMatchObject({ ok: true, asset: { status: "published" } });
    expect(processAsset).not.toHaveBeenCalled();
  });
});

describe("publish guard", () => {
  it("requires ready status, web copies, rights, and permission when flagged", () => {
    expect(publishBlocker(row())).toBeNull();
    expect(publishBlocker(row({ status: "draft" }))).toMatch(/Only ready/);
    expect(publishBlocker(row({ status: "archived" }))).toMatch(/Only ready/);
    expect(publishBlocker(row({ derivatives: [] }))).toMatch(/No web copies/);
    expect(publishBlocker(row({ rights_confirmed: false }))).toMatch(/rights/);
    expect(publishBlocker(row({ needs_review: true, guardian_ok: false }))).toMatch(/flagged for review/);
    expect(publishBlocker(row({ needs_review: true, guardian_ok: true }))).toBeNull();
    expect(publishBlocker(row({ status: "published", rights_confirmed: false }))).toBeNull();
  });

  it("publishMedia skips unconfirmed assets and publishes the rest with a timestamp", async () => {
    results.photo_media_assets = [{ data: [row(), row({ id: OTHER, rights_confirmed: false })], error: null }, { data: null, error: null }];
    const r = await publishMedia([ASSET, OTHER]);
    expect(r).toEqual({ ok: true, done: [ASSET], skipped: [{ id: OTHER, reason: expect.stringContaining("rights") }] });
    const update = writes.find((w) => w.op === "update");
    expect(update?.payload).toMatchObject({ status: "published", published_at: expect.any(String), archived_at: null });
    expect(update?.filters).toContainEqual(["eq:status", "ready"]);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "media.published" }));
  });

  it("publishMedia refuses an asset needing review without guardian permission, whatever the pipeline wrote", async () => {
    results.photo_media_assets = { data: [row({ needs_review: true, guardian_ok: false })], error: null };
    const r = await publishMedia([ASSET]);
    expect(r).toEqual({ ok: true, done: [], skipped: [{ id: ASSET, reason: expect.stringContaining("flagged for review") }] });
    expect(writes.filter((w) => w.op === "update")).toEqual([]);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("unpublish and archive move the status and archive removes the public copies", async () => {
    results.photo_media_assets = [{ data: [row({ status: "published" })], error: null }, { data: null, error: null }];
    expect(await unpublishMedia([ASSET])).toEqual({ ok: true, done: [ASSET], skipped: [] });
    expect(writes.find((w) => w.op === "update")?.payload).toEqual({ status: "ready" });
    writes.length = 0;
    results.photo_media_assets = [{ data: [row({ status: "published" })], error: null }, { data: null, error: null }];
    expect(await archiveMedia([ASSET])).toEqual({ ok: true, done: [ASSET], skipped: [] });
    expect(writes.find((w) => w.op === "update")?.payload).toMatchObject({ status: "archived", derivatives: [] });
    expect(removeDerivatives).toHaveBeenCalledWith(serviceClient, DERIVS);
  });
});

describe("metadata", () => {
  it("parses a patch strictly and only from explicit fields", () => {
    const ok = parseMetaPatch({ alt: "  A grappler  ", tags: ["BJJ", "bjj", " gi "], focal: { x: 1.4, y: -2 }, category: "team_club", sort_order: 3, rights_confirmed: true, nope: 1 });
    expect(ok).toEqual({ ok: true, patch: { alt: "A grappler", tags: ["bjj", "gi"], focal_x: 1, focal_y: 0, category: "team_club", sort_order: 3, rights_confirmed: true } });
    expect(parseMetaPatch({ category: "selfie" })).toEqual({ ok: false, error: "Unknown category." });
    expect(parseMetaPatch({ rights_confirmed: "yes" })).toMatchObject({ ok: false });
    expect(parseMetaPatch({ focal: { x: "1", y: 0 } })).toMatchObject({ ok: false });
    expect(parseMetaPatch({})).toEqual({ ok: false, error: "Nothing to update." });
    expect(parseMetaPatch({ taken_on: "14/03/2026" })).toMatchObject({ ok: false });
  });

  it("withdrawing the rights confirmation on a published asset unpublishes it", async () => {
    results.photo_media_assets = [{ data: row({ status: "published", rights_confirmed: false }), error: null }, { data: null, error: null }];
    const r = await updateMediaMeta(ASSET, { rights_confirmed: false });
    expect(r).toMatchObject({ ok: true, asset: { status: "ready" } });
    expect(writes.map((w) => w.payload)).toEqual([{ rights_confirmed: false }, { status: "ready" }]);
  });
});

describe("placements", () => {
  it("replaces the placement with ordered rows for the owner's ready/published assets", async () => {
    results.photo_media_assets = { data: [{ id: ASSET, status: "ready" }, { id: OTHER, status: "published" }], error: null };
    results.photo_media_placements = [{ data: null, error: null }, { data: null, error: null }];
    expect(await setPlacement("service:team_tournament", [OTHER, ASSET])).toEqual({ ok: true });
    const del = writes.find((w) => w.op === "delete");
    expect(del?.filters).toEqual([["eq:owner_id", OWNER], ["eq:placement", "service:club"]]);
    const ins = writes.find((w) => w.op === "insert");
    expect(ins?.payload).toEqual([
      { placement: "service:club", asset_id: OTHER, position: 0, owner_id: OWNER },
      { placement: "service:club", asset_id: ASSET, position: 1, owner_id: OWNER },
    ]);
  });

  it("refuses ids that are not the owner's ready/published assets", async () => {
    results.photo_media_assets = { data: [{ id: ASSET, status: "archived" }], error: null };
    expect(await setPlacement("featured", [ASSET, OTHER])).toEqual({ ok: false, error: "Only ready or published photographs can be placed." });
    expect(writes.filter((w) => w.table === "photo_media_placements")).toEqual([]);
  });

  it("keeps a single hero", async () => {
    results.photo_media_assets = { data: [{ id: ASSET, status: "ready" }, { id: OTHER, status: "ready" }], error: null };
    results.photo_media_placements = [{ data: null, error: null }, { data: null, error: null }];
    await setPlacement("hero", [OTHER, ASSET]);
    expect((writes.find((w) => w.op === "insert")?.payload as unknown[]).length).toBe(1);
  });
});
