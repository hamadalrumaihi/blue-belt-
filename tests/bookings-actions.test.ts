import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(), isServiceClientConfigured: () => false }));
vi.mock("@/lib/studio/queries", () => ({ loadStudio: vi.fn(async () => null), siteUrl: () => "https://site.test", DEFAULT_STUDIO: { business_name: "Blue Belt Media" }, listServices: vi.fn(async () => []) }));
vi.mock("@/lib/payments/config", () => ({ isPaymentsEnabled: vi.fn(() => false), getPaymentsConfig: vi.fn(() => ({ enabled: false, apiKey: "", webhookSecret: "", baseUrl: "https://apitest.myfatoorah.com" })) }));

const writeAudit = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/audit", () => ({ writeAudit: (...args: unknown[]) => writeAudit(...(args as [])) }));
const enqueueOwnerTelegram = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/notifications/owner", () => ({ enqueueOwnerTelegram: (...args: unknown[]) => enqueueOwnerTelegram(...(args as [])) }));
const enqueueClientEmail = vi.fn(async () => ({ ok: true, queued: true }));
vi.mock("@/lib/notifications/email/outbox", () => ({ enqueueClientEmail: (...args: unknown[]) => enqueueClientEmail(...(args as [])) }));

/**
 * Hand-rolled Supabase stand-in: every builder method returns the chain and
 * awaiting it yields the canned result for that table (first select) — enough
 * to test guards. Writes are recorded so tests can assert what was touched.
 */
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };
const results: Record<string, Result | Result[]> = {};
const writes: Array<{ table: string; op: string; payload?: unknown }> = [];

function chain(table: string) {
  const self: Record<string, unknown> = {};
  const methods = ["select", "eq", "neq", "in", "is", "order", "limit", "gte", "lte", "gt", "lt", "not", "or", "maybeSingle", "single"];
  for (const m of methods) self[m] = () => self;
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

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser }, from: (table: string) => chain(table) })) }));

import { assignBookingCoverage, createAthleteFromBooking, createBooking, deleteManualPayment, linkBookingToAthlete, recordManualPayment, requestBookingInvoice, transitionBooking } from "@/lib/actions/bookings";
import { createLogger, setLogSink } from "@/lib/log";
import { processWebhook, type WebhookDeps } from "@/lib/payments/myfatoorah/webhook";
import { FakeSupabase } from "./payments/fake-supabase";
import { BOOKING_ID, booking, paymentEvent } from "./payments/fixtures";

setLogSink(() => {});

const USER = "11111111-1111-4111-8111-111111111111";
const ATH = "22222222-2222-4222-8222-222222222222";
const REC = "55555555-5555-4555-8555-555555555555";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  writes.length = 0;
  writeAudit.mockClear();
  enqueueOwnerTelegram.mockClear();
  enqueueClientEmail.mockClear();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } } });
});

describe("signed out", () => {
  it("every action refuses before touching the database", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await createBooking(null, fd({ booking_type: "club", customer_name: "A" }))).toMatchObject({ error: expect.stringMatching(/signed out/i) });
    expect(await transitionBooking(BOOKING_ID, "confirmed")).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await recordManualPayment(BOOKING_ID, null, fd({ method: "cash", amount_qr: "10" }))).toMatchObject({ error: expect.stringMatching(/signed out/i) });
    expect(await deleteManualPayment(REC)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await assignBookingCoverage(BOOKING_ID, { photographerId: null })).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await linkBookingToAthlete(BOOKING_ID, ATH)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await createAthleteFromBooking(BOOKING_ID, null, fd({}))).toMatchObject({ error: expect.stringMatching(/signed out/i) });
    expect(writes).toEqual([]);
  });
});

describe("input guards", () => {
  it("rejects malformed ids and unknown statuses without a query", async () => {
    expect(await transitionBooking("nope", "confirmed")).toMatchObject({ ok: false, error: expect.stringMatching(/invalid booking/i) });
    expect(await transitionBooking(BOOKING_ID, "paid")).toMatchObject({ ok: false, error: expect.stringMatching(/unknown booking status/i) });
    expect(await recordManualPayment("nope", null, fd({}))).toMatchObject({ error: expect.stringMatching(/invalid booking/i) });
    expect(await deleteManualPayment("nope")).toMatchObject({ ok: false });
    expect(await assignBookingCoverage(BOOKING_ID, { photographerId: "not-a-uuid" })).toMatchObject({ ok: false, error: expect.stringMatching(/assignee/i) });
    expect(await linkBookingToAthlete(BOOKING_ID, "nope")).toMatchObject({ ok: false, error: expect.stringMatching(/athlete/i) });
    expect(await createAthleteFromBooking("nope", null, fd({}))).toMatchObject({ error: expect.stringMatching(/invalid booking/i) });
    expect(await requestBookingInvoice("nope")).toMatchObject({ ok: false, error: expect.stringMatching(/invalid booking/i) });
    expect(writes).toEqual([]);
  });

  it("createBooking returns field errors before any insert", async () => {
    const out = await createBooking(null, fd({ booking_type: "club" }));
    expect(out).toMatchObject({ fieldErrors: { customer_name: expect.any(String) } });
    expect(writes).toEqual([]);
  });

  it("requestBookingInvoice is inert while payments are off", async () => {
    expect(await requestBookingInvoice(BOOKING_ID, true)).toMatchObject({ ok: false, error: expect.stringMatching(/not enabled/i) });
    expect(writes).toEqual([]);
  });
});

describe("recordManualPayment", () => {
  it("refuses once MyFatoorah has verified the booking as paid — nothing is written", async () => {
    results.photo_bookings = { data: booking({ status: "paid" }), error: null };
    const out = await recordManualPayment(BOOKING_ID, null, fd({ method: "cash", amount_qr: "350" }));
    expect(out).toEqual({ error: "Already paid through MyFatoorah." });
    expect(writes).toEqual([]);
    expect(writeAudit).not.toHaveBeenCalled();
    expect(enqueueOwnerTelegram).not.toHaveBeenCalled();
  });

  it("validates the sheet before loading the booking", async () => {
    const out = await recordManualPayment(BOOKING_ID, null, fd({ method: "myfatoorah", amount_qr: "0" }));
    expect(out).toMatchObject({ fieldErrors: { method: expect.any(String), amount_qr: expect.any(String) } });
    expect(writes).toEqual([]);
  });

  it("records the payment, refreshes the manual summary and never writes the provider status", async () => {
    const b = booking({ status: "pending", booking_status: "awaiting_payment", amount_qr: 350 });
    results.photo_bookings = [
      { data: b, error: null }, // ownedBooking
      { data: { ...b, amount_paid_qr: 350, manual_paid_at: "2026-10-06T09:00:00.000Z", payment_method: "cash" }, error: null }, // summary refresh
      { data: { ...b, amount_paid_qr: 350, booking_status: "confirmed", confirmed_at: "2026-10-06T09:00:00.000Z" }, error: null }, // confirm transition
    ];
    results.photo_payment_records = [
      { data: { id: REC, kind: "manual", method: "cash", amount_qr: 350 }, error: null }, // insert
      { data: [{ amount_qr: 350, paid_at: "2026-10-06T09:00:00.000Z" }], error: null }, // sum
    ];
    const out = await recordManualPayment(BOOKING_ID, null, fd({ method: "cash", amount_qr: "350", paid_at: "2026-10-06" }));
    expect(out).toEqual({ saved: true });
    const insert = writes.find((w) => w.table === "photo_payment_records" && w.op === "insert");
    expect(insert?.payload).toMatchObject({ booking_id: BOOKING_ID, kind: "manual", method: "cash", amount_qr: 350, recorded_by: USER, owner_id: USER });
    const bookingUpdates = writes.filter((w) => w.table === "photo_bookings" && w.op === "update").map((w) => w.payload as Record<string, unknown>);
    expect(bookingUpdates.some((p) => "status" in p || "paid_at" in p)).toBe(false);
    expect(bookingUpdates[0]).toMatchObject({ amount_paid_qr: 350, payment_method: "cash" });
    expect(bookingUpdates[1]).toMatchObject({ booking_status: "confirmed" });
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "payment.manual", entityId: BOOKING_ID, data: expect.objectContaining({ method: "cash", amount_qr: 350 }) }));
    expect(enqueueOwnerTelegram).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "BOOKING_PAID", alertKey: `booking:${BOOKING_ID}:manual:${REC}` }));
    expect(enqueueClientEmail.mock.calls.map((c) => (c as unknown as [unknown, { kind: string }])[1].kind)).toEqual(["PAYMENT_RECEIVED", "BOOKING_CONFIRMED"]);
    expect(writes.some((w) => w.table === "photo_athletes")).toBe(false);
  });
});

describe("tracked athletes are explicit", () => {
  it("createAthleteFromBooking inserts only when the owner submits a valid form for the booking's event", async () => {
    const EV = "33333333-3333-4333-8333-333333333333";
    results.photo_bookings = [{ data: booking({ event_id: EV }), error: null }];
    results.photo_events = { data: { owner_id: USER }, error: null };
    results.photo_athletes = { data: { id: ATH }, error: null };
    // Wrong event → refused before any insert.
    const wrong = await createAthleteFromBooking(BOOKING_ID, null, fd({ name: "Sara", event_id: "44444444-4444-4444-8444-444444444444", platform: "OTHER" }));
    expect(wrong).toMatchObject({ fieldErrors: { event_id: expect.stringMatching(/booking's event/i) } });
    expect(writes.filter((w) => w.table === "photo_athletes")).toEqual([]);

    results.photo_bookings = [{ data: booking({ event_id: EV }), error: null }, { data: null, error: null }];
    await expect(createAthleteFromBooking(BOOKING_ID, null, fd({ name: "Sara", event_id: EV, platform: "OTHER" }))).rejects.toThrow(`NEXT_REDIRECT:/bookings/${BOOKING_ID}`);
    const insert = writes.find((w) => w.table === "photo_athletes" && w.op === "insert");
    expect(insert?.payload).toMatchObject({ name: "Sara", event_id: EV, owner_id: USER });
    expect(writes.find((w) => w.table === "photo_bookings" && w.op === "update")?.payload).toMatchObject({ watcher_athlete_id: ATH });
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "booking.athlete_created" }));
  });

  it("linkBookingToAthlete refuses an athlete from another event", async () => {
    results.photo_bookings = { data: booking({ event_id: "33333333-3333-4333-8333-333333333333" }), error: null };
    results.photo_athletes = { data: { owner_id: USER, event_id: "44444444-4444-4444-8444-444444444444" }, error: null };
    expect(await linkBookingToAthlete(BOOKING_ID, ATH)).toMatchObject({ ok: false, error: expect.stringMatching(/different event/i) });
    expect(writes.filter((w) => w.op === "update")).toEqual([]);
  });

  it("the webhook's paid path confirms the lifecycle, mirrors the payment and queues client mail — and inserts NO athlete", async () => {
    const db = new FakeSupabase();
    db.seed("photo_bookings", [booking({ booking_status: "awaiting_payment" })]);
    let t = Date.parse("2026-10-06T12:00:00.000Z");
    const deps: WebhookDeps = { supabase: db.asClient(), now: () => new Date((t += 1000)), log: createLogger({ test: true }) };
    const out = await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(out.result).toBe("processed");
    const row = db.tables.photo_bookings.find((b) => b.id === BOOKING_ID)!;
    expect(row).toMatchObject({ status: "paid", booking_status: "confirmed" });
    expect(row.confirmed_at).toBeTruthy();
    expect(row.watcher_athlete_id).toBeNull();
    expect(db.tables.photo_athletes).toHaveLength(0);
    expect(db.tables.photo_payment_records).toEqual([expect.objectContaining({ booking_id: BOOKING_ID, kind: "provider", method: "myfatoorah", amount_qr: 350, provider: "MYFATOORAH", owner_id: row.owner_id })]);
    // The outbox is mocked in this file (the real path is covered in tests/payments): assert what was queued.
    const queued = enqueueClientEmail.mock.calls.map((c) => (c as unknown as [unknown, { kind: string; alertKey: string; ownerId: string }])[1]);
    expect(queued.map((q) => q.alertKey).sort()).toEqual([`email:booking:${BOOKING_ID}:confirmed`, `email:booking:${BOOKING_ID}:paid`]);
    expect(queued.every((q) => q.ownerId === row.owner_id)).toBe(true);

    // A second verified payment event for the same invoice is a duplicate: no second record, no second mail.
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(db.tables.photo_payment_records).toHaveLength(1);
    expect(enqueueClientEmail).toHaveBeenCalledTimes(2);
    expect(db.tables.photo_athletes).toHaveLength(0);
  });

  it("the webhook leaves a later lifecycle stage alone and sends only the payment mail", async () => {
    const db = new FakeSupabase();
    db.seed("photo_bookings", [booking({ booking_status: "in_progress", confirmed_at: "2026-10-01T00:00:00.000Z" })]);
    const deps: WebhookDeps = { supabase: db.asClient(), now: () => new Date("2026-10-06T12:00:00.000Z"), log: createLogger({ test: true }) };
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    const row = db.tables.photo_bookings.find((b) => b.id === BOOKING_ID)!;
    expect(row).toMatchObject({ status: "paid", booking_status: "in_progress", confirmed_at: "2026-10-01T00:00:00.000Z" });
    expect(enqueueClientEmail.mock.calls.map((c) => (c as unknown as [unknown, { alertKey: string }])[1].alertKey)).toEqual([`email:booking:${BOOKING_ID}:paid`]);
    expect(db.tables.photo_athletes).toHaveLength(0);
  });
});
