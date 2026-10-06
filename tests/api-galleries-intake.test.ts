import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ isServiceClientConfigured: vi.fn(() => true), createServiceClient: vi.fn() }));
vi.mock("@/lib/capture/credential-store", () => ({ findCredentialByToken: vi.fn(), touchCredential: vi.fn(async () => undefined), recordHeartbeat: vi.fn() }));

import { POST } from "@/app/api/galleries/intake/route";
import { findCredentialByToken, touchCredential } from "@/lib/capture/credential-store";
import { generateCaptureToken } from "@/lib/capture/credentials";
import { resetRateLimits } from "@/lib/rate-limit";
import type { PhotoCaptureCredentialRow } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";

const findMock = vi.mocked(findCredentialByToken);
const serviceMock = vi.mocked(createServiceClient);
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const { token: TOKEN } = generateCaptureToken("orders");

function credential(kind: "orders" | "capture" = "orders"): PhotoCaptureCredentialRow {
  return { id: "cred-1", owner_id: OWNER, name: "Zapier", kind, token_hash: "h", token_prefix: "bbmo_xxxxxxxx", scope_source_keys: null, scope_event_id: null, expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null, last_used_at: null, use_count: 0, last_heartbeat_at: null, agent_version: null, agent_status: {}, created_at: "2026-03-01T00:00:00.000Z", updated_at: "2026-03-01T00:00:00.000Z" };
}

type Row = Record<string, unknown>;

/** In-memory service client: eq filters, limit/single/maybeSingle terminals, insert/update/upsert, thenable. */
function fakeService(seed: { galleries?: Row[]; studio?: Row[] } = {}) {
  const tables: Record<string, Row[]> = { photo_galleries: seed.galleries ?? [], photo_studio: seed.studio ?? [], photo_notification_deliveries: [] };
  const writes: Array<{ table: string; op: string; payload: Row; filters: Array<[string, unknown]> }> = [];
  let nextId = 1;
  function from(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const filters: Array<[string, unknown]> = [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row | null = null;
    const matched = () => rows.filter((r) => filters.every(([c, v]) => r[c] === v));
    const run = () => {
      if (op === "insert") {
        const row = { id: `gal-${nextId++}`, visitor_count: 0, ...payload };
        rows.push(row);
        writes.push({ table, op, payload: payload as Row, filters });
        return [row];
      }
      if (op === "update") {
        const m = matched();
        for (const r of m) Object.assign(r, payload);
        writes.push({ table, op, payload: payload as Row, filters });
        return m;
      }
      if (op === "upsert") {
        const p = payload as Row;
        if (!rows.some((r) => r.owner_id === p.owner_id && r.alert_key === p.alert_key)) rows.push({ id: nextId++, ...p });
        writes.push({ table, op, payload: p, filters });
        return [];
      }
      return matched();
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Row) => ((op = "insert"), (payload = p), b),
      update: (p: Row) => ((op = "update"), (payload = p), b),
      upsert: (p: Row) => ((op = "upsert"), (payload = p), b),
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      limit: async (n: number) => ({ data: run().slice(0, n), error: null }),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const r = run()[0];
        return r ? { data: r, error: null } : { data: null, error: { message: "no row" } };
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const out = run();
        return Promise.resolve({ data: op === "select" ? out : null, error: null }).then(res, rej);
      },
    };
    return b;
  }
  return { client: { from }, tables, writes };
}

function post(body: unknown, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
  if (auth) headers.authorization = auth;
  return POST(new Request("http://localhost/api/galleries/intake", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers }));
}

const gallery = (over: Row = {}): Row => ({ id: "gal-doha", owner_id: OWNER, name: "Doha Open 2026", status: "created", pictime_url: "https://bb.pic-time.com/doha", pictime_project_id: null, visitor_count: 2, booking_id: null, ready_at: null, created_in_pictime_at: "2026-09-30T00:00:00.000Z", ...over });

let fake: ReturnType<typeof fakeService>;
beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("ORDERS_INTAKE_ENABLED", "1");
  fake = fakeService({ galleries: [gallery(), gallery({ id: "gal-other", owner_id: OTHER, name: "Doha Open 2026", status: "created" })] });
  serviceMock.mockReturnValue(fake.client as never);
  findMock.mockReset();
  findMock.mockResolvedValue({ ok: true, credential: credential() });
  vi.mocked(touchCredential).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

const invite = { event: "gallery_invite_sent", gallery: { name: "Doha Open 2026" }, client: { email: "fatima@example.com" } };

describe("POST /api/galleries/intake", () => {
  it("is 404 while the orders intake flag is off", async () => {
    vi.stubEnv("ORDERS_INTAKE_ENABLED", "0");
    expect((await post(invite)).status).toBe(404);
    expect(fake.writes).toHaveLength(0);
  });

  it("needs a bbmo_ credential: 401 without one, 403 for a capture credential", async () => {
    const missing = await post(invite, null);
    expect(missing.status).toBe(401);
    expect((await missing.json()).error).toContain("bbmo_");
    findMock.mockResolvedValueOnce({ ok: true, credential: credential("capture") });
    const wrong = await post(invite);
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ code: "WRONG_CREDENTIAL_KIND" });
    expect(fake.writes).toHaveLength(0);
  });

  it("refuses malformed JSON and unknown events", async () => {
    expect((await post("{nope")).status).toBe(400);
    const bad = await post({ event: "order_placed", galleryName: "Doha Open 2026" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "INVALID_EVENT" });
  });

  it("an invite marks the owner's matching gallery ready (no client e-mail) and queues a GALLERY_READY Telegram", async () => {
    const res = await post(invite);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, galleryId: "gal-doha", action: "ready", matched: true });
    const row = fake.tables.photo_galleries.find((g) => g.id === "gal-doha")!;
    expect(row.status).toBe("ready");
    expect(typeof row.ready_at).toBe("string");
    // The other owner's gallery with the same name is untouched.
    expect(fake.tables.photo_galleries.find((g) => g.id === "gal-other")!.status).toBe("created");
    const deliveries = fake.tables.photo_notification_deliveries;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ owner_id: OWNER, channel: "telegram", kind: "GALLERY_READY", alert_key: "gallery:gal-doha:ready", category: "delivery" });
    expect(String((deliveries[0].payload as Row).text)).toContain("(Pic-Time invite sent)");
    expect(fake.writes.some((w) => w.table === "photo_notification_deliveries" && (w.payload.channel as string) === "email")).toBe(false);
    expect(touchCredential).toHaveBeenCalledTimes(1);

    // Already ready: a replayed invite is a no-op.
    const again = await post(invite);
    expect(await again.json()).toMatchObject({ action: "noop", matched: true });
    expect(fake.tables.photo_notification_deliveries).toHaveLength(1);
  });

  it("a visitor increments the counter and stamps last_visitor_at; matching by project id wins over name", async () => {
    fake.tables.photo_galleries.push(gallery({ id: "gal-pid", name: "Something else", pictime_project_id: "P-9", visitor_count: 0 }));
    const res = await post({ type: "New Gallery Visitor", galleryName: "Doha Open 2026", galleryId: "P-9", visitorEmail: "v@example.com", visitedAt: "2026-10-02T08:00:00Z" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ galleryId: "gal-pid", action: "visitor", matched: true });
    const row = fake.tables.photo_galleries.find((g) => g.id === "gal-pid")!;
    expect(row.visitor_count).toBe(1);
    expect(row.last_visitor_at).toBe("2026-10-02T08:00:00.000Z");
    expect(fake.tables.photo_galleries.find((g) => g.id === "gal-doha")!.visitor_count).toBe(2);
  });

  it("an unknown gallery is acknowledged with matched:false and nothing is written", async () => {
    const res = await post({ event: "gallery_visitor", galleryName: "Never heard of it" });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, matched: false, galleryId: null, action: "ignored" });
    expect(fake.writes).toHaveLength(0);
    expect(fake.tables.photo_galleries).toHaveLength(2);
  });

  it("gallery_created makes a row as the credential's owner, or fills the link/project id of an existing one", async () => {
    const created = await post({ event: "gallery_created", galleryName: "Club Shoot", galleryUrl: "https://bb.pic-time.com/club", galleryId: "P-2" });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toMatchObject({ action: "created", matched: false });
    const row = fake.tables.photo_galleries.find((g) => g.id === body.galleryId)!;
    expect(row).toMatchObject({ owner_id: OWNER, name: "Club Shoot", status: "created", pictime_url: "https://bb.pic-time.com/club", pictime_project_id: "P-2" });

    // A non-allow-listed link is dropped, not stored.
    const filled = await post({ event: "gallery_created", galleryName: "Doha Open 2026", galleryUrl: "https://evil.example/x", galleryId: "P-doha" });
    expect(filled.status).toBe(200);
    expect(await filled.json()).toMatchObject({ galleryId: "gal-doha", action: "filled", matched: true });
    const doha = fake.tables.photo_galleries.find((g) => g.id === "gal-doha")!;
    expect(doha.pictime_url).toBe("https://bb.pic-time.com/doha");
    expect(doha.pictime_project_id).toBe("P-doha");
  });

  it("honours the studio's extra gallery hosts and never takes an owner id from the body", async () => {
    fake.tables.photo_studio.push({ owner_id: OWNER, settings: { galleryHosts: ["gallery.bluebelt.qa"] } });
    const res = await post({ event: "gallery_created", galleryName: "Custom domain", galleryUrl: "https://gallery.bluebelt.qa/x", ownerId: OTHER, owner_id: OTHER });
    expect(res.status).toBe(201);
    const row = fake.tables.photo_galleries.at(-1)!;
    expect(row).toMatchObject({ owner_id: OWNER, pictime_url: "https://gallery.bluebelt.qa/x" });
  });
});
