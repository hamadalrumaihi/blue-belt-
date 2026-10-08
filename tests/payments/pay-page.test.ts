import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import type { CardPaymentProvider, PaymentStatusOutput, ProviderResult } from "@/lib/payments/myfatoorah/client";
import { executeCardPayment, loadPayBooking, startCardSession, startHostedPayment, verifyReturnedPayment, type PayPageDeps } from "@/lib/payments/pay-page";
import { createPayToken, hashPayToken, isPayTokenExpired, isPayTokenShape, isWebsitePayUrl, PAY_TOKEN_TTL_MS, payPageUrl } from "@/lib/payments/pay-token";
import { FakeSupabase } from "./fake-supabase";
import { BOOKING_ID, INVOICE_ID, OWNER, PAYMENT_ID, booking } from "./fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/studio/queries", () => ({ DEFAULT_STUDIO: { business_name: "Blue Belt Media" }, siteUrl: () => "https://site.test" }));

setLogSink(() => {});

const NOW = new Date("2026-10-06T12:00:00.000Z");
const DONE = "2026-10-05T18:00:00.000Z";
const SITE = "https://site.test";
const SCRIPT = "https://demo.myfatoorah.com/cardview/v3/session.js";

type ProviderMocks = CardPaymentProvider & {
  initiateSession: ReturnType<typeof vi.fn>;
  executePayment: ReturnType<typeof vi.fn>;
  createInvoice: ReturnType<typeof vi.fn>;
  getPaymentStatus: ReturnType<typeof vi.fn>;
};

function provider(status?: ProviderResult<PaymentStatusOutput>): ProviderMocks {
  return {
    name: "MYFATOORAH",
    initiateSession: vi.fn(async () => ({ ok: true, data: { sessionId: "sess-123456", countryCode: "QAT", raw: {} } })),
    executePayment: vi.fn(async () => ({ ok: true, data: { invoiceId: "7001", paymentUrl: "https://demo.myfatoorah.com/En/QAT/PayInvoice/Result?paymentId=0707", customerReference: BOOKING_ID, raw: {} } })),
    createInvoice: vi.fn(async () => ({ ok: true, data: { invoiceId: "7002", paymentUrl: "https://demo.myfatoorah.com/ie/0106230007002", customerReference: BOOKING_ID, raw: {} } })),
    getPaymentStatus: vi.fn(async () => status ?? { ok: false, error: { code: "network", message: "no" } }),
  } as unknown as ProviderMocks;
}

const inquiry = (overrides: Partial<PaymentStatusOutput> = {}, tx: Partial<PaymentStatusOutput["transactions"][number]> = {}): PaymentStatusOutput => ({
  invoiceId: INVOICE_ID,
  invoiceStatus: "Paid",
  invoiceReference: "2026000073",
  customerReference: BOOKING_ID,
  invoiceValue: 350,
  transactions: [{ paymentId: PAYMENT_ID, transactionId: "128633", status: "Succss", value: 350, currency: "QAR", transactionDate: "2026-10-06T11:59:00", errorCode: "", error: null, raw: {}, ...tx }],
  raw: {},
  ...overrides,
});

/** A booking the owner has made payable: shoot done, final amount 350, website link created. */
function setup(opts: { enabled?: boolean; booking?: Partial<ReturnType<typeof booking>>; createdAt?: string; status?: ProviderResult<PaymentStatusOutput> } = {}) {
  const db = new FakeSupabase();
  const { token, hash } = createPayToken();
  const createdAt = opts.createdAt ?? "2026-10-05T19:00:00.000Z";
  const extraMeta = opts.booking?.metadata && typeof opts.booking.metadata === "object" && !Array.isArray(opts.booking.metadata) ? (opts.booking.metadata as Record<string, unknown>) : {};
  const row = booking({
    booking_status: "in_progress",
    coverage_done_at: DONE,
    amount_qr: 350,
    status: "pending",
    provider: "MYFATOORAH",
    provider_invoice_id: null,
    payment_url: payPageUrl(SITE, token),
    ...opts.booking,
    // The token fields are what the page looks the booking up by; extra metadata is merged in, never replaces them.
    metadata: { pay_token_hash: hash, pay_token_created_at: createdAt, payment_requested_at: createdAt, ...extraMeta },
  });
  db.seed("photo_bookings", [row]);
  db.seed("photo_studio", [{ owner_id: OWNER, business_name: "Blue Belt Media" }]);
  const enabled = opts.enabled ?? true;
  const p = provider(opts.status);
  let t = NOW.getTime();
  const deps: PayPageDeps = { supabase: db.asClient(), now: () => new Date((t += 1000)), log: createLogger({ test: true }), provider: enabled ? p : null, enabled, siteUrl: SITE, scriptUrl: SCRIPT };
  return { db, token, deps, provider: p, row: () => db.tables.photo_bookings.find((b) => b.id === BOOKING_ID)! };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("pay tokens", () => {
  it("are bbp_ + 40 base62 characters, hashed with sha256, and expire after 30 days", () => {
    const { token, hash } = createPayToken();
    expect(token).toMatch(/^bbp_[A-Za-z0-9]{40}$/);
    expect(hash).toBe(hashPayToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(isPayTokenShape(token)).toBe(true);
    expect(isPayTokenShape("bbs_" + "a".repeat(40))).toBe(false);
    expect(isPayTokenShape(null)).toBe(false);
    expect(isPayTokenExpired("2026-10-05T12:00:00.000Z", NOW)).toBe(false);
    expect(isPayTokenExpired(new Date(NOW.getTime() - PAY_TOKEN_TTL_MS - 1).toISOString(), NOW)).toBe(true);
    expect(isPayTokenExpired(null, NOW)).toBe(true);
    expect(payPageUrl("https://site.test/", token)).toBe(`https://site.test/pay/${token}`);
  });

  it("isWebsitePayUrl recognises only our pay page, never a provider URL", () => {
    const { token } = createPayToken();
    expect(isWebsitePayUrl(`https://site.test/pay/${token}`)).toBe(true);
    expect(isWebsitePayUrl("https://demo.myfatoorah.com/ie/0106230003434")).toBe(false);
    expect(isWebsitePayUrl("https://site.test/pay/")).toBe(false);
    expect(isWebsitePayUrl("javascript:alert(1)")).toBe(false);
    expect(isWebsitePayUrl(null)).toBe(false);
  });
});

describe("loadPayBooking", () => {
  it("finds the booking by the token hash and shows amounts from the row only", async () => {
    const { token, deps } = setup();
    const out = await loadPayBooking(token, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.studioName).toBe("Blue Belt Media");
    expect(out.view).toMatchObject({ id: BOOKING_ID, amountQr: 350, dueQr: 350, currency: "QAR", customerFirstName: "Test", athleteName: "Test Athlete", payable: true, paymentsOff: false, providerInvoiceId: null });
    expect(out.view).not.toHaveProperty("customer_email");
    expect(out.view).not.toHaveProperty("notes");
  });

  it("refuses an unknown or malformed token, an expired link, and reports payments-off calmly", async () => {
    const { deps } = setup();
    expect(await loadPayBooking("bbp_" + "z".repeat(40), deps)).toEqual({ ok: false, error: "not_found" });
    expect(await loadPayBooking("nope", deps)).toEqual({ ok: false, error: "not_found" });
    const old = setup({ createdAt: "2026-08-01T00:00:00.000Z" });
    expect(await loadPayBooking(old.token, old.deps)).toEqual({ ok: false, error: "expired" });
    const off = setup({ enabled: false });
    const out = await loadPayBooking(off.token, off.deps);
    expect(out.ok && out.view).toMatchObject({ payable: false, paymentsOff: true });
  });

  it("is not payable before the shoot is marked complete or once paid", async () => {
    const early = setup({ booking: { coverage_done_at: null } });
    expect((await loadPayBooking(early.token, early.deps)) as { view: { payable: boolean } }).toMatchObject({ view: { payable: false, paymentsOff: false } });
    const paid = setup({ booking: { status: "paid", paid_at: "2026-10-06T10:00:00.000Z" } });
    expect((await loadPayBooking(paid.token, paid.deps)) as { view: unknown }).toMatchObject({ view: { payable: false, payment: { state: "paid" }, paidAt: "2026-10-06T10:00:00.000Z" } });
  });
});

describe("startCardSession", () => {
  it("opens a MyFatoorah session and returns the script for the configured base", async () => {
    const { token, deps, provider } = setup();
    expect(await startCardSession(token, deps)).toEqual({ ok: true, sessionId: "sess-123456", countryCode: "QAT", scriptUrl: SCRIPT });
    expect(provider.initiateSession).toHaveBeenCalledTimes(1);
  });

  it("calls the provider only for a payable booking and only while payments are enabled", async () => {
    const off = setup({ enabled: false });
    expect(await startCardSession(off.token, off.deps)).toEqual({ ok: false, error: "payments_off" });
    expect(off.provider.initiateSession).not.toHaveBeenCalled();
    const early = setup({ booking: { coverage_done_at: null } });
    expect(await startCardSession(early.token, early.deps)).toEqual({ ok: false, error: "not_payable" });
    expect(early.provider.initiateSession).not.toHaveBeenCalled();
    const paid = setup({ booking: { amount_paid_qr: 350, manual_paid_at: DONE } });
    expect(await startCardSession(paid.token, paid.deps)).toEqual({ ok: false, error: "not_payable" });
    const expired = setup({ createdAt: "2026-01-01T00:00:00.000Z" });
    expect(await startCardSession(expired.token, expired.deps)).toEqual({ ok: false, error: "expired" });
    expect(await startCardSession("bbp_" + "q".repeat(40), off.deps)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("executeCardPayment", () => {
  it("charges the booking's own due amount, links the invoice, keeps payment_url as OUR page and audits as the client", async () => {
    const { token, deps, provider, db, row } = setup();
    const out = await executeCardPayment(token, "sess-123456", deps);
    expect(out).toEqual({ ok: true, redirectUrl: "https://demo.myfatoorah.com/En/QAT/PayInvoice/Result?paymentId=0707", invoiceId: "7001" });
    expect(provider.executePayment).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess-123456", amount: 350, displayCurrencyIso: "QAR", customerReference: BOOKING_ID, customerName: "Test Customer", callbackUrl: `${SITE}/pay/${token}?result=callback`, errorUrl: `${SITE}/pay/${token}?result=error`, language: "EN" }));
    const b = row();
    expect(b).toMatchObject({ provider: "MYFATOORAH", provider_invoice_id: "7001", status: "pending", payment_url: payPageUrl(SITE, token) });
    expect(b.metadata).toMatchObject({ provider_payment_url: "https://demo.myfatoorah.com/En/QAT/PayInvoice/Result?paymentId=0707", pay_session: { invoice_id: "7001", amount: 350, currency: "QAR", kind: "card" }, pay_token_hash: hashPayToken(token) });
    expect(db.tables.photo_audit_log).toEqual([expect.objectContaining({ owner_id: OWNER, actor_kind: "client", entity: "booking", entity_id: BOOKING_ID, action: "payment.session_started" })]);
    expect(db.tables.photo_athletes).toHaveLength(0);
  });

  it("asks for the balance only when part was paid by hand, and a retry supersedes the earlier invoice", async () => {
    const { token, deps, provider, row } = setup({ booking: { amount_paid_qr: 100, manual_paid_at: DONE } });
    await executeCardPayment(token, "sess-123456", deps);
    expect(provider.executePayment).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 250 }));
    provider.executePayment.mockResolvedValueOnce({ ok: true, data: { invoiceId: "7009", paymentUrl: "https://demo.myfatoorah.com/x", customerReference: BOOKING_ID, raw: {} } });
    expect(await executeCardPayment(token, "sess-654321", deps)).toMatchObject({ ok: true, invoiceId: "7009" });
    expect(row()).toMatchObject({ provider_invoice_id: "7009" });
    expect(row().metadata).toMatchObject({ superseded_invoices: ["7001"], pay_session: { invoice_id: "7009", amount: 250 } });
  });

  it("refuses a bad session id, a non-payable booking, payments off, and a provider failure without touching the row", async () => {
    const { token, deps, provider, row } = setup();
    expect(await executeCardPayment(token, "", deps)).toEqual({ ok: false, error: "invalid" });
    expect(await executeCardPayment(token, "x".repeat(300), deps)).toEqual({ ok: false, error: "invalid" });
    provider.executePayment.mockResolvedValueOnce({ ok: false, error: { code: "provider", message: "Session expired" } });
    expect(await executeCardPayment(token, "sess-123456", deps)).toEqual({ ok: false, error: "provider_error" });
    expect(row().provider_invoice_id).toBeNull();
    const off = setup({ enabled: false });
    expect(await executeCardPayment(off.token, "sess-123456", off.deps)).toEqual({ ok: false, error: "payments_off" });
    expect(off.provider.executePayment).not.toHaveBeenCalled();
    const paid = setup({ booking: { status: "paid", paid_at: DONE } });
    expect(await executeCardPayment(paid.token, "sess-123456", paid.deps)).toEqual({ ok: false, error: "not_payable" });
    expect(paid.provider.executePayment).not.toHaveBeenCalled();
  });
});

describe("startHostedPayment", () => {
  it("creates a SendPayment invoice with the same amount and return URLs, stored the same way", async () => {
    const { token, deps, provider, row } = setup();
    expect(await startHostedPayment(token, deps)).toEqual({ ok: true, redirectUrl: "https://demo.myfatoorah.com/ie/0106230007002", invoiceId: "7002" });
    expect(provider.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ amount: 350, customerReference: BOOKING_ID, displayCurrencyIso: "QAR", callbackUrl: `${SITE}/pay/${token}?result=callback`, errorUrl: `${SITE}/pay/${token}?result=error` }));
    expect(row()).toMatchObject({ provider_invoice_id: "7002", payment_url: payPageUrl(SITE, token) });
    expect(row().metadata).toMatchObject({ provider_payment_url: "https://demo.myfatoorah.com/ie/0106230007002", pay_session: { invoice_id: "7002", kind: "hosted" } });
    const off = setup({ enabled: false });
    expect(await startHostedPayment(off.token, off.deps)).toEqual({ ok: false, error: "payments_off" });
    expect(off.provider.createInvoice).not.toHaveBeenCalled();
  });
});

describe("verifyReturnedPayment", () => {
  const linked = { provider_invoice_id: INVOICE_ID };
  function linkedSetup(status: ProviderResult<PaymentStatusOutput>, extra: Partial<ReturnType<typeof booking>> = {}) {
    return setup({ status, booking: { ...linked, ...extra } });
  }

  it("success: asks MyFatoorah by PaymentId, marks the booking paid ONCE through the atomic transition, and a second visit is a no-op", async () => {
    const { token, deps, provider, db, row } = setup({ status: { ok: true, data: inquiry() }, booking: { provider_invoice_id: INVOICE_ID, metadata: { pay_session: { invoice_id: INVOICE_ID, amount: 350, currency: "QAR", kind: "card" } } } });
    expect(await verifyReturnedPayment(token, PAYMENT_ID, deps)).toEqual({ status: "paid" });
    expect(provider.getPaymentStatus).toHaveBeenCalledWith({ key: PAYMENT_ID, keyType: "PaymentId" });
    expect(row()).toMatchObject({ status: "paid", booking_status: "in_progress" });
    expect(row().paid_at).toBeTruthy();
    expect(db.rpcCalls.filter((c) => c.name === "photo_apply_payment_transition")).toHaveLength(1);
    expect(db.tables.photo_payment_attempts).toEqual([expect.objectContaining({ provider_payment_id: PAYMENT_ID, status: "paid", amount: 350 })]);
    expect(db.tables.photo_payment_records).toEqual([expect.objectContaining({ kind: "provider", method: "myfatoorah", amount_qr: 350 })]);
    expect(db.tables.photo_notification_deliveries.filter((d) => d.channel === "email").map((d) => d.alert_key)).toEqual([`email:booking:${BOOKING_ID}:paid`]);
    expect(db.tables.photo_athletes).toHaveLength(0);

    const paidAt = row().paid_at;
    expect(await verifyReturnedPayment(token, PAYMENT_ID, deps)).toEqual({ status: "paid" });
    expect(provider.getPaymentStatus).toHaveBeenCalledTimes(1); // already paid: no second provider call
    expect(row().paid_at).toBe(paidAt);
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.tables.photo_payment_records).toHaveLength(1);
  });

  it("pending / in-progress leaves the booking alone; failed marks it failed; both say so without claiming paid", async () => {
    const pending = linkedSetup({ ok: true, data: inquiry({ invoiceStatus: "Pending" }, { status: "InProgress" }) });
    expect(await verifyReturnedPayment(pending.token, PAYMENT_ID, pending.deps)).toEqual({ status: "pending" });
    expect(pending.row().status).toBe("pending");
    expect(pending.db.rpcCalls).toHaveLength(0);

    const failed = linkedSetup({ ok: true, data: inquiry({ invoiceStatus: "Pending" }, { status: "Failed", error: "Declined" }) });
    expect(await verifyReturnedPayment(failed.token, PAYMENT_ID, failed.deps)).toEqual({ status: "failed" });
    expect(failed.row().status).toBe("failed");
    expect(failed.row().paid_at).toBeNull();
    expect(failed.db.tables.photo_payment_records).toHaveLength(0);
  });

  it("refuses the wrong amount (owner alerted, not paid) and an inquiry for another invoice (no transition at all)", async () => {
    const wrongAmount = linkedSetup({ ok: true, data: inquiry({ invoiceValue: 35 }, { value: 35 }) });
    expect(await verifyReturnedPayment(wrongAmount.token, PAYMENT_ID, wrongAmount.deps)).toMatchObject({ status: "mismatch" });
    expect(wrongAmount.row().status).toBe("pending");
    expect(wrongAmount.row().metadata).toMatchObject({ payment_mismatch: { invoice_id: INVOICE_ID, amount: 35, expected: 350 } });
    expect(wrongAmount.db.tables.photo_notification_deliveries.filter((d) => d.kind === "INTEGRATION_FAILED")).toEqual([expect.objectContaining({ alert_key: `payment:${BOOKING_ID}:mismatch:return:${PAYMENT_ID}` })]);
    expect(wrongAmount.db.rpcCalls).toHaveLength(0);

    const wrongInvoice = linkedSetup({ ok: true, data: inquiry({ invoiceId: "999999", customerReference: "someone-else" }) });
    expect(await verifyReturnedPayment(wrongInvoice.token, PAYMENT_ID, wrongInvoice.deps)).toEqual({ status: "mismatch", detail: "invoice" });
    expect(wrongInvoice.row().status).toBe("pending");
    expect(wrongInvoice.db.rpcCalls).toHaveLength(0);
    expect(wrongInvoice.db.tables.photo_payment_attempts).toHaveLength(0);
  });

  it("accepts a payment of an invoice this booking superseded (earlier attempt) at the right amount", async () => {
    const s = setup({ status: { ok: true, data: inquiry() }, booking: { provider_invoice_id: "NEWER", metadata: { superseded_invoices: [INVOICE_ID] } } });
    expect(await verifyReturnedPayment(s.token, PAYMENT_ID, s.deps)).toEqual({ status: "paid" });
    expect(s.row()).toMatchObject({ status: "paid", provider_invoice_id: INVOICE_ID });
  });

  it("never calls the provider for an expired token, a bad payment id, or while payments are off", async () => {
    const expired = setup({ status: { ok: true, data: inquiry() }, createdAt: "2026-01-01T00:00:00.000Z", booking: linked });
    expect(await verifyReturnedPayment(expired.token, PAYMENT_ID, expired.deps)).toEqual({ status: "invalid" });
    expect(expired.provider.getPaymentStatus).not.toHaveBeenCalled();
    const bad = linkedSetup({ ok: true, data: inquiry() });
    expect(await verifyReturnedPayment(bad.token, "../x", bad.deps)).toEqual({ status: "invalid" });
    expect(await verifyReturnedPayment("bbp_" + "k".repeat(40), PAYMENT_ID, bad.deps)).toEqual({ status: "invalid" });
    expect(bad.provider.getPaymentStatus).not.toHaveBeenCalled();
    const off = setup({ enabled: false, booking: linked });
    expect(await verifyReturnedPayment(off.token, PAYMENT_ID, off.deps)).toEqual({ status: "unavailable" });
    expect(off.provider.getPaymentStatus).not.toHaveBeenCalled();
    expect(off.row().status).toBe("pending");
    const down = linkedSetup({ ok: false, error: { code: "timeout", message: "slow" } });
    expect(await verifyReturnedPayment(down.token, PAYMENT_ID, down.deps)).toEqual({ status: "provider_error" });
    expect(down.row().status).toBe("pending");
  });
});
