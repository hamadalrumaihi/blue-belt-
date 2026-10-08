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
const writeAudit = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/audit", () => ({ writeAudit: (...args: unknown[]) => writeAudit(...(args as [])) }));
const enqueueOwnerTelegram = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/notifications/owner", () => ({ enqueueOwnerTelegram: (...args: unknown[]) => enqueueOwnerTelegram(...(args as [])) }));
const enqueueClientEmail = vi.fn(async () => ({ ok: true, queued: true }));
vi.mock("@/lib/notifications/email/outbox", () => ({ enqueueClientEmail: (...args: unknown[]) => enqueueClientEmail(...(args as [])) }));

const OWNER = "11111111-1111-4111-8111-111111111111";
const GALLERY = "22222222-2222-4222-8222-222222222222";
const BOOKING = "33333333-3333-4333-8333-333333333333";
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

import { createGallery, deliverGallery, markGalleryReady, updateGallery } from "@/lib/actions/galleries";

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const auditActions = () => writeAudit.mock.calls.map((c) => (c as unknown as [unknown, { action: string }])[1].action);
const gallery = (overrides: Record<string, unknown> = {}) => ({ id: GALLERY, owner_id: OWNER, name: "Dalob finals", status: "ready", pictime_url: CUSTOM, pictime_project_id: null, booking_id: BOOKING, client_id: null, event_id: null, notes: null, created_in_pictime_at: "2026-10-01T00:00:00.000Z", ready_at: "2026-10-02T00:00:00.000Z", delivered_at: null, notified_at: null, visitor_count: 0, last_visitor_at: null, ...overrides });
const bookingLite = (overrides: Record<string, unknown> = {}) => ({ id: BOOKING, owner_id: OWNER, client_id: null, customer_name: "Test Customer", customer_email: "customer@example.com", athlete_name: "Test Athlete", public_ref: "BB-7K3PQ2", booking_status: "in_progress", event_id: null, quoted_at: null, confirmed_at: "2026-09-01T00:00:00.000Z", delivered_at: null, completed_at: null, cancelled_at: null, gallery_delivered_at: null, balance_state: "not_due", balance_qr: 500, balance_due_at: null, currency: "QAR", ...overrides });

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  writes.length = 0;
  writeAudit.mockClear();
  enqueueOwnerTelegram.mockClear();
  enqueueClientEmail.mockClear();
});

describe("createGallery with the studio's Pic-Time custom domain", () => {
  it("saves the custom-domain link as given, as status created, audits gallery.url_added, tells only the owner and never e-mails the client", async () => {
    results.photo_galleries = { data: { id: GALLERY }, error: null };
    await expect(createGallery(null, form({ name: "Dalob finals", pictime_url: CUSTOM }))).rejects.toThrow(`NEXT_REDIRECT:/galleries/${GALLERY}`);
    const insert = writes.find((w) => w.table === "photo_galleries" && w.op === "insert");
    expect(insert?.payload).toMatchObject({ owner_id: OWNER, name: "Dalob finals", pictime_url: CUSTOM, status: "created" });
    expect(enqueueOwnerTelegram).toHaveBeenCalledTimes(1);
    expect(enqueueClientEmail).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["gallery.created", "gallery.url_added"]);
    // Saving a link never touches the booking's balance.
    expect(writes.filter((w) => w.table === "photo_bookings").map((w) => w.payload as Record<string, unknown>).some((p) => "balance_state" in p || "booking_status" in p)).toBe(false);
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

describe("markGalleryReady", () => {
  it("marks the gallery ready and (opt-in) e-mails the client, but never delivers the booking or makes the balance due", async () => {
    results.photo_galleries = [{ data: gallery({ status: "created", ready_at: null }), error: null }, { data: null, error: null, count: 1 }];
    results.photo_bookings = { data: bookingLite(), error: null };
    const out = await markGalleryReady(GALLERY, { notifyClient: true });
    expect(out).toMatchObject({ ok: true, status: "ready", notified: true });
    expect(writes.filter((w) => w.table === "photo_bookings" && w.op === "update")).toEqual([]);
    const mail = enqueueClientEmail.mock.calls.map((c) => (c as unknown as [unknown, { kind: string; draft: { subject: string; text: string } }])[1])[0];
    expect(mail.kind).toBe("GALLERY_READY");
    expect(mail.draft.subject).toBe("Your private gallery is ready (BB-7K3PQ2)");
    expect(mail.draft.text.toLowerCase()).not.toMatch(/pic-time|pictime|fatoorah/);
    expect(mail.draft.text).not.toContain("—");
    expect(auditActions()).not.toContain("balance.due");
    expect(auditActions()).not.toContain("gallery.delivered");
  });
});

describe("deliverGallery", () => {
  it("is the explicit delivery step: gallery delivered, booking delivered, balance due; no link created, nothing sent by default", async () => {
    results.photo_galleries = [{ data: gallery(), error: null }, { data: null, error: null, count: 1 }];
    results.photo_bookings = [{ data: bookingLite(), error: null }, { data: bookingLite({ booking_status: "delivered", balance_state: "due" }), error: null }];
    const out = await deliverGallery(GALLERY);
    expect(out).toMatchObject({ ok: true, status: "delivered", notified: false, balanceDue: true });
    expect(writes.find((w) => w.table === "photo_galleries" && w.op === "update")?.payload).toMatchObject({ status: "delivered", delivered_at: expect.any(String) });
    const bookingUpdate = writes.find((w) => w.table === "photo_bookings" && w.op === "update")?.payload as Record<string, unknown>;
    expect(bookingUpdate).toMatchObject({ booking_status: "delivered", delivered_at: expect.any(String), gallery_delivered_at: expect.any(String), balance_state: "due", balance_due_at: expect.any(String) });
    expect("deposit_state" in bookingUpdate || "status" in bookingUpdate).toBe(false);
    expect(auditActions()).toEqual(["booking.status", "balance.due", "gallery.delivered", "gallery.delivered"]);
    // The final payment link is never created or sent by delivery.
    expect(writes.some((w) => w.table === "photo_booking_payment_requests")).toBe(false);
    expect(enqueueClientEmail).not.toHaveBeenCalled();
    expect(enqueueOwnerTelegram).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "DELIVERY_SENT", lines: expect.arrayContaining([expect.stringMatching(/Final balance due: 500 QAR/)]) }));
  });

  it("e-mails the client only when asked, and refuses without a link, before confirmation, or twice", async () => {
    results.photo_galleries = [{ data: gallery(), error: null }, { data: null, error: null, count: 1 }];
    results.photo_bookings = [{ data: bookingLite(), error: null }, { data: bookingLite({ booking_status: "delivered", balance_state: "due" }), error: null }];
    expect(await deliverGallery(GALLERY, { notifyClient: true })).toMatchObject({ ok: true, notified: true });
    const mail = enqueueClientEmail.mock.calls.map((c) => (c as unknown as [unknown, { kind: string; draft: { text: string } }])[1])[0];
    expect(mail.kind).toBe("GALLERY_READY");
    expect(mail.draft.text).toMatch(/remaining balance of 500 QAR is now due/);
    expect(mail.draft.text.toLowerCase()).not.toMatch(/pic-time|pictime/);

    writes.length = 0;
    results.photo_galleries = { data: gallery({ pictime_url: null }), error: null };
    expect(await deliverGallery(GALLERY)).toMatchObject({ ok: false, error: expect.stringMatching(/gallery link/i) });
    results.photo_galleries = { data: gallery(), error: null };
    results.photo_bookings = { data: bookingLite({ booking_status: "awaiting_payment" }), error: null };
    expect(await deliverGallery(GALLERY)).toMatchObject({ ok: false, error: expect.stringMatching(/confirm the booking/i) });
    results.photo_galleries = { data: gallery({ status: "delivered", delivered_at: "2026-10-03T00:00:00.000Z" }), error: null };
    expect(await deliverGallery(GALLERY)).toMatchObject({ ok: false, error: expect.stringMatching(/already delivered/i) });
    expect(writes.filter((w) => w.op === "update")).toEqual([]);
  });

  it("a booking without a remaining balance is delivered with nothing owed", async () => {
    results.photo_galleries = [{ data: gallery(), error: null }, { data: null, error: null, count: 1 }];
    results.photo_bookings = [{ data: bookingLite({ balance_qr: 0 }), error: null }, { data: bookingLite({ booking_status: "delivered", balance_state: "waived", balance_qr: 0 }), error: null }];
    expect(await deliverGallery(GALLERY)).toMatchObject({ ok: true, balanceDue: false });
    expect(writes.find((w) => w.table === "photo_bookings" && w.op === "update")?.payload).toMatchObject({ balance_state: "waived" });
    expect(auditActions()).not.toContain("balance.due");
  });
});
