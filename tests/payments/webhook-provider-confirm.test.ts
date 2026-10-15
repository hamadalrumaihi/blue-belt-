import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import type { PaymentProvider, PaymentStatusOutput } from "@/lib/payments/myfatoorah/client";
import { confirmPaidMapping, mapWebhookEvent, processWebhook, type WebhookDeps } from "@/lib/payments/myfatoorah/webhook";
import { FakeSupabase } from "./fake-supabase";
import { BOOKING_ID, INVOICE_ID, PAYMENT_ID, booking, paymentEvent } from "./fixtures";

vi.mock("server-only", () => ({}));

/**
 * SECURITY-REGISTER F-04: the Webhook V2 signature covers the ids and statuses
 * but not Amount.*, so a signed "paid" delivery is confirmed with
 * GetPaymentStatus before anything is marked paid. The provider's answer wins.
 */
const logLines: Array<{ msg: string; data: Record<string, unknown> }> = [];
// The sink receives (level, jsonLine); keep the parsed record for assertions.
setLogSink((_level, line) => {
  const record = JSON.parse(line) as Record<string, unknown>;
  logLines.push({ msg: String(record.msg ?? ""), data: record });
});

function inquiry(overrides: Partial<PaymentStatusOutput> = {}): PaymentStatusOutput {
  return {
    invoiceId: INVOICE_ID,
    invoiceStatus: "Paid",
    invoiceReference: "2026000073",
    customerReference: BOOKING_ID,
    invoiceValue: 350,
    transactions: [{ paymentId: PAYMENT_ID, transactionId: "86781", status: "Succss", value: 350, currency: "QAR", transactionDate: "2026-01-04T08:15:00Z", errorCode: null, error: null, raw: {} }],
    raw: {},
    ...overrides,
  };
}

function setup() {
  const db = new FakeSupabase();
  db.seed("photo_bookings", [booking()]);
  const getPaymentStatus = vi.fn();
  const provider = { name: "MYFATOORAH", createInvoice: vi.fn(), getPaymentStatus } as unknown as PaymentProvider;
  let t = Date.parse("2026-10-02T12:00:00.000Z");
  const deps: WebhookDeps = { supabase: db.asClient(), now: () => new Date((t += 1000)), log: createLogger({ test: true }), provider };
  return { db, deps, getPaymentStatus };
}

const bookingRow = (db: FakeSupabase) => db.tables.photo_bookings.find((b) => b.id === BOOKING_ID)!;

describe("confirmPaidMapping", () => {
  beforeEach(() => logLines.splice(0));

  it("is skipped without a provider and for non-paid mappings", async () => {
    const { deps, getPaymentStatus } = setup();
    const paid = mapWebhookEvent("PAYMENT_STATUS_CHANGED", paymentEvent().Data as Record<string, unknown>);
    expect(paid.kind).toBe("apply");
    const noProvider = await confirmPaidMapping(paid as Extract<typeof paid, { kind: "apply" }>, { ...deps, provider: undefined });
    expect(noProvider.confirmation).toBe("skipped");
    const failed = mapWebhookEvent("PAYMENT_STATUS_CHANGED", paymentEvent({ transactionStatus: "FAILED" }).Data as Record<string, unknown>);
    const notPaid = await confirmPaidMapping(failed as Extract<typeof failed, { kind: "apply" }>, deps);
    expect(notPaid.confirmation).toBe("skipped");
    expect(getPaymentStatus).not.toHaveBeenCalled();
  });

  it("asks the provider by invoice id and takes its amount and currency", async () => {
    const { deps, getPaymentStatus } = setup();
    getPaymentStatus.mockResolvedValue({ ok: true, data: inquiry({ invoiceValue: 349.99, transactions: [{ ...inquiry().transactions[0], currency: "qar" }] }) });
    const paid = mapWebhookEvent("PAYMENT_STATUS_CHANGED", paymentEvent().Data as Record<string, unknown>) as Extract<ReturnType<typeof mapWebhookEvent>, { kind: "apply" }>;
    const out = await confirmPaidMapping(paid, deps);
    expect(getPaymentStatus).toHaveBeenCalledWith({ key: INVOICE_ID, keyType: "InvoiceId" });
    expect(out.confirmation).toBe("confirmed");
    expect(out.mapping).toMatchObject({ kind: "apply", status: "paid", invoiceId: INVOICE_ID, amount: 349.99, currency: "qar", paymentId: PAYMENT_ID });
  });
});

describe("processWebhook with provider confirmation", () => {
  beforeEach(() => logLines.splice(0));

  it("marks the booking paid when the provider agrees on status and amount", async () => {
    const { db, deps, getPaymentStatus } = setup();
    getPaymentStatus.mockResolvedValue({ ok: true, data: inquiry() });
    const out = await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "processed", status: "paid", bookingId: BOOKING_ID });
    expect(getPaymentStatus).toHaveBeenCalledTimes(1);
    expect(bookingRow(db).status).toBe("paid");
    expect(logLines.some((l) => l.msg === "payments.provider_confirmed")).toBe(true);
  });

  it("refuses to mark paid when the provider reports a different amount than the webhook claimed", async () => {
    const { db, deps } = setup();
    deps.provider!.getPaymentStatus = vi.fn().mockResolvedValue({ ok: true, data: inquiry({ invoiceValue: 100, transactions: [{ ...inquiry().transactions[0], value: 100 }] }) });
    const out = await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "amount_mismatch", bookingId: BOOKING_ID });
    const b = bookingRow(db);
    expect(b.status).toBe("pending");
    expect((b.metadata as Record<string, Record<string, unknown>>).payment_mismatch).toMatchObject({ amount: 100, expected: 350, invoice_id: INVOICE_ID });
    expect(db.tables.photo_payment_events[0].processing_result).toMatch(/^amount_mismatch/);
  });

  it("does not mark paid when the provider says the invoice is still pending", async () => {
    const { db, deps } = setup();
    deps.provider!.getPaymentStatus = vi.fn().mockResolvedValue({ ok: true, data: inquiry({ invoiceStatus: "Pending", transactions: [] }) });
    const out = await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "ignored_event", detail: "provider:invoice_status:PENDING" });
    expect(bookingRow(db).status).toBe("pending");
    expect(logLines.some((l) => l.msg === "payments.provider_overrode_webhook")).toBe(true);
  });

  it("applies the provider's status when it disagrees with the webhook (cancelled instead of paid)", async () => {
    const { db, deps } = setup();
    deps.provider!.getPaymentStatus = vi.fn().mockResolvedValue({ ok: true, data: inquiry({ invoiceStatus: "Canceled", transactions: [] }) });
    const out = await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "processed", status: "cancelled" });
    expect(bookingRow(db).status).toBe("cancelled");
  });

  it("falls back to the signed webhook when the provider cannot be reached, and says so in the log", async () => {
    const { db, deps } = setup();
    deps.provider!.getPaymentStatus = vi.fn().mockResolvedValue({ ok: false, error: { code: "network", message: "timeout" } });
    const out = await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "processed", status: "paid" });
    expect(bookingRow(db).status).toBe("paid");
    const warn = logLines.find((l) => l.msg === "payments.provider_confirm_unavailable");
    expect(warn).toBeTruthy();
    expect(JSON.stringify(warn)).not.toContain("timeout-secret");
  });

  it("never calls the provider for an unsigned delivery", async () => {
    const { deps, getPaymentStatus } = setup();
    const out = await processWebhook({ body: paymentEvent(), signatureValid: false }, deps);
    expect(out.result).toBe("invalid_signature");
    expect(getPaymentStatus).not.toHaveBeenCalled();
  });
});
