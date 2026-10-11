import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import type { PaymentProvider } from "@/lib/payments/myfatoorah/client";
import { loadOrderPay, orderPayView, startOrderHostedPayment, verifyReturnedOrderPayment, type OrderPayDeps } from "@/lib/payments/order-pay";
import { createOrderPayToken, orderPayPageUrl } from "@/lib/payments/pay-token";
import type { PhotoOrderRow } from "@/lib/supabase/database.types";
import { ORDER_ID, ORDER_OWNER, orderRow } from "../helpers/order-row";
import { FakeSupabase } from "./fake-supabase";

vi.mock("server-only", () => ({}));
setLogSink(() => {});

const SITE = "https://site.test";
const NOW = new Date("2026-10-11T10:00:00.000Z");
const { token: TOKEN, hash: HASH } = createOrderPayToken();

type Row = Record<string, unknown>;

const inquiry = (over: Partial<{ invoiceId: string; invoiceStatus: string; invoiceValue: number; customerReference: string; transactions: Array<{ status: string; paymentId: string; currency: string }> }> = {}) => ({
  ok: true as const,
  data: { invoiceId: over.invoiceId ?? "INV-1", invoiceStatus: over.invoiceStatus ?? "Pending", invoiceReference: "r", customerReference: over.customerReference ?? ORDER_ID, invoiceValue: over.invoiceValue ?? 120, transactions: over.transactions ?? [], raw: {} },
});

function setup(order: Partial<PhotoOrderRow> = {}, provider: Partial<PaymentProvider> | null = {}) {
  const db = new FakeSupabase();
  db.seed("photo_orders", [orderRow({ pay_token_hash: HASH, pay_token_created_at: NOW.toISOString(), payment_url: orderPayPageUrl(SITE, TOKEN), provider: "MYFATOORAH", provider_invoice_id: "INV-1", metadata: { invoice: { provider_payment_url: "https://pay.test/INV-1" } }, items: [{ name: "Match 3 photo set", quantity: 2, unitAmount: 60 }], ...order }) as unknown as Row]);
  db.seed("photo_studio", [{ owner_id: ORDER_OWNER, business_name: "BBM", settings: {} }]);
  const createInvoice = vi.fn(async () => ({ ok: true as const, data: { invoiceId: "INV-2", paymentUrl: "https://pay.test/INV-2", customerReference: ORDER_ID, raw: {} } }));
  const getPaymentStatus = vi.fn(async () => inquiry());
  const p = provider === null ? null : ({ name: "MYFATOORAH", createInvoice, getPaymentStatus, ...provider } as unknown as PaymentProvider);
  const deps: OrderPayDeps = { supabase: db.asClient(), now: () => NOW, log: createLogger({ test: true }), provider: p, enabled: p !== null, siteUrl: SITE };
  return { db, deps, createInvoice, getPaymentStatus };
}

const theOrder = (db: FakeSupabase) => db.tables.photo_orders[0];

describe("order pay page — token lookup and view", () => {
  it("resolves only the exact token and shows reference, items and amount without provider or e-mail details", async () => {
    const { deps } = setup();
    const out = await loadOrderPay(TOKEN, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.studioName).toBe("BBM");
    expect(out.view).toMatchObject({ reference: "PT-1", customerFirstName: "Buyer", amountQr: 120, currency: "QAR", state: "payable", payable: true, items: [{ name: "Match 3 photo set", quantity: 2 }] });
    expect(JSON.stringify(out.view)).not.toMatch(/example\.com|INV-1|myfatoorah|pay\.test/i);
    expect(await loadOrderPay("bbo_" + "x".repeat(40), deps)).toEqual({ ok: false, error: "not_found" });
    expect(await loadOrderPay("bbp_" + "x".repeat(40), deps)).toEqual({ ok: false, error: "not_found" });
    expect(await loadOrderPay("", deps)).toEqual({ ok: false, error: "not_found" });
  });

  it("states: paid, refunded, cancelled, expired link, payments off, failed attempt", () => {
    const base = orderRow();
    expect(orderPayView({ ...base, payment_state: "paid", paid_at: NOW.toISOString() }, true, false)).toMatchObject({ state: "paid", payable: false, paidAt: NOW.toISOString() });
    expect(orderPayView({ ...base, payment_state: "refunded" }, true, false).state).toBe("refunded");
    expect(orderPayView({ ...base, status: "cancelled" }, true, false)).toMatchObject({ state: "cancelled", payable: false });
    expect(orderPayView(base, true, true)).toMatchObject({ state: "expired", payable: false });
    expect(orderPayView(base, false, false)).toMatchObject({ state: "payments_off", payable: false });
    expect(orderPayView({ ...base, payment_state: "failed" }, true, false)).toMatchObject({ state: "failed", payable: true });
    // A paid order never looks expired, whatever the token's age.
    expect(orderPayView({ ...base, payment_state: "paid" }, true, true).state).toBe("paid");
  });
});

describe("startOrderHostedPayment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses the live invoice's hosted page", async () => {
    const { deps, createInvoice, getPaymentStatus } = setup();
    expect(await startOrderHostedPayment(TOKEN, deps)).toEqual({ ok: true, redirectUrl: "https://pay.test/INV-1", invoiceId: "INV-1" });
    expect(getPaymentStatus).toHaveBeenCalledTimes(1);
    expect(createInvoice).not.toHaveBeenCalled();
  });

  it("replaces an expired or cancelled invoice with a fresh one and remembers the old id", async () => {
    const { deps, db, createInvoice, getPaymentStatus } = setup();
    getPaymentStatus.mockResolvedValueOnce(inquiry({ invoiceStatus: "Expired" }));
    const out = await startOrderHostedPayment(TOKEN, deps);
    expect(out).toEqual({ ok: true, redirectUrl: "https://pay.test/INV-2", invoiceId: "INV-2" });
    expect(createInvoice).toHaveBeenCalledTimes(1);
    const o = theOrder(db);
    expect(o.provider_invoice_id).toBe("INV-2");
    expect((o.metadata as Record<string, unknown>).superseded_invoices).toEqual(["INV-1"]);
    // Our private page stays the payment_url; the provider page lives in metadata.
    expect(o.payment_url).toBe(orderPayPageUrl(SITE, TOKEN));
    const audit = db.tables.photo_audit_log?.find((a) => a.action === "payment.session_started");
    expect(audit).toMatchObject({ actor_kind: "client" });
  });

  it("finds the order already paid at the provider and marks it paid instead of charging again", async () => {
    const { deps, db, createInvoice, getPaymentStatus } = setup();
    getPaymentStatus.mockResolvedValueOnce(inquiry({ invoiceStatus: "Paid", transactions: [{ status: "SUCCSS", paymentId: "P-1", currency: "QAR" }] }));
    expect(await startOrderHostedPayment(TOKEN, deps)).toEqual({ ok: false, error: "paid" });
    expect(theOrder(db).payment_state).toBe("paid");
    expect(createInvoice).not.toHaveBeenCalled();
    expect(db.tables.photo_payment_records).toHaveLength(1);
  });

  it("never starts a payment for paid, cancelled, refunded or expired-link orders, or with payments off", async () => {
    expect(await startOrderHostedPayment(TOKEN, setup({ payment_state: "paid" }).deps)).toEqual({ ok: false, error: "paid" });
    expect(await startOrderHostedPayment(TOKEN, setup({ status: "cancelled" }).deps)).toEqual({ ok: false, error: "not_payable" });
    expect(await startOrderHostedPayment(TOKEN, setup({ payment_state: "refunded" }).deps)).toEqual({ ok: false, error: "not_payable" });
    expect(await startOrderHostedPayment(TOKEN, setup({ pay_token_created_at: "2026-01-01T00:00:00.000Z" }).deps)).toEqual({ ok: false, error: "expired" });
    expect(await startOrderHostedPayment(TOKEN, setup({}, null).deps)).toEqual({ ok: false, error: "payments_off" });
    expect(await startOrderHostedPayment("bbo_" + "y".repeat(40), setup().deps)).toEqual({ ok: false, error: "not_found" });
  });

  it("when the provider cannot be asked, falls back to the known hosted page rather than creating a duplicate", async () => {
    const { deps, createInvoice, getPaymentStatus } = setup();
    getPaymentStatus.mockResolvedValueOnce({ ok: false, error: { code: "timeout", message: "x" } } as never);
    expect(await startOrderHostedPayment(TOKEN, deps)).toEqual({ ok: true, redirectUrl: "https://pay.test/INV-1", invoiceId: "INV-1" });
    expect(createInvoice).not.toHaveBeenCalled();
  });
});

describe("verifyReturnedOrderPayment — the redirect proves nothing", () => {
  it("marks paid only when the provider confirms a successful payment of THIS order's invoice for the right amount", async () => {
    const { deps, db, getPaymentStatus } = setup();
    getPaymentStatus.mockResolvedValueOnce(inquiry({ invoiceStatus: "Paid", transactions: [{ status: "SUCCSS", paymentId: "P-9", currency: "QAR" }] }));
    expect(await verifyReturnedOrderPayment(TOKEN, "P-9", deps)).toEqual({ status: "paid" });
    expect(theOrder(db)).toMatchObject({ payment_state: "paid" });
    expect((theOrder(db).metadata as Record<string, unknown>).payment_verified).toMatchObject({ invoice_id: "INV-1", payment_id: "P-9" });
    expect(db.tables.photo_notification_deliveries.filter((d) => d.alert_key === `order-payment:${ORDER_ID}:paid`)).toHaveLength(1);
    expect(db.tables.photo_notification_deliveries.filter((d) => d.kind === "ORDER_PAYMENT_RECEIVED")).toHaveLength(1);
    // Repeating the return visit is harmless.
    expect(await verifyReturnedOrderPayment(TOKEN, "P-9", deps)).toEqual({ status: "paid" });
    expect(db.tables.photo_payment_records).toHaveLength(1);
  });

  it("refuses a payment id that belongs to another invoice, a wrong amount, a wrong currency, and malformed ids", async () => {
    const { deps, db, getPaymentStatus } = setup();
    getPaymentStatus.mockResolvedValueOnce(inquiry({ invoiceId: "SOMEONE-ELSES", invoiceStatus: "Paid", transactions: [{ status: "SUCCSS", paymentId: "P-X", currency: "QAR" }] }));
    expect(await verifyReturnedOrderPayment(TOKEN, "P-X", deps)).toEqual({ status: "mismatch", detail: "invoice" });
    getPaymentStatus.mockResolvedValueOnce(inquiry({ invoiceStatus: "Paid", invoiceValue: 60, transactions: [{ status: "SUCCSS", paymentId: "P-H", currency: "QAR" }] }));
    expect(await verifyReturnedOrderPayment(TOKEN, "P-H", deps)).toMatchObject({ status: "mismatch", detail: expect.stringMatching(/amount 60 expected 120/) });
    getPaymentStatus.mockResolvedValueOnce(inquiry({ invoiceStatus: "Paid", transactions: [{ status: "SUCCSS", paymentId: "P-C", currency: "USD" }] }));
    expect(await verifyReturnedOrderPayment(TOKEN, "P-C", deps)).toMatchObject({ status: "mismatch", detail: expect.stringMatching(/currency USD/) });
    expect(theOrder(db).payment_state).toBe("pending");
    expect((theOrder(db).metadata as Record<string, unknown>).payment_mismatch).toBeTruthy();
    expect(await verifyReturnedOrderPayment(TOKEN, "../../etc", deps)).toEqual({ status: "invalid" });
    expect(await verifyReturnedOrderPayment("bbo_" + "z".repeat(40), "P-9", deps)).toEqual({ status: "invalid" });
  });

  it("a pending or failed answer leaves the order unpaid; a superseded invoice is still recognised", async () => {
    const { deps, db, getPaymentStatus } = setup({ metadata: { invoice: { provider_payment_url: "https://pay.test/INV-1" }, superseded_invoices: ["INV-0"] } });
    getPaymentStatus.mockResolvedValueOnce(inquiry({ invoiceStatus: "Pending" }));
    expect(await verifyReturnedOrderPayment(TOKEN, "P-P", deps)).toEqual({ status: "pending" });
    getPaymentStatus.mockResolvedValueOnce(inquiry({ invoiceStatus: "Pending", transactions: [{ status: "FAILED", paymentId: "P-F", currency: "QAR" }] }));
    expect(await verifyReturnedOrderPayment(TOKEN, "P-F", deps)).toEqual({ status: "failed" });
    expect(theOrder(db).payment_state).toBe("failed");
    getPaymentStatus.mockResolvedValueOnce(inquiry({ invoiceId: "INV-0", invoiceStatus: "Paid", transactions: [{ status: "SUCCSS", paymentId: "P-OLD", currency: "QAR" }] }));
    expect(await verifyReturnedOrderPayment(TOKEN, "P-OLD", deps)).toEqual({ status: "paid" });
    expect(theOrder(db)).toMatchObject({ payment_state: "paid", provider_invoice_id: "INV-0" });
  });
});
