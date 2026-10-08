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

import { assignBookingCoverage, createAthleteFromBooking, createBooking, createPaymentRequest, deleteManualPayment, linkBookingToAthlete, markShootComplete, recordFinalAmount, recordManualPayment, transitionBooking } from "@/lib/actions/bookings";
import { createLogger, setLogSink } from "@/lib/log";
import { isPaymentsEnabled } from "@/lib/payments/config";
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
    expect(await markShootComplete(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await recordFinalAmount(BOOKING_ID, null, fd({ amount_qr: "350" }))).toMatchObject({ error: expect.stringMatching(/signed out/i) });
    vi.mocked(isPaymentsEnabled).mockReturnValue(true);
    expect(await createPaymentRequest(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
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
    expect(await createPaymentRequest("nope")).toMatchObject({ ok: false, error: expect.stringMatching(/invalid booking/i) });
    expect(await markShootComplete("nope")).toMatchObject({ ok: false, error: expect.stringMatching(/invalid booking/i) });
    expect(await recordFinalAmount("nope", null, fd({ amount_qr: "1" }))).toMatchObject({ error: expect.stringMatching(/invalid booking/i) });
    expect(writes).toEqual([]);
  });

  it("createBooking returns field errors before any insert", async () => {
    const out = await createBooking(null, fd({ booking_type: "club" }));
    expect(out).toMatchObject({ fieldErrors: { customer_name: expect.any(String) } });
    expect(writes).toEqual([]);
  });

  it("createPaymentRequest is inert while payments are off", async () => {
    expect(await createPaymentRequest(BOOKING_ID, { notifyClient: true })).toMatchObject({ ok: false, error: expect.stringMatching(/not enabled/i) });
    expect(writes).toEqual([]);
  });
});

const DONE = "2026-10-06T09:00:00.000Z";
const payable = () => booking({ booking_status: "in_progress", coverage_done_at: DONE, amount_qr: 350, status: "pending", provider_invoice_id: null, payment_url: null, metadata: {} });

describe("markShootComplete", () => {
  it("stamps coverage_done_at once and moves a confirmed booking to in_progress through the transition rules", async () => {
    const b = booking({ booking_status: "confirmed", confirmed_at: "2026-10-01T00:00:00.000Z", coverage_done_at: null });
    results.photo_bookings = [
      { data: b, error: null },
      { data: { ...b, booking_status: "in_progress", coverage_done_at: DONE }, error: null },
    ];
    expect(await markShootComplete(BOOKING_ID)).toEqual({ ok: true });
    const update = writes.find((w) => w.table === "photo_bookings" && w.op === "update")?.payload as Record<string, unknown>;
    expect(update).toMatchObject({ booking_status: "in_progress", coverage_done_at: expect.any(String) });
    expect("status" in update || "paid_at" in update || "amount_qr" in update).toBe(false);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "booking.shoot_complete", entityId: BOOKING_ID }));
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "booking.status", data: expect.objectContaining({ from: "confirmed", to: "in_progress" }) }));
    expect(enqueueClientEmail).not.toHaveBeenCalled();
  });

  it("keeps a later stage as it is, is a no-op when already done, and refuses before confirmation or after cancellation", async () => {
    const delivered = booking({ booking_status: "delivered", coverage_done_at: null });
    results.photo_bookings = [{ data: delivered, error: null }, { data: { ...delivered, coverage_done_at: DONE }, error: null }];
    expect(await markShootComplete(BOOKING_ID)).toEqual({ ok: true });
    expect((writes.find((w) => w.op === "update")?.payload as Record<string, unknown>).booking_status).toBeUndefined();

    writes.length = 0;
    results.photo_bookings = { data: booking({ booking_status: "in_progress", coverage_done_at: DONE }), error: null };
    expect(await markShootComplete(BOOKING_ID)).toEqual({ ok: true });
    expect(writes).toEqual([]);

    results.photo_bookings = { data: booking({ booking_status: "inquiry" }), error: null };
    expect(await markShootComplete(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/confirm the booking/i) });
    results.photo_bookings = { data: booking({ booking_status: "cancelled" }), error: null };
    expect(await markShootComplete(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/i) });
    expect(writes).toEqual([]);
  });
});

describe("recordFinalAmount", () => {
  it("validates the amount and note before loading the booking", async () => {
    expect(await recordFinalAmount(BOOKING_ID, null, fd({ amount_qr: "0" }))).toMatchObject({ fieldErrors: { amount_qr: expect.any(String) } });
    expect(await recordFinalAmount(BOOKING_ID, null, fd({ amount_qr: "2000000" }))).toMatchObject({ fieldErrors: { amount_qr: expect.any(String) } });
    expect(await recordFinalAmount(BOOKING_ID, null, fd({ amount_qr: "350", note: "x".repeat(301) }))).toMatchObject({ fieldErrors: { note: expect.any(String) } });
    expect(writes).toEqual([]);
  });

  it("refuses once MyFatoorah has verified a payment; otherwise updates the amount and stamps metadata", async () => {
    results.photo_bookings = { data: booking({ status: "paid" }), error: null };
    expect(await recordFinalAmount(BOOKING_ID, null, fd({ amount_qr: "400" }))).toMatchObject({ error: expect.stringMatching(/already paid/i) });
    expect(writes).toEqual([]);

    const b = payable();
    results.photo_bookings = [{ data: b, error: null }, { data: { ...b, amount_qr: 1200.5 }, error: null }];
    expect(await recordFinalAmount(BOOKING_ID, null, fd({ amount_qr: "1,200.50", note: "Two extra hours" }))).toEqual({ saved: true });
    const update = writes.find((w) => w.table === "photo_bookings" && w.op === "update")?.payload as Record<string, unknown>;
    expect(update).toMatchObject({ amount_qr: 1200.5, currency: "QAR", metadata: expect.objectContaining({ final_amount_recorded_at: expect.any(String), final_amount_note: "Two extra hours", final_amount_previous: 350 }) });
    expect("status" in update || "booking_status" in update).toBe(false);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "booking.final_amount", data: expect.objectContaining({ amount_qr: 1200.5, previous_qr: 350 }) }));
  });
});

describe("createPaymentRequest", () => {
  beforeEach(() => {
    vi.mocked(isPaymentsEnabled).mockReturnValue(true);
  });

  it("refuses before the shoot is complete, without an amount, or once paid; nothing is written or sent", async () => {
    results.photo_bookings = { data: { ...payable(), coverage_done_at: null }, error: null };
    expect(await createPaymentRequest(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/shoot complete/i) });
    results.photo_bookings = { data: { ...payable(), amount_qr: 0 }, error: null };
    expect(await createPaymentRequest(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/final amount/i) });
    results.photo_bookings = { data: { ...payable(), status: "paid" }, error: null };
    expect(await createPaymentRequest(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/already paid/i) });
    results.photo_bookings = { data: { ...payable(), amount_paid_qr: 350, manual_paid_at: DONE }, error: null };
    expect(await createPaymentRequest(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/already paid/i) });
    results.photo_bookings = { data: { ...payable(), booking_status: "inquiry" }, error: null };
    expect(await createPaymentRequest(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/confirm the booking/i) });
    expect(writes).toEqual([]);
    expect(enqueueOwnerTelegram).not.toHaveBeenCalled();
    expect(enqueueClientEmail).not.toHaveBeenCalled();
  });

  it("stores the WEBSITE pay link (token hash in metadata), leaves the lifecycle alone, tells the owner, and e-mails the client only when asked", async () => {
    const b = payable();
    const updated = (payload: Record<string, unknown>) => ({ ...b, ...payload });
    results.photo_bookings = [{ data: b, error: null }, { data: updated({ payment_url: "https://site.test/pay/placeholder" }), error: null }];
    const out = await createPaymentRequest(BOOKING_ID);
    expect(out).toMatchObject({ ok: true, emailQueued: false });
    if (!out.ok) throw new Error("unreachable");
    expect(out.payUrl).toMatch(/^https:\/\/site\.test\/pay\/bbp_[A-Za-z0-9]{40}$/);
    const update = writes.find((w) => w.table === "photo_bookings" && w.op === "update")?.payload as Record<string, unknown>;
    expect(update.payment_url).toBe(out.payUrl);
    expect(update.metadata).toMatchObject({ pay_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/), pay_token_created_at: expect.any(String), payment_requested_at: expect.any(String) });
    expect((update.metadata as Record<string, unknown>).pay_token_hash).not.toContain(out.payUrl.split("/pay/")[1]);
    expect("booking_status" in update || "status" in update || "provider_invoice_id" in update || "amount_qr" in update).toBe(false);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "booking.payment_requested", data: expect.objectContaining({ amount_qr: 350, notify_client: false }) }));
    expect(enqueueOwnerTelegram).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "BOOKING_PAYMENT_REQUESTED", lines: expect.arrayContaining([`Pay: ${out.payUrl}`]) }));
    expect(enqueueClientEmail).not.toHaveBeenCalled();

    // Opt-in e-mail: the PAYMENT_REQUESTED mail goes out with the website link as its button.
    writes.length = 0;
    results.photo_bookings = [{ data: b, error: null }, { data: updated({ payment_url: "https://site.test/pay/bbp_" + "a".repeat(40) }), error: null }];
    const sent = await createPaymentRequest(BOOKING_ID, { notifyClient: true });
    expect(sent).toMatchObject({ ok: true, emailQueued: true });
    const mail = enqueueClientEmail.mock.calls.map((c) => (c as unknown as [unknown, { kind: string; draft: { subject: string; text: string } }])[1])[0];
    expect(mail.kind).toBe("PAYMENT_REQUESTED");
    expect(mail.draft.subject).toMatch(/^Pay online for your booking/);
    expect(mail.draft.text).toContain("https://site.test/pay/bbp_");
    expect(mail.draft.text).not.toContain("\u2014");
  });

  it("keeps an earlier provider URL out of payment_url: it moves to metadata.provider_payment_url", async () => {
    const b = { ...payable(), payment_url: "https://demo.myfatoorah.com/ie/0106230003434", provider_invoice_id: "6409988" };
    results.photo_bookings = [{ data: b, error: null }, { data: b, error: null }];
    const out = await createPaymentRequest(BOOKING_ID);
    expect(out.ok).toBe(true);
    const update = writes.find((w) => w.table === "photo_bookings" && w.op === "update")?.payload as Record<string, unknown>;
    expect(update.payment_url).toMatch(/^https:\/\/site\.test\/pay\//);
    expect((update.metadata as Record<string, unknown>).provider_payment_url).toBe("https://demo.myfatoorah.com/ie/0106230003434");
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
