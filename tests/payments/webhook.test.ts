import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import type { PaymentProvider, PaymentStatusOutput, ProviderResult } from "@/lib/payments/myfatoorah/client";
import { linkBookingToAthlete, mapInquiry, processWebhook, providerEventIdOf, reconcileBooking, type WebhookDeps } from "@/lib/payments/myfatoorah/webhook";
import { FakeSupabase } from "./fake-supabase";
import { BOOKING_ID, INVOICE_ID, PAYMENT_ID, booking, disputeEvent, paymentEvent, refundEvent } from "./fixtures";

vi.mock("server-only", () => ({}));

setLogSink(() => {});

function setup(seed = [booking()]) {
  const db = new FakeSupabase();
  db.seed("photo_bookings", seed);
  let t = Date.parse("2026-10-02T12:00:00.000Z");
  const deps: WebhookDeps = { supabase: db.asClient(), now: () => new Date((t += 1000)), log: createLogger({ test: true }) };
  return { db, deps };
}

const bookingRow = (db: FakeSupabase) => db.tables.photo_bookings.find((b) => b.id === BOOKING_ID)!;

describe("processWebhook", () => {
  let db: FakeSupabase;
  let deps: WebhookDeps;
  beforeEach(() => ({ db, deps } = setup()));

  it("marks a pending booking paid, writes an attempt row and the delivery row", async () => {
    const out = await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "processed", eventId: "WH-626519", eventType: "PAYMENT_STATUS_CHANGED", bookingId: BOOKING_ID, status: "paid" });

    const b = bookingRow(db);
    expect(b.status).toBe("paid");
    expect(b.paid_at).toBeTruthy();
    expect(b.payment_status_updated_at).toBeTruthy();

    expect(db.tables.photo_payment_attempts).toHaveLength(1);
    expect(db.tables.photo_payment_attempts[0]).toMatchObject({ booking_id: BOOKING_ID, provider: "MYFATOORAH", provider_invoice_id: INVOICE_ID, provider_payment_id: PAYMENT_ID, status: "paid", amount: 350, currency: "QAR" });

    expect(db.tables.photo_payment_events).toHaveLength(1);
    expect(db.tables.photo_payment_events[0]).toMatchObject({ provider_event_id: "WH-626519", signature_valid: true, processing_result: "processed", booking_id: BOOKING_ID, attempts: 1 });
    expect(db.tables.photo_payment_events[0].processed_at).toBeTruthy();
  });

  it("is idempotent: a redelivered Event.Reference increments attempts and re-applies nothing", async () => {
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    const paidAt = bookingRow(db).paid_at;
    const attempts = db.tables.photo_payment_attempts.length;

    const again = await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(again).toMatchObject({ result: "duplicate", eventId: "WH-626519", bookingId: BOOKING_ID });
    expect(db.tables.photo_payment_events).toHaveLength(1);
    expect(db.tables.photo_payment_events[0].attempts).toBe(2);
    expect(db.tables.photo_payment_attempts).toHaveLength(attempts);
    expect(bookingRow(db).paid_at).toBe(paidAt);
    // The duplicate path never touched bookings (the first delivery's transition went through the atomic RPC).
    expect(db.rpcCalls.filter((c) => c.name === "photo_apply_payment_transition")).toHaveLength(1);
    expect(db.calls.filter((c) => c.table === "photo_bookings" && c.op === "update")).toHaveLength(0);
  });

  it("derives a deterministic event id when Event.Reference is absent", () => {
    const a = paymentEvent();
    const b = paymentEvent();
    delete (a.Event as Partial<typeof a.Event>).Reference;
    delete (b.Event as Partial<typeof b.Event>).Reference;
    expect(providerEventIdOf(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(providerEventIdOf(a)).toBe(providerEventIdOf(b));
    const c = paymentEvent({ transactionStatus: "FAILED" });
    delete (c.Event as Partial<typeof c.Event>).Reference;
    expect(providerEventIdOf(c)).not.toBe(providerEventIdOf(a));
  });

  it("stores an invalid-signature delivery without touching bookings", async () => {
    const out = await processWebhook({ body: paymentEvent(), signatureValid: false }, deps);
    expect(out).toMatchObject({ result: "invalid_signature", bookingId: null });
    expect(db.tables.photo_payment_events[0]).toMatchObject({ signature_valid: false, processing_result: "invalid_signature", booking_id: null });
    expect(bookingRow(db).status).toBe("pending");
    expect(db.tables.photo_payment_attempts).toHaveLength(0);
    expect(db.calls.some((c) => c.table === "photo_bookings")).toBe(false);
  });

  it("refund path: a paid booking becomes refunded with refunded_at", async () => {
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    const out = await processWebhook({ body: refundEvent(), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "processed", status: "refunded", bookingId: BOOKING_ID });
    const b = bookingRow(db);
    expect(b.status).toBe("refunded");
    expect(b.refunded_at).toBeTruthy();
    expect(b.paid_at).toBeTruthy();
    expect(db.tables.photo_payment_attempts.at(-1)).toMatchObject({ status: "refunded", provider_payment_id: "refund:111147", amount: 350 });
  });

  it("ignores a cancelled refund (booking stays paid)", async () => {
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    const out = await processWebhook({ body: refundEvent({ reference: "WH-2", status: "CANCELED" }), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "ignored_event", detail: "refund_status:CANCELED" });
    expect(bookingRow(db).status).toBe("paid");
  });

  it("dispute path: paid -> disputed -> paid keeps the original paid_at", async () => {
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    const paidAt = bookingRow(db).paid_at;
    expect(await processWebhook({ body: disputeEvent(), signatureValid: true }, deps)).toMatchObject({ result: "processed", status: "disputed" });
    expect(bookingRow(db).disputed_at).toBeTruthy();
    expect(await processWebhook({ body: disputeEvent({ reference: "WH-3", status: "RESOLVED" }), signatureValid: true }, deps)).toMatchObject({ result: "processed", status: "paid" });
    expect(bookingRow(db).paid_at).toBe(paidAt);
  });

  it("rejects an illegal transition (refund on a cancelled booking) as ignored_transition", async () => {
    ({ db, deps } = setup([booking({ status: "cancelled" })]));
    const out = await processWebhook({ body: refundEvent(), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "ignored_transition", status: "cancelled", detail: "cancelled->refunded" });
    expect(bookingRow(db).status).toBe("cancelled");
    expect(db.tables.photo_payment_attempts).toHaveLength(0);
    expect(db.tables.photo_payment_events[0].processing_result).toBe("ignored_transition:cancelled->refunded");
  });

  it("rejects a success event on an already refunded booking", async () => {
    ({ db, deps } = setup([booking({ status: "refunded", paid_at: "2026-09-01T00:00:00.000Z", refunded_at: "2026-09-02T00:00:00.000Z" })]));
    expect(await processWebhook({ body: paymentEvent(), signatureValid: true }, deps)).toMatchObject({ result: "ignored_transition" });
    expect(bookingRow(db).status).toBe("refunded");
  });

  it("reports unchanged for a second success event (the docs warn two events may arrive)", async () => {
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    const out = await processWebhook({ body: paymentEvent({ reference: "WH-other" }), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "unchanged", status: "paid" });
    expect(db.tables.photo_payment_attempts).toHaveLength(1);
  });

  it("maps FAILED / CANCELED transaction statuses and ignores AUTHORIZE", async () => {
    expect(await processWebhook({ body: paymentEvent({ transactionStatus: "FAILED", paymentId: "p1" }), signatureValid: true }, deps)).toMatchObject({ result: "processed", status: "failed" });
    ({ db, deps } = setup());
    expect(await processWebhook({ body: paymentEvent({ transactionStatus: "CANCELED", paymentId: "p2" }), signatureValid: true }, deps)).toMatchObject({ result: "processed", status: "cancelled" });
    ({ db, deps } = setup());
    expect(await processWebhook({ body: paymentEvent({ transactionStatus: "AUTHORIZE" }), signatureValid: true }, deps)).toMatchObject({ result: "ignored_event", detail: "transaction_status:AUTHORIZE" });
  });

  it("records booking_not_found for an unknown invoice and ignores unsupported events", async () => {
    expect(await processWebhook({ body: paymentEvent({ invoiceId: "000" }), signatureValid: true }, deps)).toMatchObject({ result: "booking_not_found", bookingId: null });
    expect(await processWebhook({ body: { Event: { Code: 3, Name: "BALANCE_TRANSFERRED", Reference: "WH-b" }, Data: {} }, signatureValid: true }, deps)).toMatchObject({ result: "ignored_event", detail: "unsupported_event" });
    expect(db.tables.photo_payment_events.map((e) => e.processing_result)).toEqual(["booking_not_found", "ignored_event:unsupported_event"]);
  });

  it("NEVER creates a photo_athletes row from a paid booking; it only flags pending_athlete_link", async () => {
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps);
    expect(db.tables.photo_athletes).toHaveLength(0);
    expect(db.calls.some((c) => c.table === "photo_athletes")).toBe(false);
    const b = bookingRow(db);
    expect(b.watcher_athlete_id).toBeNull();
    expect(b.metadata).toMatchObject({ pending_athlete_link: true, fulfillment: { state: "manual" } });
  });

  it("linkBookingToAthlete merges the flag into existing metadata and is a no-op when already set", async () => {
    ({ db, deps } = setup([booking({ metadata: { note: "keep" } })]));
    await linkBookingToAthlete(booking({ metadata: { note: "keep" } }), deps);
    expect(bookingRow(db).metadata).toEqual({ note: "keep", pending_athlete_link: true });
    const before = db.calls.length;
    await linkBookingToAthlete(booking({ metadata: { pending_athlete_link: true } }), deps);
    expect(db.calls.length).toBe(before);
    expect(db.tables.photo_athletes).toHaveLength(0);
  });
});

describe("reconcileBooking", () => {
  const inquiry = (overrides: Partial<PaymentStatusOutput> = {}): PaymentStatusOutput => ({
    invoiceId: INVOICE_ID,
    invoiceStatus: "Paid",
    invoiceReference: "2025051959",
    customerReference: BOOKING_ID,
    invoiceValue: 350,
    transactions: [{ paymentId: PAYMENT_ID, transactionId: "128633", status: "Succss", value: 350, currency: "QAR", transactionDate: "2026-10-02T11:00:00", errorCode: "", error: null, raw: {} }],
    raw: {},
    ...overrides,
  });
  const provider = (res: ProviderResult<PaymentStatusOutput>): PaymentProvider => ({
    name: "MYFATOORAH",
    createInvoice: async () => ({ ok: false, error: { code: "not_configured", message: "n/a" } }),
    getPaymentStatus: vi.fn(async () => res),
  });

  it("applies a Paid inquiry to a pending booking with the same transition rules", async () => {
    const { db, deps } = setup();
    const p = provider({ ok: true, data: inquiry() });
    const out = await reconcileBooking(BOOKING_ID, p, deps);
    expect(out).toMatchObject({ result: "processed", status: "paid", bookingId: BOOKING_ID });
    expect(p.getPaymentStatus).toHaveBeenCalledWith({ key: INVOICE_ID, keyType: "InvoiceId" });
    expect(db.tables.photo_bookings[0].status).toBe("paid");
    expect(db.tables.photo_payment_attempts[0]).toMatchObject({ provider_payment_id: PAYMENT_ID, status: "paid" });
    expect(db.tables.photo_athletes).toHaveLength(0);
  });

  it("is a no-op when the booking is already in the reported state", async () => {
    const { deps } = setup([booking({ status: "paid", paid_at: "2026-09-01T00:00:00.000Z" })]);
    expect(await reconcileBooking(BOOKING_ID, provider({ ok: true, data: inquiry() }), deps)).toMatchObject({ result: "unchanged", status: "paid" });
  });

  it("does not revive a refunded booking from a stale Paid inquiry", async () => {
    const { db, deps } = setup([booking({ status: "refunded" })]);
    expect(await reconcileBooking(BOOKING_ID, provider({ ok: true, data: inquiry() }), deps)).toMatchObject({ result: "ignored_transition" });
    expect(db.tables.photo_bookings[0].status).toBe("refunded");
  });

  it("surfaces provider errors and missing invoices without changing anything", async () => {
    const { db, deps } = setup();
    expect(await reconcileBooking(BOOKING_ID, provider({ ok: false, error: { code: "network", message: "down" } }), deps)).toMatchObject({ result: "provider_error", detail: "network" });
    expect(db.tables.photo_bookings[0].status).toBe("pending");
    const noInvoice = setup([booking({ provider_invoice_id: null })]);
    expect(await reconcileBooking(BOOKING_ID, provider({ ok: true, data: inquiry() }), noInvoice.deps)).toMatchObject({ result: "no_invoice" });
    expect(await reconcileBooking("missing", provider({ ok: true, data: inquiry() }), deps)).toMatchObject({ result: "booking_not_found" });
  });

  it("mapInquiry: Pending with only failed transactions -> failed; Pending with none -> ignore; Canceled -> cancelled", () => {
    expect(mapInquiry(inquiry({ invoiceStatus: "Pending", transactions: [{ ...inquiry().transactions[0], status: "Failed" }] }))).toMatchObject({ kind: "apply", status: "failed" });
    expect(mapInquiry(inquiry({ invoiceStatus: "Pending", transactions: [] }))).toMatchObject({ kind: "ignore" });
    expect(mapInquiry(inquiry({ invoiceStatus: "Canceled", transactions: [] }))).toMatchObject({ kind: "apply", status: "cancelled" });
  });
});
