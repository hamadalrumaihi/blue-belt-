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
 * awaiting it yields the canned result for that table (in call order). Enough
 * to test guards and what was written. Writes are recorded so tests can
 * assert what was touched.
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

import { approveQuote, assignBookingCoverage, createAthleteFromBooking, createBooking, createPaymentRequest, deleteManualPayment, linkBookingToAthlete, markShootComplete, recordFinalAmount, recordManualPayment, regenerateStagePayment, requestStagePayment, sendStagePaymentRequest, setBookingPrice, transitionBooking } from "@/lib/actions/bookings";
import { createLogger, setLogSink } from "@/lib/log";
import { isPaymentsEnabled } from "@/lib/payments/config";
import { processWebhook, type WebhookDeps } from "@/lib/payments/myfatoorah/webhook";
import { PAYMENTS_NOT_CONFIGURED_MESSAGE } from "@/lib/payments/requests";
import { FakeSupabase } from "./payments/fake-supabase";
import { BOOKING_ID, booking, paymentEvent } from "./payments/fixtures";

setLogSink(() => {});

const USER = "11111111-1111-4111-8111-111111111111";
const ATH = "22222222-2222-4222-8222-222222222222";
const REC = "55555555-5555-4555-8555-555555555555";
const REQ = "66666666-6666-4666-8666-666666666666";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const updates = (table: string) => writes.filter((w) => w.table === table && w.op === "update").map((w) => w.payload as Record<string, unknown>);
const auditActions = () => writeAudit.mock.calls.map((c) => (c as unknown as [unknown, { action: string }])[1].action);

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  writes.length = 0;
  writeAudit.mockClear();
  enqueueOwnerTelegram.mockClear();
  enqueueClientEmail.mockClear();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } } });
});

/** QAR 1000 booking, agreement required and signed, deposit 500 pending. */
const signed = (overrides: Parameters<typeof booking>[0] = {}) => booking({ amount_qr: 1000, deposit_qr: 500, balance_qr: 500, deposit_state: "pending", balance_state: "not_due", requires_contract: true, contract_state: "signed", booking_status: "awaiting_payment", provider_invoice_id: null, payment_url: null, status: "pending", ...overrides });
const pendingRequest = (overrides: Record<string, unknown> = {}) => ({ id: REQ, owner_id: USER, booking_id: BOOKING_ID, stage: "deposit", amount_qr: 500, currency: "QAR", provider: "WEBSITE", provider_invoice_id: null, provider_payment_id: null, provider_reference: null, payment_url: "https://site.test/pay/bbp_" + "a".repeat(40), status: "pending", idempotency_key: "k", generation: 1, pay_token_hash: "h", error_code: null, error_message: null, metadata: {}, created_at: "2026-10-08T09:00:00.000Z", sent_at: null, paid_at: null, failed_at: null, cancelled_at: null, expired_at: null, updated_at: "2026-10-08T09:00:00.000Z", ...overrides });

describe("signed out", () => {
  it("every action refuses before touching the database", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await createBooking(null, fd({ booking_type: "club", customer_name: "A" }))).toMatchObject({ error: expect.stringMatching(/signed out/i) });
    expect(await transitionBooking(BOOKING_ID, "confirmed")).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await recordManualPayment(BOOKING_ID, null, fd({ method: "cash", amount_qr: "10", stage: "deposit" }))).toMatchObject({ error: expect.stringMatching(/signed out/i) });
    expect(await deleteManualPayment(REC)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await assignBookingCoverage(BOOKING_ID, { photographerId: null })).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await linkBookingToAthlete(BOOKING_ID, ATH)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await createAthleteFromBooking(BOOKING_ID, null, fd({}))).toMatchObject({ error: expect.stringMatching(/signed out/i) });
    expect(await markShootComplete(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await setBookingPrice(BOOKING_ID, null, fd({ amount_qr: "350" }))).toMatchObject({ error: expect.stringMatching(/signed out/i) });
    expect(await recordFinalAmount(BOOKING_ID, null, fd({ amount_qr: "350" }))).toMatchObject({ error: expect.stringMatching(/signed out/i) });
    expect(await approveQuote(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await requestStagePayment(BOOKING_ID, "deposit")).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await regenerateStagePayment(BOOKING_ID, "deposit")).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await sendStagePaymentRequest(BOOKING_ID, REQ)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    vi.mocked(isPaymentsEnabled).mockReturnValue(true);
    expect(await createPaymentRequest(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(writes).toEqual([]);
  });
});

describe("input guards", () => {
  it("rejects malformed ids, unknown statuses and unknown stages without a query", async () => {
    expect(await transitionBooking("nope", "confirmed")).toMatchObject({ ok: false, error: expect.stringMatching(/invalid booking/i) });
    expect(await transitionBooking(BOOKING_ID, "paid")).toMatchObject({ ok: false, error: expect.stringMatching(/unknown booking status/i) });
    expect(await recordManualPayment("nope", null, fd({}))).toMatchObject({ error: expect.stringMatching(/invalid booking/i) });
    expect(await deleteManualPayment("nope")).toMatchObject({ ok: false });
    expect(await assignBookingCoverage(BOOKING_ID, { photographerId: "not-a-uuid" })).toMatchObject({ ok: false, error: expect.stringMatching(/assignee/i) });
    expect(await linkBookingToAthlete(BOOKING_ID, "nope")).toMatchObject({ ok: false, error: expect.stringMatching(/athlete/i) });
    expect(await createAthleteFromBooking("nope", null, fd({}))).toMatchObject({ error: expect.stringMatching(/invalid booking/i) });
    expect(await createPaymentRequest("nope")).toMatchObject({ ok: false, error: expect.stringMatching(/invalid booking/i) });
    expect(await requestStagePayment(BOOKING_ID, "tip")).toMatchObject({ ok: false, error: expect.stringMatching(/unknown payment stage/i) });
    expect(await markShootComplete("nope")).toMatchObject({ ok: false, error: expect.stringMatching(/invalid booking/i) });
    expect(await setBookingPrice("nope", null, fd({ amount_qr: "1" }))).toMatchObject({ error: expect.stringMatching(/invalid booking/i) });
    expect(writes).toEqual([]);
  });

  it("createBooking returns field errors before any insert", async () => {
    const out = await createBooking(null, fd({ booking_type: "club" }));
    expect(out).toMatchObject({ fieldErrors: { customer_name: expect.any(String) } });
    expect(writes).toEqual([]);
  });

  it("createPaymentRequest (legacy entry point) is inert while payments are off", async () => {
    expect(await createPaymentRequest(BOOKING_ID, { notifyClient: true })).toMatchObject({ ok: false, error: expect.stringMatching(/not enabled/i) });
    expect(writes).toEqual([]);
  });
});

const DONE = "2026-10-06T09:00:00.000Z";

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
    expect("status" in update || "paid_at" in update || "amount_qr" in update || "balance_state" in update).toBe(false);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "booking.shoot_complete", entityId: BOOKING_ID }));
    expect(enqueueClientEmail).not.toHaveBeenCalled();
  });

  it("is a no-op when already done, and refuses before confirmation or after cancellation", async () => {
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

describe("setBookingPrice", () => {
  it("validates the amount and note before loading the booking", async () => {
    expect(await setBookingPrice(BOOKING_ID, null, fd({ amount_qr: "0" }))).toMatchObject({ fieldErrors: { amount_qr: expect.any(String) } });
    expect(await setBookingPrice(BOOKING_ID, null, fd({ amount_qr: "2000000" }))).toMatchObject({ fieldErrors: { amount_qr: expect.any(String) } });
    expect(await setBookingPrice(BOOKING_ID, null, fd({ amount_qr: "350", note: "x".repeat(301) }))).toMatchObject({ fieldErrors: { note: expect.any(String) } });
    expect(writes).toEqual([]);
  });

  it("QAR 1000 is split on the server into a 500 deposit and a 500 balance; audit booking.price_set; an inquiry stays an inquiry", async () => {
    const b = booking({ booking_status: "inquiry", amount_qr: 0, deposit_qr: 0, balance_qr: 0, deposit_state: "not_required", requires_contract: true, contract_state: "required" });
    results.photo_bookings = [{ data: b, error: null }, { data: { ...b, amount_qr: 1000, deposit_qr: 500, balance_qr: 500, deposit_state: "pending" }, error: null }];
    expect(await setBookingPrice(BOOKING_ID, null, fd({ amount_qr: "1,000", note: "Two extra hours" }))).toEqual({ saved: true });
    const update = updates("photo_bookings")[0];
    expect(update).toMatchObject({ amount_qr: 1000, currency: "QAR", deposit_percent: 50, deposit_qr: 500, balance_qr: 500, deposit_state: "pending", metadata: expect.objectContaining({ final_amount_note: "Two extra hours", final_amount_previous: 0 }) });
    expect("status" in update || "booking_status" in update).toBe(false);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "booking.price_set", data: expect.objectContaining({ amount_qr: 1000, deposit_qr: 500, balance_qr: 500 }) }));
    expect(updates("photo_bookings")).toHaveLength(1);
    expect(enqueueClientEmail).not.toHaveBeenCalled();
  });

  it("after the deposit is paid the deposit never changes: only the balance follows the new total, and the total cannot drop below the deposit", async () => {
    const b = signed({ deposit_state: "paid", deposit_paid_at: DONE, booking_status: "confirmed" });
    results.photo_bookings = [{ data: b, error: null }, { data: { ...b, amount_qr: 1200, balance_qr: 700 }, error: null }, { data: { ...b, amount_qr: 1200, balance_qr: 700 }, error: null }, { data: { ...b, amount_qr: 1200, balance_qr: 700 }, error: null }];
    expect(await setBookingPrice(BOOKING_ID, null, fd({ amount_qr: "1200" }))).toEqual({ saved: true });
    const update = updates("photo_bookings")[0];
    expect(update).toMatchObject({ amount_qr: 1200, balance_qr: 700 });
    expect("deposit_qr" in update || "deposit_state" in update).toBe(false);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "booking.price_set", data: expect.objectContaining({ deposit_locked: true, balance_qr: 700 }) }));

    writes.length = 0;
    results.photo_bookings = { data: b, error: null };
    expect(await setBookingPrice(BOOKING_ID, null, fd({ amount_qr: "400" }))).toMatchObject({ fieldErrors: { amount_qr: expect.stringMatching(/deposit already paid/i) } });
    expect(writes).toEqual([]);
  });

  it("refuses once paid in full, refunded, cancelled or completed", async () => {
    results.photo_bookings = { data: signed({ deposit_state: "paid", balance_state: "paid", booking_status: "delivered" }), error: null };
    expect(await setBookingPrice(BOOKING_ID, null, fd({ amount_qr: "400" }))).toMatchObject({ error: expect.stringMatching(/paid in full/i) });
    results.photo_bookings = { data: signed({ status: "refunded" }), error: null };
    expect(await setBookingPrice(BOOKING_ID, null, fd({ amount_qr: "400" }))).toMatchObject({ error: expect.stringMatching(/refunded/i) });
    results.photo_bookings = { data: signed({ booking_status: "completed" }), error: null };
    expect(await setBookingPrice(BOOKING_ID, null, fd({ amount_qr: "400" }))).toMatchObject({ error: expect.stringMatching(/completed/i) });
    expect(writes).toEqual([]);
  });
});

describe("approveQuote", () => {
  it("moves an inquiry to quoted, audits booking.quote_approved and lets the gates pick the waiting stage; nothing is sent", async () => {
    const b = signed({ booking_status: "inquiry", contract_state: "required" });
    const quoted = { ...b, booking_status: "quoted", quoted_at: DONE };
    results.photo_bookings = [{ data: b, error: null }, { data: quoted, error: null }, { data: quoted, error: null }, { data: null, error: null }, { data: { ...quoted, booking_status: "awaiting_contract" }, error: null }];
    expect(await approveQuote(BOOKING_ID)).toEqual({ ok: true });
    expect(updates("photo_bookings")[0]).toMatchObject({ booking_status: "quoted", quoted_at: expect.any(String) });
    expect(updates("photo_bookings")[1]).toMatchObject({ booking_status: "awaiting_contract" });
    expect(auditActions()).toEqual(["booking.quote_approved", "booking.status"]);
    expect(enqueueClientEmail).not.toHaveBeenCalled();
    expect(enqueueOwnerTelegram).not.toHaveBeenCalled();
  });

  it("refuses without a price or outside the inquiry stage", async () => {
    results.photo_bookings = { data: signed({ booking_status: "inquiry", amount_qr: 0, deposit_qr: 0 }), error: null };
    expect(await approveQuote(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/set the price/i) });
    results.photo_bookings = { data: signed({ booking_status: "quoted" }), error: null };
    expect(await approveQuote(BOOKING_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/already/i) });
    expect(writes).toEqual([]);
  });
});

describe("transitionBooking and the gates", () => {
  it("the owner cannot click Confirm past the gates: unsigned agreement or unpaid deposit refuse with the blocker text", async () => {
    results.photo_bookings = { data: signed({ contract_state: "sent", booking_status: "awaiting_contract" }), error: null };
    expect(await transitionBooking(BOOKING_ID, "confirmed")).toMatchObject({ ok: false, error: expect.stringMatching(/agreement has not been signed/i) });
    results.photo_bookings = { data: signed(), error: null };
    expect(await transitionBooking(BOOKING_ID, "confirmed")).toMatchObject({ ok: false, error: "Blocked because the 50% deposit has not been paid." });
    expect(writes).toEqual([]);
  });

  it("confirms by hand only when the agreement is signed AND the deposit is paid", async () => {
    const b = signed({ deposit_state: "paid", deposit_paid_at: DONE });
    results.photo_bookings = [{ data: b, error: null }, { data: { ...b, booking_status: "confirmed", confirmed_at: DONE }, error: null }];
    expect(await transitionBooking(BOOKING_ID, "confirmed")).toEqual({ ok: true });
    expect(updates("photo_bookings")[0]).toMatchObject({ booking_status: "confirmed" });
    expect(enqueueClientEmail.mock.calls.map((c) => (c as unknown as [unknown, { kind: string }])[1].kind)).toEqual(["BOOKING_CONFIRMED"]);
  });

  it("marking delivered by hand makes the balance due (never creates or sends a link) and completed is refused while the balance is due", async () => {
    const b = signed({ deposit_state: "paid", booking_status: "in_progress", confirmed_at: DONE, coverage_done_at: DONE });
    results.photo_bookings = [{ data: b, error: null }, { data: { ...b, booking_status: "delivered", balance_state: "due" }, error: null }];
    expect(await transitionBooking(BOOKING_ID, "delivered")).toEqual({ ok: true });
    expect(updates("photo_bookings")[0]).toMatchObject({ booking_status: "delivered", delivered_at: expect.any(String), gallery_delivered_at: expect.any(String), balance_state: "due", balance_due_at: expect.any(String) });
    expect(auditActions()).toEqual(["booking.status", "balance.due"]);
    expect(writes.some((w) => w.table === "photo_booking_payment_requests")).toBe(false);
    expect(enqueueClientEmail.mock.calls.map((c) => (c as unknown as [unknown, { kind: string }])[1].kind)).toEqual(["DELIVERY_COMPLETE"]);

    writes.length = 0;
    results.photo_bookings = { data: { ...b, booking_status: "delivered", balance_state: "due" }, error: null };
    expect(await transitionBooking(BOOKING_ID, "completed")).toMatchObject({ ok: false, error: expect.stringMatching(/final balance is still due/i) });
    expect(writes).toEqual([]);
  });
});

describe("stage payment requests (owner actions)", () => {
  beforeEach(() => {
    vi.mocked(isPaymentsEnabled).mockReturnValue(true);
  });

  it("refuses the deposit before the agreement is signed, and the balance before delivery; nothing is written or sent", async () => {
    results.photo_bookings = { data: signed({ contract_state: "sent", booking_status: "awaiting_contract" }), error: null };
    expect(await requestStagePayment(BOOKING_ID, "deposit")).toMatchObject({ ok: false, code: "contract_unsigned", error: expect.stringMatching(/agreement has not been signed/i) });
    results.photo_bookings = { data: signed(), error: null };
    expect(await requestStagePayment(BOOKING_ID, "balance")).toMatchObject({ ok: false, code: "balance_not_due", error: "Final balance is not due until delivery." });
    expect(writes).toEqual([]);
    expect(enqueueOwnerTelegram).not.toHaveBeenCalled();
    expect(enqueueClientEmail).not.toHaveBeenCalled();
  });

  it("creates the deposit link for the booking's own 500 (never a browser amount), audits it, and sends NOTHING", async () => {
    results.photo_bookings = { data: signed(), error: null };
    results.photo_booking_payment_requests = [{ data: [], error: null }, { data: pendingRequest(), error: null }];
    const out = await requestStagePayment(BOOKING_ID, "deposit", { ...({ amount: 1 } as object) });
    expect(out).toMatchObject({ ok: true, created: true, regenerated: false, requestId: REQ });
    if (!out.ok) throw new Error("unreachable");
    expect(out.payUrl).toMatch(/^https:\/\/site\.test\/pay\/bbp_[A-Za-z0-9]{40}$/);
    const insert = writes.find((w) => w.table === "photo_booking_payment_requests" && w.op === "insert")?.payload as Record<string, unknown>;
    expect(insert).toMatchObject({ owner_id: USER, booking_id: BOOKING_ID, stage: "deposit", amount_qr: 500, currency: "QAR", provider: "WEBSITE", status: "pending", generation: 1 });
    expect(insert.pay_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(auditActions()).toEqual(["payment_request.created"]);
    expect(enqueueClientEmail).not.toHaveBeenCalled();
    expect(enqueueOwnerTelegram).not.toHaveBeenCalled();
  });

  it("a second call returns the same pending link without a new row", async () => {
    results.photo_bookings = { data: signed(), error: null };
    results.photo_booking_payment_requests = { data: [pendingRequest()], error: null };
    const out = await requestStagePayment(BOOKING_ID, "deposit");
    expect(out).toMatchObject({ ok: true, created: false, requestId: REQ, payUrl: pendingRequest().payment_url });
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);
  });

  it("without MyFatoorah configured: a safe admin blocker, or a pasted MANUAL_LINK on the same request row", async () => {
    vi.mocked(isPaymentsEnabled).mockReturnValue(false);
    results.photo_bookings = { data: signed(), error: null };
    results.photo_booking_payment_requests = { data: [], error: null };
    expect(await requestStagePayment(BOOKING_ID, "deposit")).toEqual({ ok: false, code: "payments_off", error: PAYMENTS_NOT_CONFIGURED_MESSAGE });
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);

    results.photo_bookings = { data: signed(), error: null };
    results.photo_booking_payment_requests = [{ data: [], error: null }, { data: pendingRequest({ provider: "MANUAL_LINK", payment_url: "https://portal.example/inv/1", pay_token_hash: null }), error: null }];
    expect(await requestStagePayment(BOOKING_ID, "deposit", { manualUrl: "https://portal.example/inv/1" })).toMatchObject({ ok: true, payUrl: "https://portal.example/inv/1" });
    const insert = writes.find((w) => w.table === "photo_booking_payment_requests" && w.op === "insert")?.payload as Record<string, unknown>;
    expect(insert).toMatchObject({ provider: "MANUAL_LINK", payment_url: "https://portal.example/inv/1", pay_token_hash: null, amount_qr: 500 });
    expect(auditActions()).toEqual(["payment_request.created", "payment_request.manual_link"]);
    expect(enqueueClientEmail).not.toHaveBeenCalled();
  });

  it("Send payment link is the explicit step: vendor-free e-mail to the client, Telegram to the owner, sent_at stamped", async () => {
    results.photo_bookings = { data: signed({ public_ref: "BB-7K3PQ2" }), error: null };
    results.photo_booking_payment_requests = { data: [pendingRequest()], error: null };
    expect(await sendStagePaymentRequest(BOOKING_ID, REQ)).toEqual({ ok: true, emailQueued: true });
    const mail = enqueueClientEmail.mock.calls.map((c) => (c as unknown as [unknown, { kind: string; alertKey: string; draft: { subject: string; text: string } }])[1])[0];
    expect(mail.kind).toBe("PAYMENT_REQUESTED");
    expect(mail.alertKey).toBe(`email:booking:${BOOKING_ID}:payment-requested:${REQ}:1`);
    expect(mail.draft.subject).toBe("Complete your online payment (BB-7K3PQ2)");
    expect(mail.draft.text).toContain("deposit (50%)");
    expect(mail.draft.text).toContain("500 QAR");
    expect(mail.draft.text).toContain(pendingRequest().payment_url);
    expect(mail.draft.text.toLowerCase()).not.toMatch(/fatoorah/);
    expect(enqueueOwnerTelegram).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "BOOKING_PAYMENT_REQUESTED" }));
    expect(updates("photo_booking_payment_requests")[0]).toMatchObject({ sent_at: expect.any(String) });
    expect(auditActions()).toEqual(["payment_request.sent"]);
  });

  it("Regenerate cancels the pending link and creates generation + 1", async () => {
    results.photo_bookings = { data: signed(), error: null };
    results.photo_booking_payment_requests = [
      { data: [pendingRequest()], error: null }, // listStageRequests (regenerate)
      { data: [{ id: REQ }], error: null }, // cancel update
      { data: [pendingRequest({ status: "cancelled" })], error: null }, // listStageRequests (create)
      { data: pendingRequest({ id: "77777777-7777-4777-8777-777777777777", generation: 2 }), error: null }, // insert
    ];
    const out = await regenerateStagePayment(BOOKING_ID, "deposit");
    expect(out).toMatchObject({ ok: true, created: true, regenerated: true });
    expect(updates("photo_booking_payment_requests")[0]).toMatchObject({ status: "cancelled" });
    const insert = writes.find((w) => w.table === "photo_booking_payment_requests" && w.op === "insert")?.payload as Record<string, unknown>;
    expect(insert.generation).toBe(2);
    expect(auditActions()).toEqual(["payment_request.cancelled", "payment_request.created", "payment_request.regenerated"]);
  });
});

describe("recordManualPayment", () => {
  it("validates the sheet (method and stage) before loading the booking", async () => {
    const out = await recordManualPayment(BOOKING_ID, null, fd({ method: "myfatoorah", amount_qr: "0", stage: "tip" }));
    expect(out).toMatchObject({ fieldErrors: { method: expect.any(String), amount_qr: expect.any(String), stage: expect.any(String) } });
    expect(writes).toEqual([]);
  });

  it("never overrides a request the provider verified, and refuses a balance before delivery", async () => {
    results.photo_bookings = { data: signed(), error: null };
    results.photo_booking_payment_requests = { data: [pendingRequest({ status: "paid" })], error: null };
    expect(await recordManualPayment(BOOKING_ID, null, fd({ method: "cash", amount_qr: "500", stage: "deposit" }))).toMatchObject({ error: expect.stringMatching(/already paid online/i) });
    results.photo_bookings = { data: signed({ deposit_state: "paid" }), error: null };
    expect(await recordManualPayment(BOOKING_ID, null, fd({ method: "cash", amount_qr: "500", stage: "deposit" }))).toMatchObject({ fieldErrors: { stage: expect.stringMatching(/already paid/i) } });
    results.photo_bookings = { data: signed(), error: null };
    expect(await recordManualPayment(BOOKING_ID, null, fd({ method: "cash", amount_qr: "500", stage: "balance" }))).toMatchObject({ fieldErrors: { stage: "Final balance is not due until delivery." } });
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("settles the DEPOSIT stage, cancels its pending link, confirms through the gates and never writes the provider status", async () => {
    const b = signed();
    const confirmed = { ...b, deposit_state: "paid", amount_paid_qr: 500, manual_paid_at: DONE, booking_status: "confirmed", confirmed_at: DONE };
    results.photo_bookings = [
      { data: b, error: null }, // ownedBooking
      { data: null, error: null }, // stage patch
      { data: { ...b, deposit_state: "paid", amount_paid_qr: 500, manual_paid_at: DONE, payment_method: "cash" }, error: null }, // summary refresh
      { data: { ...b, deposit_state: "paid" }, error: null }, // gates: re-read
      { data: null, error: null }, // gates: move to confirmed
      { data: confirmed, error: null }, // re-read after gates
    ];
    results.photo_booking_payment_requests = [
      { data: [pendingRequest()], error: null }, // listStageRequests
      { data: [{ id: REQ }], error: null }, // cancel pending link
    ];
    results.photo_payment_records = [
      { data: { id: REC, kind: "manual", method: "cash", amount_qr: 500 }, error: null }, // insert
      { data: [{ amount_qr: 500, paid_at: DONE }], error: null }, // sum
    ];
    expect(await recordManualPayment(BOOKING_ID, null, fd({ method: "cash", amount_qr: "500", paid_at: "2026-10-06", stage: "deposit" }))).toEqual({ saved: true });
    expect(writes.find((w) => w.table === "photo_payment_records" && w.op === "insert")?.payload).toMatchObject({ booking_id: BOOKING_ID, kind: "manual", method: "cash", amount_qr: 500, recorded_by: USER, owner_id: USER });
    const bookingUpdates = updates("photo_bookings");
    expect(bookingUpdates[0]).toMatchObject({ deposit_state: "paid", deposit_paid_at: expect.any(String) });
    expect("balance_state" in bookingUpdates[0]).toBe(false);
    expect(bookingUpdates[1]).toMatchObject({ amount_paid_qr: 500, payment_method: "cash" });
    expect(bookingUpdates[2]).toMatchObject({ booking_status: "confirmed" });
    expect(bookingUpdates.some((p) => "status" in p || "paid_at" in p)).toBe(false);
    expect(updates("photo_booking_payment_requests")[0]).toMatchObject({ status: "cancelled" });
    expect(auditActions()).toEqual(["deposit.paid", "payment_request.cancelled", "payment.manual", "booking.status"]);
    expect(enqueueOwnerTelegram).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "BOOKING_PAID", alertKey: `booking:${BOOKING_ID}:manual:${REC}` }));
    expect(enqueueClientEmail.mock.calls.map((c) => (c as unknown as [unknown, { kind: string }])[1].kind)).toEqual(["PAYMENT_RECEIVED", "BOOKING_CONFIRMED"]);
    expect(writes.some((w) => w.table === "photo_athletes")).toBe(false);
  });

  it("settles the BALANCE stage after delivery and completes the booking", async () => {
    const b = signed({ deposit_state: "paid", booking_status: "delivered", balance_state: "due", confirmed_at: DONE, delivered_at: DONE });
    const settled = { ...b, balance_state: "paid", balance_paid_at: DONE };
    results.photo_bookings = [
      { data: b, error: null },
      { data: null, error: null },
      { data: settled, error: null },
      { data: settled, error: null }, // gates re-read (delivered: nothing to move)
      { data: settled, error: null }, // re-read after gates
      { data: { ...settled, booking_status: "completed" }, error: null }, // completion update
    ];
    results.photo_payment_records = [{ data: { id: REC }, error: null }, { data: [{ amount_qr: 500, paid_at: DONE }], error: null }];
    expect(await recordManualPayment(BOOKING_ID, null, fd({ method: "bank_transfer", amount_qr: "500", stage: "balance" }))).toEqual({ saved: true });
    expect(updates("photo_bookings")[0]).toMatchObject({ balance_state: "paid" });
    expect("deposit_state" in updates("photo_bookings")[0]).toBe(false);
    expect(updates("photo_bookings").at(-1)).toMatchObject({ booking_status: "completed" });
    expect(auditActions()).toEqual(["balance.paid", "payment.manual", "booking.completed"]);
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

  it("the webhook's paid path confirms through the gates, mirrors the payment and queues client mail, and inserts NO athlete", async () => {
    const db = new FakeSupabase();
    db.seed("photo_bookings", [booking({ booking_status: "awaiting_payment" })]);
    let t = Date.parse("2026-10-06T12:00:00.000Z");
    const deps: WebhookDeps = { supabase: db.asClient(), now: () => new Date((t += 1000)), log: createLogger({ test: true }) };
    const out = await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(out.result).toBe("processed");
    const row = db.tables.photo_bookings.find((b) => b.id === BOOKING_ID)!;
    expect(row).toMatchObject({ status: "paid", booking_status: "confirmed", deposit_state: "paid" });
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
