import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/roles", async () => {
  const { createClient } = await import("@/lib/supabase/server");
  return {
    requireStudioUser: async () => {
      const s = await createClient();
      const { data } = await s.auth.getUser();
      const user = data?.user;
      return user ? { ok: true, viewer: { userId: user.id, email: user.email ?? null, role: "owner" } } : { ok: false, error: "You are signed out." };
    },
    isStudioRole: (r: string) => r !== "client",
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(), isServiceClientConfigured: () => false }));
// No extra hosts configured in Settings: the custom domain must work on its own.
vi.mock("@/lib/studio/queries", () => ({ loadStudio: vi.fn(async () => ({ settings: {} })), siteUrl: () => "https://site.test" }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => ({ ok: true })) }));
const enqueueOwnerTelegram = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/notifications/owner", () => ({ enqueueOwnerTelegram: (...args: unknown[]) => enqueueOwnerTelegram(...(args as [])) }));
vi.mock("@/lib/notifications/email/outbox", () => ({ enqueueClientEmail: vi.fn(async () => ({ ok: true, queued: true })) }));

const OWNER = "11111111-1111-4111-8111-111111111111";
const GALLERY = "22222222-2222-4222-8222-222222222222";
const CUSTOM = "https://galleries.bluebelt.media/client/dalob";

type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };
const results: Record<string, Result | Result[]> = {};
const writes: Array<{ table: string; op: string; payload?: unknown }> = [];

function chain(table: string) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "order", "limit", "not", "maybeSingle", "single"]) self[m] = () => self;
  for (const op of ["insert", "update", "delete", "upsert"]) {
    self[op] = (payload?: unknown) => {
      writes.push({ table, op, payload });
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

const getUser = vi.fn(async () => ({ data: { user: { id: OWNER, email: "owner@example.com" } } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser }, from: (table: string) => chain(table) })) }));

import { createGallery, updateGallery } from "@/lib/actions/galleries";

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  writes.length = 0;
  enqueueOwnerTelegram.mockClear();
});

describe("createGallery with the studio's Pic-Time custom domain", () => {
  it("saves the custom-domain link as given, as status created, and redirects to the gallery", async () => {
    results.photo_galleries = { data: { id: GALLERY }, error: null };
    await expect(createGallery(null, form({ name: "Dalob finals", pictime_url: CUSTOM }))).rejects.toThrow(`NEXT_REDIRECT:/galleries/${GALLERY}`);
    const insert = writes.find((w) => w.table === "photo_galleries" && w.op === "insert");
    expect(insert?.payload).toMatchObject({ owner_id: OWNER, name: "Dalob finals", pictime_url: CUSTOM, status: "created" });
    expect(enqueueOwnerTelegram).toHaveBeenCalledTimes(1);
  });

  it("rejects an http or look-alike link with a message naming both allowed domains and writes nothing", async () => {
    for (const url of ["http://galleries.bluebelt.media/client/dalob", "https://galleries.bluebelt.media.evil.example/client/dalob", "https://photos.example.com/x"]) {
      const out = await createGallery(null, form({ name: "Dalob finals", pictime_url: url }));
      expect(out?.fieldErrors?.pictime_url).toContain("galleries.bluebelt.media");
      expect(out?.fieldErrors?.pictime_url).toContain("pic-time.com");
    }
    expect(writes).toHaveLength(0);
  });

  it("refuses when signed out", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } } as never);
    expect(await createGallery(null, form({ name: "x", pictime_url: CUSTOM }))).toEqual({ error: "You are signed out." });
    expect(writes).toHaveLength(0);
  });
});

describe("updateGallery with the studio's Pic-Time custom domain", () => {
  it("stores the new custom-domain link on an existing gallery and moves pending → created", async () => {
    results.photo_galleries = [
      { data: { id: GALLERY, owner_id: OWNER, name: "Dalob finals", status: "pending", pictime_url: null, pictime_project_id: null, booking_id: null, client_id: null, event_id: null, notes: null, created_in_pictime_at: null, ready_at: null, delivered_at: null, notified_at: null, visitor_count: 0, last_visitor_at: null }, error: null },
      { data: null, error: null, count: 1 },
    ];
    await expect(updateGallery(GALLERY, null, form({ name: "Dalob finals", pictime_url: `${CUSTOM}/2026` }))).rejects.toThrow(`NEXT_REDIRECT:/galleries/${GALLERY}`);
    const update = writes.find((w) => w.table === "photo_galleries" && w.op === "update");
    expect(update?.payload).toMatchObject({ pictime_url: `${CUSTOM}/2026`, status: "created" });
  });

  it("keeps the old link when the new one is a look-alike domain", async () => {
    results.photo_galleries = { data: { id: GALLERY, owner_id: OWNER, name: "Dalob finals", status: "created", pictime_url: CUSTOM }, error: null };
    const out = await updateGallery(GALLERY, null, form({ name: "Dalob finals", pictime_url: "https://galleries.bluebelt.media.evil.example/client/dalob" }));
    expect(out?.fieldErrors?.pictime_url).toBeDefined();
    expect(writes.filter((w) => w.op === "update")).toHaveLength(0);
  });
});
