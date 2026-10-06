import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import { processWebhook, replayUnmatchedEvents, type WebhookDeps } from "@/lib/payments/myfatoorah/webhook";
import type { PhotoOrderRow } from "@/lib/supabase/database.types";
import { FakeSupabase } from "./fake-supabase";
import { OWNER, paymentEvent, refundEvent } from "./fixtures";

vi.mock("server-only", () => ({}));
setLogSink(() => {});

const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const ORDER_INVOICE = "ORDER-INV-1";

function order(overrides: Partial<PhotoOrderRow> = {}): PhotoOrderRow {
  return {
    id: ORDER_ID, owner_id: OWNER, pictime_order_id: "PT-7", customer_name: "Order Buyer", customer_email: "ob@example.com", customer_phone: null,
    gallery_name: "Qatar Masters", amount_qr: 150, currency: "QAR", status: "placed", provider: "MYFATOORAH", provider_invoice_id: ORDER_INVOICE,
    payment_url: "https://pay.test/ORDER-INV-1", paid_at: null, approved_in_pictime_at: null, metadata: {}, source: "pictime", external_ref: "PT-7",
    payment_method: "fawran", payment_state: "pending", payment_reference: null, payment_reported_state: null, items: [], placed_at: null,
    received_at: "2026-10-02T10:00:00.000Z", buyer_note: null, athlete_name_hint: null, raw: {}, payment_confirmed_at: null, payment_confirmed_by: null,
    fulfilled_at: null, created_at: "2026-10-02T10:00:00.000Z", updated_at: "2026-10-02T10:00:00.000Z", ...overrides,
  };
}

function setup(seedOrders: PhotoOrderRow[] = [order()]) {
  const db = new FakeSupabase();
  db.seed("photo_orders", seedOrders as unknown as Record<string, unknown>[]);
  let t = Date.parse("2026-10-03T12:00:00.000Z");
  const deps: WebhookDeps = { supabase: db.asClient(), now: () => new Date((t += 1000)), log: createLogger({ test: true }) };
  return { db, deps };
}

const orderRow = (db: FakeSupabase) => db.tables.photo_orders.find((o) => o.id === ORDER_ID)!;

describe("processWebhook — order-linked invoice", () => {
  let db: FakeSupabase;
  let deps: WebhookDeps;
  beforeEach(() => ({ db, deps } = setup()));

  it("marks the Pic-Time order paid and enqueues the owner confirmation", async () => {
    const out = await processWebhook({ body: paymentEvent({ invoiceId: ORDER_INVOICE, reference: "WH-ORD-1" }), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "processed", bookingId: null, status: "paid" });

    const o = orderRow(db);
    expect(o.payment_state).toBe("paid");
    expect(o.paid_at).toBeTruthy();
    expect(o.payment_confirmed_by).toBe("MYFATOORAH");

    // The event row links to the order, not a booking.
    const ev = db.tables.photo_payment_events[0];
    expect(ev).toMatchObject({ order_id: ORDER_ID, booking_id: null, owner_id: OWNER, processing_result: "processed" });

    // Owner [Orders] confirmation enqueued (an owner notice, never the customer).
    const deliveries = db.tables.photo_notification_deliveries.filter((d) => d.alert_key === `order-payment:${ORDER_ID}:paid`);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ owner_id: OWNER, kind: "PAYMENT_CONFIRMED", status: "pending" });
  });

  it("is idempotent: a redelivered paid event is a duplicate and enqueues nothing new", async () => {
    await processWebhook({ body: paymentEvent({ invoiceId: ORDER_INVOICE, reference: "WH-ORD-1" }), signatureValid: true }, deps);
    const out2 = await processWebhook({ body: paymentEvent({ invoiceId: ORDER_INVOICE, reference: "WH-ORD-1" }), signatureValid: true }, deps);
    expect(out2.result).toBe("duplicate");
    expect(db.tables.photo_notification_deliveries.filter((d) => d.alert_key === `order-payment:${ORDER_ID}:paid`)).toHaveLength(1);
    expect(db.tables.photo_payment_events).toHaveLength(1);
  });

  it("marks the order refunded without a confirmation notice", async () => {
    const { db, deps } = setup([order({ payment_state: "paid", paid_at: "2026-10-02T11:00:00.000Z" })]);
    const out = await processWebhook({ body: refundEvent({ invoiceId: ORDER_INVOICE, reference: "WH-ORD-REF" }), signatureValid: true }, deps);
    expect(out.result).toBe("processed");
    expect(orderRow(db).payment_state).toBe("refunded");
    expect(db.tables.photo_notification_deliveries).toHaveLength(0);
  });

  it("falls back to booking_not_found when no order or booking carries the invoice", async () => {
    const out = await processWebhook({ body: paymentEvent({ invoiceId: "UNKNOWN-INV", reference: "WH-ORD-X" }), signatureValid: true }, deps);
    expect(out.result).toBe("booking_not_found");
    expect(orderRow(db).payment_state).toBe("pending");
  });
});

describe("replayUnmatchedEvents — order path", () => {
  it("resolves a previously-unmatched event to an order that now carries the invoice", async () => {
    const { db, deps } = setup();
    // An event that arrived before the order was invoiced, parked as booking_not_found.
    db.seed("photo_payment_events", [{
      id: 900, provider: "MYFATOORAH", provider_event_id: "WH-REPLAY-1", event_type: "PAYMENT_STATUS_CHANGED",
      payload: paymentEvent({ invoiceId: ORDER_INVOICE, reference: "WH-REPLAY-1" }), signature_valid: true,
      processing_result: "booking_not_found", processed_at: null, attempts: 1, received_at: "2026-10-03T11:00:00.000Z", order_id: null, booking_id: null, owner_id: null,
    }]);
    const out = await replayUnmatchedEvents(deps);
    expect(out).toMatchObject({ scanned: 1, applied: 1 });
    expect(orderRow(db).payment_state).toBe("paid");
    const ev = db.tables.photo_payment_events.find((e) => e.id === 900)!;
    expect(ev).toMatchObject({ order_id: ORDER_ID, processing_result: "processed" });
  });
});
