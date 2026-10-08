import { describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import type { CardPaymentProvider, PaymentStatusOutput, ProviderResult } from "@/lib/payments/myfatoorah/client";
import { executeCardPayment, loadPayBooking, startCardSession, startHostedPayment, verifyReturnedPayment, type PayPageDeps } from "@/lib/payments/pay-page";
import { createStagePaymentRequest } from "@/lib/payments/requests";
import type { PhotoBookingPaymentRequestRow, PhotoBookingRow } from "@/lib/supabase/database.types";
import { FakeSupabase } from "./fake-supabase";
import { BOOKING_ID, OWNER, PAYMENT_ID, booking } from "./fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/studio/queries", () => ({ DEFAULT_STUDIO: { business_name: "Blue Belt Media" }, siteUrl: () => "https://site.test" }));

setLogSink(() => {});

const NOW = new Date("2026-10-08T12:00:00.000Z");
const SITE = "https://site.test";
const SCRIPT = "https://demo.myfatoorah.com/cardview/v3/session.js";
const actor = { userId: OWNER, kind: "owner" as const };

type ProviderMocks = CardPaymentProvider & { initiateSession: ReturnType<typeof vi.fn>; executePayment: ReturnType<typeof vi.fn>; createInvoice: ReturnType<typeof vi.fn>; getPaymentStatus: ReturnType<typeof vi.fn> };

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
  invoiceId: "7001",
  invoiceStatus: "Paid",
  invoiceReference: "2026000073",
  customerReference: BOOKING_ID,
  invoiceValue: 500,
  transactions: [{ paymentId: PAYMENT_ID, transactionId: "128633", status: "Succss", value: 500, currency: "QAR", transactionDate: "2026-10-08T11:59:00", errorCode: "", error: null, raw: {}, ...tx }],
  raw: {},
  ...overrides,
});

const signed = (overrides: Partial<PhotoBookingRow> = {}) =>
  booking({ amount_qr: 1000, deposit_qr: 500, balance_qr: 500, deposit_state: "pending", balance_state: "not_due", requires_contract: true, contract_state: "signed", booking_status: "awaiting_payment", provider_invoice_id: null, payment_url: null, status: "pending", ...overrides });

async function setup(opts: { enabled?: boolean; booking?: Partial<PhotoBookingRow>; stage?: "deposit" | "balance"; createdAt?: string; status?: ProviderResult<PaymentStatusOutput> } = {}) {
  const db = new FakeSupabase();
  const row = signed(opts.booking);
  db.seed("photo_bookings", [row]);
  db.seed("photo_studio", [{ owner_id: OWNER, business_name: "Blue Belt Media" }]);
  const supabase = db.asClient();
  const created = await createStagePaymentRequest(supabase, { booking: row, stage: opts.stage ?? "deposit", actor, paymentsEnabled: true, siteUrl: SITE, now: new Date(opts.createdAt ?? "2026-10-08T09:00:00.000Z") });
  if (!created.ok) throw new Error(created.error);
  const token = created.payUrl.split("/pay/")[1];
  const enabled = opts.enabled ?? true;
  const p = provider(opts.status);
  let t = NOW.getTime();
  const deps: PayPageDeps = { supabase, now: () => new Date((t += 1000)), log: createLogger({ test: true }), provider: enabled ? p : null, enabled, siteUrl: SITE, scriptUrl: SCRIPT };
  return { db, token, deps, provider: p, request: () => db.tables.photo_booking_payment_requests.find((r) => r.id === created.request.id)! as unknown as PhotoBookingPaymentRequestRow, row: () => db.tables.photo_bookings.find((b) => b.id === BOOKING_ID)! as unknown as PhotoBookingRow };
}

describe("loadPayBooking with a stage request token", () => {
  it("looks the token up on the request row and shows the request's stage, amount and currency (never the total as the charge)", async () => {
    const { token, deps } = await setup();
    const out = await loadPayBooking(token, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.view).toMatchObject({ id: BOOKING_ID, stage: "deposit", amountQr: 500, totalQr: 1000, currency: "QAR", state: "payable", payable: true, paymentsOff: false, providerInvoiceId: null });
    expect(out.view).not.toHaveProperty("customer_email");
  });

  it("shows the right state for paid, cancelled, expired and payments-off requests, and never starts a session for them", async () => {
    const paid = await setup();
    await paid.deps.supabase.from("photo_booking_payment_requests").update({ status: "paid", paid_at: NOW.toISOString() }).eq("id", paid.request().id);
    await paid.deps.supabase.from("photo_bookings").update({ deposit_state: "paid", deposit_paid_at: NOW.toISOString() }).eq("id", BOOKING_ID);
    expect(((await loadPayBooking(paid.token, paid.deps)) as { view: { state: string; paidAt: string } }).view).toMatchObject({ state: "paid", paidAt: NOW.toISOString() });
    expect(await startCardSession(paid.token, paid.deps)).toEqual({ ok: false, error: "not_payable" });
    expect(paid.provider.initiateSession).not.toHaveBeenCalled();

    const cancelled = await setup();
    await cancelled.deps.supabase.from("photo_booking_payment_requests").update({ status: "cancelled" }).eq("id", cancelled.request().id);
    expect(((await loadPayBooking(cancelled.token, cancelled.deps)) as { view: { state: string } }).view.state).toBe("cancelled");
    expect(await executeCardPayment(cancelled.token, "sess-123456", cancelled.deps)).toEqual({ ok: false, error: "not_payable" });

    const expired = await setup({ createdAt: "2026-01-01T00:00:00.000Z" });
    expect(((await loadPayBooking(expired.token, expired.deps)) as { view: { state: string } }).view.state).toBe("expired");
    expect(await startHostedPayment(expired.token, expired.deps)).toEqual({ ok: false, error: "expired" });

    const off = await setup({ enabled: false });
    expect(((await loadPayBooking(off.token, off.deps)) as { view: { state: string } }).view.state).toBe("payments_off");
    expect(await startCardSession(off.token, off.deps)).toEqual({ ok: false, error: "payments_off" });

    // The stage closed on the booking (deposit recorded by hand) while the link was still pending.
    const closed = await setup();
    await closed.deps.supabase.from("photo_bookings").update({ deposit_state: "paid" }).eq("id", BOOKING_ID);
    expect(await startCardSession(closed.token, closed.deps)).toEqual({ ok: false, error: "not_payable" });
  });
});

describe("checkout with a stage request", () => {
  it("charges the REQUEST amount, stores the invoice on the request row and mirrors it on the booking", async () => {
    const { token, deps, provider, request, row, db } = await setup();
    const out = await executeCardPayment(token, "sess-123456", deps);
    expect(out).toEqual({ ok: true, redirectUrl: "https://demo.myfatoorah.com/En/QAT/PayInvoice/Result?paymentId=0707", invoiceId: "7001" });
    expect(provider.executePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 500, displayCurrencyIso: "QAR", customerReference: BOOKING_ID, callbackUrl: `${SITE}/pay/${token}?result=callback`, userDefinedField: expect.stringMatching(/:deposit$/) }));
    expect(request()).toMatchObject({ provider_invoice_id: "7001", provider_reference: BOOKING_ID, status: "pending" });
    expect(request().metadata).toMatchObject({ pay_session: { invoice_id: "7001", amount: 500, kind: "card" }, superseded_invoices: [] });
    expect(row()).toMatchObject({ provider: "MYFATOORAH", provider_invoice_id: "7001" });
    expect(db.tables.photo_audit_log).toEqual([expect.objectContaining({ action: "payment_request.created" }), expect.objectContaining({ actor_kind: "client", action: "payment.session_started", data: expect.objectContaining({ stage: "deposit", amount_qr: 500 }) })]);

    // A retry supersedes the first invoice on the request.
    provider.executePayment.mockResolvedValueOnce({ ok: true, data: { invoiceId: "7009", paymentUrl: "https://demo.myfatoorah.com/x", customerReference: BOOKING_ID, raw: {} } });
    expect(await executeCardPayment(token, "sess-654321", deps)).toMatchObject({ ok: true, invoiceId: "7009" });
    expect(request()).toMatchObject({ provider_invoice_id: "7009" });
    expect(request().metadata).toMatchObject({ superseded_invoices: ["7001"] });

    const hosted = await setup();
    expect(await startHostedPayment(hosted.token, hosted.deps)).toMatchObject({ ok: true, invoiceId: "7002" });
    expect(hosted.provider.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ amount: 500 }));
    expect(hosted.request()).toMatchObject({ provider_invoice_id: "7002" });
  });

  it("a balance request after delivery charges the balance amount", async () => {
    const s = await setup({ stage: "balance", booking: { deposit_state: "paid", balance_state: "due", booking_status: "delivered", status: "paid", balance_qr: 450, amount_qr: 950 } });
    await executeCardPayment(s.token, "sess-123456", s.deps);
    expect(s.provider.executePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 450 }));
  });
});

describe("verifyReturnedPayment with a stage request", () => {
  it("success: asks by PaymentId, applies the deposit through the atomic transition and the gates, and a second visit is a no-op", async () => {
    const s = await setup({ status: { ok: true, data: inquiry() } });
    await executeCardPayment(s.token, "sess-123456", s.deps);
    expect(await verifyReturnedPayment(s.token, PAYMENT_ID, s.deps)).toEqual({ status: "paid" });
    expect(s.request()).toMatchObject({ status: "paid", provider_payment_id: PAYMENT_ID });
    expect(s.row()).toMatchObject({ status: "paid", deposit_state: "paid", balance_state: "not_due", booking_status: "confirmed" });
    expect(s.db.rpcCalls.filter((c) => c.name === "photo_apply_payment_transition")).toHaveLength(1);
    expect(s.db.tables.photo_payment_records).toEqual([expect.objectContaining({ kind: "provider", amount_qr: 500 })]);
    expect(await verifyReturnedPayment(s.token, PAYMENT_ID, s.deps)).toEqual({ status: "paid" });
    expect(s.provider.getPaymentStatus).toHaveBeenCalledTimes(1);
    expect(s.db.tables.photo_payment_records).toHaveLength(1);
  });

  it("refuses the wrong amount and an inquiry for another invoice; failed marks the request failed, not paid", async () => {
    const wrong = await setup({ status: { ok: true, data: inquiry({ invoiceValue: 50 }, { value: 50 }) } });
    await executeCardPayment(wrong.token, "sess-123456", wrong.deps);
    expect(await verifyReturnedPayment(wrong.token, PAYMENT_ID, wrong.deps)).toMatchObject({ status: "mismatch" });
    expect(wrong.request().status).toBe("pending");
    expect(wrong.row().deposit_state).toBe("pending");

    const other = await setup({ status: { ok: true, data: inquiry({ invoiceId: "999" }) } });
    await executeCardPayment(other.token, "sess-123456", other.deps);
    expect(await verifyReturnedPayment(other.token, PAYMENT_ID, other.deps)).toEqual({ status: "mismatch", detail: "invoice" });
    expect(other.db.rpcCalls).toHaveLength(0);

    const failed = await setup({ status: { ok: true, data: inquiry({ invoiceStatus: "Pending" }, { status: "Failed", error: "Declined" }) } });
    await executeCardPayment(failed.token, "sess-123456", failed.deps);
    expect(await verifyReturnedPayment(failed.token, PAYMENT_ID, failed.deps)).toEqual({ status: "failed" });
    expect(failed.request().status).toBe("failed");
    expect(failed.row()).toMatchObject({ status: "failed", deposit_state: "pending" });
  });
});
