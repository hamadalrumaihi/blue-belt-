import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } })) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(), isServiceClientConfigured: () => false }));

import { describeAudit, summariseToday, upcomingItems } from "@/lib/studio/dashboard";
import { inRange, monthRange, outstandingOf, summariseMoney } from "@/lib/payments/ledger";
import type { BookingListRow } from "@/lib/bookings/queries";
import { booking } from "./payments/fixtures";

const NOW = new Date("2026-10-06T08:00:00.000Z");

function row(overrides: Parameters<typeof booking>[0] = {}): BookingListRow {
  const b = booking(overrides);
  return { ...b, client: null, event: null, payment: { state: "unpaid", source: "none", paidQr: 0, dueQr: b.amount_qr } };
}

describe("summariseToday", () => {
  it("counts the actionable things, not the closed ones", () => {
    const out = summariseToday({
      upcoming: [{ id: "a" }, { id: "b" }],
      bookings: [
        { booking_status: "inquiry", status: "pending", amount_qr: 0, amount_paid_qr: 0, manual_paid_at: null },
        { booking_status: "awaiting_payment", status: "pending", amount_qr: 350, amount_paid_qr: 0, manual_paid_at: null },
        { booking_status: "confirmed", status: "pending", amount_qr: 350, amount_paid_qr: 100, manual_paid_at: "x" },
        { booking_status: "confirmed", status: "paid", amount_qr: 350, amount_paid_qr: 0, manual_paid_at: null },
        { booking_status: "cancelled", status: "pending", amount_qr: 350, amount_paid_qr: 0, manual_paid_at: null },
        { booking_status: "completed", status: "pending", amount_qr: 350, amount_paid_qr: 0, manual_paid_at: null },
      ],
      documents: [{ status: "sent" }, { status: "viewed" }, { status: "signed" }, { status: "draft" }],
      galleries: [{ status: "ready" }, { status: "delivered" }],
      openIssues: 3,
      failedDeliveries: 1,
    });
    expect(out).toEqual({ upcomingShoots: 2, needsAction: 2, paymentsAwaiting: 2, contractsAwaiting: 2, galleriesAwaiting: 1, openIssues: 3, failedDeliveries: 1 });
  });
});

describe("upcomingItems", () => {
  it("merges dated bookings and active events inside the window, soonest first, skipping the past and undated", () => {
    const items = upcomingItems(
      [row({ id: "b1", session_at: "2026-10-08T07:00:00.000Z", customer_name: "Later" }), row({ id: "b2", session_at: "2026-10-06T09:00:00.000Z", customer_name: "Sooner" }), row({ id: "b3", session_at: null }), row({ id: "b4", session_at: "2026-09-01T00:00:00.000Z" }), row({ id: "b5", session_at: "2026-12-01T00:00:00.000Z" })],
      [
        { id: "e1", name: "Qatar Open", event_date: "2026-10-07", venue: "Lusail" },
        { id: "e2", name: "Old", event_date: "2026-10-01", venue: null },
        { id: "e3", name: "Far", event_date: "2026-11-30", venue: null },
      ],
      NOW,
      14,
    );
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(["booking:b2", "event:e1", "booking:b1"]);
    expect(items[1]).toMatchObject({ href: "/events/e1", subtitle: "7 Oct 2026 · Lusail" });
    expect(items[0]).toMatchObject({ href: "/bookings/b2", title: "Sooner", status: "awaiting_payment" });
  });
});

describe("describeAudit", () => {
  const base = { id: 1, entity: "booking", entity_id: "abc", created_at: "2026-10-06T08:00:00.000Z", actor_kind: "owner" as const };
  it("turns known actions into sentences with a link to the record", () => {
    expect(describeAudit({ ...base, action: "booking.status", data: { from: "inquiry", to: "confirmed" } })).toMatchObject({ text: "Booking → Confirmed", href: "/bookings/abc" });
    expect(describeAudit({ ...base, action: "booking.status", data: { to: "cancelled", reason: "No show" } }).text).toBe("Booking → Cancelled (No show)");
    expect(describeAudit({ ...base, action: "payment.manual", data: { amount_qr: 350, method: "bank_transfer" } }).text).toBe("Manual payment recorded: 350 QAR by bank transfer");
    expect(describeAudit({ ...base, action: "booking.invoice_created", data: { amount_qr: 350 } }).text).toContain("payment link created");
    expect(describeAudit({ ...base, action: "booking.price_set", data: { amount_qr: 1000, deposit_qr: 500, balance_qr: 500 } }).text).toBe("Price set: 1,000 QAR (deposit 500 QAR, balance 500 QAR)");
    expect(describeAudit({ ...base, action: "payment_request.created", data: { stage: "deposit", amount_qr: 500, provider: "WEBSITE" } }).text).toBe("Deposit payment link created: 500 QAR");
    expect(describeAudit({ ...base, action: "payment_request.regenerated", data: { stage: "balance", generation: 2 } }).text).toBe("Final balance payment link regenerated (generation 2)");
    expect(describeAudit({ ...base, action: "deposit.paid", data: { amount_qr: 500, source: "provider" } }).text).toBe("Deposit paid: 500 QAR (verified online)");
    expect(describeAudit({ ...base, action: "balance.due", data: { balance_qr: 500 } }).text).toBe("Final balance due: 500 QAR");
    expect(describeAudit({ ...base, action: "gallery.delivered", data: { balanceDue: true } }).text).toBe("Gallery delivered, final balance now due");
    expect(describeAudit({ ...base, action: "booking.completed", data: { reason: "final balance paid" } }).text).toBe("Booking completed (final balance paid)");
    expect(describeAudit({ ...base, entity: "person", action: "person.created", data: {} })).toMatchObject({ text: "person created", href: "/people/abc" });
    expect(describeAudit({ ...base, entity: "studio", entity_id: null, action: "studio.updated", data: null })).toMatchObject({ href: null });
  });
});

describe("ledger summarisers", () => {
  it("monthRange is the Qatar calendar month as UTC bounds", () => {
    const r = monthRange(NOW);
    expect(r).toEqual({ start: "2026-09-30T21:00:00.000Z", end: "2026-10-31T21:00:00.000Z", label: "October 2026" });
    expect(inRange("2026-10-01T00:00:00.000Z", r)).toBe(true);
    expect(inRange("2026-09-30T20:59:59.000Z", r)).toBe(false);
    expect(inRange(null, r)).toBe(false);
    expect(monthRange(new Date("2026-12-15T00:00:00.000Z")).end).toBe("2026-12-31T21:00:00.000Z");
  });

  it("summariseMoney: booked by confirmation month, received by paid_at, outstanding regardless of month", () => {
    const r = monthRange(NOW);
    const out = summariseMoney(
      [
        { booking_status: "confirmed", confirmed_at: "2026-10-02T00:00:00.000Z", amount_qr: 350, status: "paid", amount_paid_qr: 0, manual_paid_at: null },
        { booking_status: "delivered", confirmed_at: "2026-09-02T00:00:00.000Z", amount_qr: 500, status: "pending", amount_paid_qr: 200, manual_paid_at: "x" },
        { booking_status: "awaiting_payment", confirmed_at: null, amount_qr: 100, status: "pending", amount_paid_qr: 0, manual_paid_at: null },
        { booking_status: "inquiry", confirmed_at: null, amount_qr: 999, status: "pending", amount_paid_qr: 0, manual_paid_at: null },
      ],
      [
        { amount_qr: 350, paid_at: "2026-10-03T00:00:00.000Z" },
        { amount_qr: 200, paid_at: "2026-09-03T00:00:00.000Z" },
        { amount_qr: 0.1, paid_at: "2026-10-30T22:00:00.000Z" },
      ],
      r,
    );
    expect(out).toEqual({ bookedQr: 350, receivedQr: 350.1, outstandingQr: 400, recordCount: 2 });
  });

  it("outstandingOf keeps unpaid / partial only, largest balance first, and trusts the provider's paid", () => {
    const out = outstandingOf([
      { id: "a", status: "pending", amount_qr: 100, amount_paid_qr: 0, manual_paid_at: null },
      { id: "b", status: "paid", amount_qr: 900, amount_paid_qr: 0, manual_paid_at: null },
      { id: "c", status: "pending", amount_qr: 500, amount_paid_qr: 200, manual_paid_at: "x" },
      { id: "d", status: "pending", amount_qr: 500, amount_paid_qr: 500, manual_paid_at: "x" },
    ]);
    expect(out.map((b) => [b.id, b.payment.dueQr])).toEqual([["c", 300], ["a", 100]]);
  });
});
