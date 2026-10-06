import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import type { PaymentProvider, PaymentStatusOutput } from "@/lib/payments/myfatoorah/client";
import { processWebhook, reconcilePendingBookings, replayUnmatchedEvents, type WebhookDeps } from "@/lib/payments/myfatoorah/webhook";
import { fulfillmentProvider, FULFILLMENT_DEPENDENCY, isFulfillmentAvailable } from "@/lib/payments/fulfillment";
import { FakeSupabase } from "./fake-supabase";
import { BOOKING_ID, INVOICE_ID, OWNER, PAYMENT_ID, booking, paymentEvent } from "./fixtures";

vi.mock("server-only", () => ({}));
setLogSink(() => {});

const OTHER_OWNER = "99999999-9999-4999-8999-999999999999";
const OTHER_BOOKING = "88888888-8888-4888-8888-888888888888";
const OTHER_INVOICE = "7700001";

function setup(seed = [booking()]) {
  const db = new FakeSupabase();
  db.seed("photo_bookings", seed);
  let t = Date.parse("2026-10-02T12:00:00.000Z");
  const deps: WebhookDeps = { supabase: db.asClient(), now: () => new Date((t += 1000)), log: createLogger({ test: true }) };
  return { db, deps };
}
const row = (db: FakeSupabase, id = BOOKING_ID) => db.tables.photo_bookings.find((b) => b.id === id)!;

describe("payment regressions (Phase F)", () => {
  let db: FakeSupabase;
  let deps: WebhookDeps;
  beforeEach(() => ({ db, deps } = setup()));

  it("invalid-before-valid: an unsigned copy of an event never shadows the real signed delivery", async () => {
    const first = await processWebhook({ body: paymentEvent(), signatureValid: false }, deps);
    expect(first.result).toBe("invalid_signature");
    expect(row(db).status).toBe("pending");

    const second = await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(second).toMatchObject({ result: "processed", status: "paid", bookingId: BOOKING_ID });
    expect(row(db).status).toBe("paid");
    expect(db.tables.photo_payment_events).toHaveLength(1);
    expect(db.tables.photo_payment_events[0]).toMatchObject({ signature_valid: true, processing_result: "processed", attempts: 2, booking_id: BOOKING_ID });

    // And a third, unsigned, copy after that is just a duplicate.
    expect((await processWebhook({ body: paymentEvent(), signatureValid: false }, deps)).result).toBe("duplicate");
    expect(row(db).status).toBe("paid");
  });

  it("failed-then-success: the customer's retry on the same invoice ends paid, with both attempts recorded", async () => {
    expect(await processWebhook({ body: paymentEvent({ reference: "WH-f1", transactionStatus: "FAILED", paymentId: "p-fail" }), signatureValid: true }, deps)).toMatchObject({ result: "processed", status: "failed" });
    expect(row(db).status).toBe("failed");
    expect(await processWebhook({ body: paymentEvent({ reference: "WH-s1", transactionStatus: "SUCCESS", paymentId: "p-ok" }), signatureValid: true }, deps)).toMatchObject({ result: "processed", status: "paid" });
    expect(row(db).status).toBe("paid");
    expect(row(db).paid_at).toBeTruthy();
    expect(db.tables.photo_payment_attempts.map((a) => [a.status, a.provider_payment_id])).toEqual([["failed", "p-fail"], ["paid", "p-ok"]]);
  });

  it("late failure after paid: an out-of-order FAILED never regresses a paid booking", async () => {
    await processWebhook({ body: paymentEvent({ reference: "WH-ok", paymentId: "p-ok" }), signatureValid: true }, deps);
    const paidAt = row(db).paid_at;
    const late = await processWebhook({ body: paymentEvent({ reference: "WH-late", transactionStatus: "FAILED", paymentId: "p-late" }), signatureValid: true }, deps);
    expect(late).toMatchObject({ result: "ignored_transition", status: "paid", detail: "paid->failed" });
    expect(row(db)).toMatchObject({ status: "paid", paid_at: paidAt });
    expect(db.tables.photo_payment_attempts).toHaveLength(1);
    expect(db.tables.photo_payment_events.at(-1)?.processing_result).toBe("ignored_transition:paid->failed");
  });

  it("signature validity is not payment: a signed event whose transaction FAILED marks failed, not paid", async () => {
    const out = await processWebhook({ body: paymentEvent({ invoiceStatus: "PAID", transactionStatus: "FAILED" }), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "processed", status: "failed" });
    expect(row(db).status).toBe("failed");
    expect(row(db).paid_at).toBeNull();
    expect(db.tables.photo_notification_deliveries).toHaveLength(0);
  });

  it("invoice not associated yet: the verified event is kept and applied by the confirmation job once the booking exists", async () => {
    ({ db, deps } = setup([]));
    expect(await processWebhook({ body: paymentEvent(), signatureValid: true }, deps)).toMatchObject({ result: "booking_not_found", bookingId: null });
    expect(db.tables.photo_payment_attempts).toHaveLength(0);
    expect((await replayUnmatchedEvents(deps))).toEqual({ scanned: 1, applied: 0, abandoned: 0 }); // still no booking

    db.seed("photo_bookings", [booking()]);
    expect(await replayUnmatchedEvents(deps)).toEqual({ scanned: 1, applied: 1, abandoned: 0 });
    expect(row(db).status).toBe("paid");
    expect(db.tables.photo_payment_events[0]).toMatchObject({ processing_result: "processed", booking_id: BOOKING_ID, owner_id: OWNER });
    expect(await replayUnmatchedEvents(deps)).toEqual({ scanned: 0, applied: 0, abandoned: 0 });
  });

  it("retires unmatched events older than the age window as abandoned, so they stop being re-scanned forever", async () => {
    ({ db, deps } = setup([]));
    db.seed("photo_payment_events", [
      { id: 1, provider: "MYFATOORAH", provider_event_id: "stale-1", event_type: "PAYMENT_STATUS_CHANGED", signature_valid: true, processing_result: "booking_not_found", received_at: "2026-09-01T00:00:00.000Z", payload: {} },
    ]);
    const res = await replayUnmatchedEvents(deps);
    expect(res).toMatchObject({ scanned: 0, applied: 0, abandoned: 1 });
    expect(db.tables.photo_payment_events[0].processing_result).toBe("abandoned");
    // A later tick neither scans nor re-abandons it.
    expect(await replayUnmatchedEvents(deps)).toEqual({ scanned: 0, applied: 0, abandoned: 0 });
  });

  it("reconcile stops polling invoices older than the age window (scanned none, so no provider call)", async () => {
    // Beyond the window the booking is not even selected, so the provider stub
    // is never reached; scanned === 0 is the proof.
    const provider = { name: "MYFATOORAH" } as unknown as PaymentProvider;
    ({ db, deps } = setup([]));
    db.seed("photo_bookings", [
      { id: BOOKING_ID, owner_id: OWNER, provider: "MYFATOORAH", provider_invoice_id: "old-inv", status: "pending", created_at: "2026-09-01T00:00:00.000Z", amount_qr: 100, currency: "QAR", customer_name: "A", package_name: "P" },
    ]);
    const out = await reconcilePendingBookings(provider, deps, { olderThanMinutes: 10 });
    expect(out.scanned).toBe(0);
  });

  it("isolation: an event for owner B's invoice never touches owner A's booking, and every row carries B's owner id", async () => {
    ({ db, deps } = setup([booking(), booking({ id: OTHER_BOOKING, owner_id: OTHER_OWNER, provider_invoice_id: OTHER_INVOICE, customer_name: "Other" })]));
    const out = await processWebhook({ body: paymentEvent({ invoiceId: OTHER_INVOICE, paymentId: "p-other" }), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "processed", bookingId: OTHER_BOOKING });
    expect(row(db, BOOKING_ID).status).toBe("pending");
    expect(row(db, OTHER_BOOKING).status).toBe("paid");
    expect(db.tables.photo_payment_attempts).toEqual([expect.objectContaining({ owner_id: OTHER_OWNER, booking_id: OTHER_BOOKING })]);
    expect(db.tables.photo_payment_events[0]).toMatchObject({ owner_id: OTHER_OWNER, booking_id: OTHER_BOOKING });
    expect(db.tables.photo_notification_deliveries).toEqual([expect.objectContaining({ owner_id: OTHER_OWNER, alert_key: `payment:${OTHER_BOOKING}:paid` })]);
  });

  it("atomic paid transition: booking, attempt, event outcome and the [Orders] confirmation outbox come from ONE rpc call", async () => {
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    const rpc = db.rpcCalls.filter((c) => c.name === "photo_apply_payment_transition");
    expect(rpc).toHaveLength(1);
    expect(rpc[0].args).toMatchObject({ p_booking_id: BOOKING_ID, p_expected_status: "pending", p_processing_result: "processed" });
    expect(rpc[0].args.p_event_row_id).toBe(db.tables.photo_payment_events[0].id);
    expect((rpc[0].args.p_attempt as Record<string, unknown>).provider_payment_id).toBe(PAYMENT_ID);
    const delivery = db.tables.photo_notification_deliveries[0];
    expect(delivery).toMatchObject({ owner_id: OWNER, kind: "PAYMENT_CONFIRMED", category: "orders", alert_key: `payment:${BOOKING_ID}:paid` });
    expect(String((delivery.payload as Record<string, unknown>).text)).toContain("Payment confirmed — Test Customer");
    expect(String((delivery.payload as Record<string, unknown>).text)).toContain("Approve the order in Pic-Time by hand");
    // No direct, non-atomic booking writes besides the athlete-link flag stub.
    expect(db.calls.filter((c) => c.table === "photo_bookings" && c.op === "update")).toHaveLength(0);
    expect(db.tables.photo_athletes).toHaveLength(0);
  });

  it("fulfilment ships disabled and names its dependency; a paid booking is flagged for manual approval", async () => {
    expect(isFulfillmentAvailable()).toBe(false);
    expect(fulfillmentProvider()).toBeNull();
    expect(FULFILLMENT_DEPENDENCY).toMatch(/Pic-Time/);
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(row(db).metadata).toMatchObject({ fulfillment: { state: "manual", dependency: FULFILLMENT_DEPENDENCY } });
  });

  it("confirmation job reconciles only old pending/failed bookings with an invoice, via one provider call each", async () => {
    const old = booking({ created_at: "2026-10-01T00:00:00.000Z" });
    const fresh = booking({ id: OTHER_BOOKING, provider_invoice_id: OTHER_INVOICE, created_at: "2026-10-02T11:59:30.000Z" });
    const noInvoice = booking({ id: "77777777-7777-4777-8777-777777777777", provider_invoice_id: null, created_at: "2026-10-01T00:00:00.000Z" });
    ({ db, deps } = setup([old, fresh, noInvoice]));
    const inquiry: PaymentStatusOutput = { invoiceId: INVOICE_ID, invoiceStatus: "Paid", invoiceReference: "r", customerReference: BOOKING_ID, invoiceValue: 350, transactions: [{ paymentId: PAYMENT_ID, transactionId: "1", status: "Succss", value: 350, currency: "QAR", transactionDate: "", errorCode: "", error: null, raw: {} }], raw: {} };
    const provider: PaymentProvider = { name: "MYFATOORAH", createInvoice: async () => ({ ok: false, error: { code: "not_configured", message: "n/a" } }), getPaymentStatus: vi.fn(async () => ({ ok: true as const, data: inquiry })) };
    const out = await reconcilePendingBookings(provider, deps, { olderThanMinutes: 10 });
    expect(out.scanned).toBe(1);
    expect(out.changed).toBe(1);
    expect(provider.getPaymentStatus).toHaveBeenCalledTimes(1);
    expect(row(db).status).toBe("paid");
    expect(row(db, OTHER_BOOKING).status).toBe("pending");
  });
});
