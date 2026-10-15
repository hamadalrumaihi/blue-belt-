import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } })) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(), isServiceClientConfigured: () => false }));

import { deliveryDelays, describeAudit, forecastVsCollected, leadSourceCounts, median, prioritise, quoteConversion, requestsNeedingAction, responseTimes, splitMoney, summariseToday, upcomingItems } from "@/lib/studio/dashboard";
import { normalizeSearchTerm } from "@/lib/studio/search";
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
    expect(describeAudit({ ...base, action: "booking.production_stage", data: { from: "shoot_complete", to: "culling" } })).toMatchObject({ text: "Production → culling", href: "/bookings/abc" });
    expect(describeAudit({ ...base, entity: "lead", action: "lead.status", data: { status: "contacted" } })).toMatchObject({ text: "Lead → contacted", href: "/leads/abc" });
    expect(describeAudit({ ...base, entity: "studio", entity_id: "owner", action: "website.testimonial_added", data: { published: true } })).toMatchObject({ text: "Testimonial added (published)", href: "/website/testimonials" });
    expect(describeAudit({ ...base, entity: "studio", entity_id: "owner", action: "website.faq_updated", data: {} })).toMatchObject({ text: "FAQ updated", href: "/website/faqs" });
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

describe("overview summarisers", () => {
  it("splitMoney labels forecast (booked this month), collected (paid this month) and outstanding separately", () => {
    const r = monthRange(NOW);
    const out = splitMoney(
      [
        { booking_status: "confirmed", confirmed_at: "2026-10-02T00:00:00.000Z", amount_qr: 1000, status: "pending", amount_paid_qr: 0, manual_paid_at: null, deposit_state: "paid", deposit_qr: 500, balance_state: "not_due", balance_qr: 500 },
        { booking_status: "delivered", confirmed_at: "2026-09-02T00:00:00.000Z", amount_qr: 600, status: "pending", amount_paid_qr: 0, manual_paid_at: null, deposit_state: "paid", deposit_qr: 300, balance_state: "due", balance_qr: 300 },
        { booking_status: "quoted", confirmed_at: null, amount_qr: 999, status: "pending", amount_paid_qr: 0, manual_paid_at: null },
        { booking_status: "completed", confirmed_at: "2026-10-03T00:00:00.000Z", amount_qr: 200, status: "paid", amount_paid_qr: 0, manual_paid_at: null, deposit_state: "paid", deposit_qr: 100, balance_state: "paid", balance_qr: 100 },
      ],
      [{ amount_qr: 500, paid_at: "2026-10-02T00:00:00.000Z" }, { amount_qr: 300, paid_at: "2026-09-02T00:00:00.000Z" }],
      r,
    );
    expect(out).toEqual({ range: r, forecastMonthQr: 1200, collectedMonthQr: 500, outstandingQr: 800, forecastLiveQr: 1600, outstandingCount: 2 });
  });

  it("requestsNeedingAction merges new / contacted leads with inquiry / quoted bookings, oldest first", () => {
    const out = requestsNeedingAction(
      [
        { id: "l1", status: "new", source: "website", created_at: "2026-10-05T00:00:00.000Z", booking_type: "club", message: null, person: { full_name: "Coach" } },
        { id: "l2", status: "quoted", source: "website", created_at: "2026-10-01T00:00:00.000Z", booking_type: null, message: null, person: null },
        { id: "l3", status: "contacted", source: "instagram", created_at: "2026-10-02T00:00:00.000Z", booking_type: null, message: "hi", person: null },
      ],
      [row({ id: "b1", booking_status: "inquiry", created_at: "2026-10-03T00:00:00.000Z" }), row({ id: "b2", booking_status: "confirmed", created_at: "2026-10-01T00:00:00.000Z" }), row({ id: "b3", booking_status: "quoted", created_at: "2026-10-04T00:00:00.000Z", public_ref: "BB-1" })],
    );
    expect(out.map((r) => `${r.kind}:${r.id}`)).toEqual(["lead:l3", "booking:b1", "booking:b3", "lead:l1"]);
    expect(out[0]).toMatchObject({ title: "Unknown", subtitle: "Message · via instagram", href: "/leads?status=contacted" });
    expect(out[3]).toMatchObject({ title: "Coach", subtitle: "Team / club · via website" });
    expect(out[2].subtitle).toBe("Standard · BB-1");
  });

  it("prioritise returns the next action per live booking, soonest due first, capped", () => {
    const out = prioritise(
      [
        row({ id: "a", booking_status: "quoted", quoted_at: "2026-10-05T00:00:00.000Z" }),
        row({ id: "b", booking_status: "awaiting_payment" }),
        row({ id: "c", booking_status: "confirmed", session_at: "2026-10-08T07:00:00.000Z" }),
        row({ id: "d", booking_status: "cancelled" }),
        row({ id: "e", booking_status: "in_progress" }),
      ],
      { pendingRequests: [{ booking_id: "b", stage: "deposit", status: "pending", created_at: "2026-10-01T00:00:00.000Z" }], galleries: [{ booking_id: "e", status: "ready", pictime_url: "https://x.pic-time.com/g" }], sentDocuments: [], now: NOW },
      3,
    );
    expect(out.map((r) => `${r.booking.id}:${r.action.code}`)).toEqual(["b:chase_deposit", "c:prepare_brief", "a:follow_up_quote"]);
    expect(out[0].action.overdue).toBe(true);
  });
});

describe("metrics", () => {
  it("responseTimes: lead created → first lead.status audit row, in hours; untouched leads are unanswered", () => {
    const out = responseTimes(
      [{ id: "l1", created_at: "2026-10-01T00:00:00.000Z" }, { id: "l2", created_at: "2026-10-01T00:00:00.000Z" }, { id: "l3", created_at: "2026-10-01T00:00:00.000Z" }],
      [
        { entity: "lead", entity_id: "l1", action: "lead.status", created_at: "2026-10-01T02:00:00.000Z" },
        { entity: "lead", entity_id: "l1", action: "lead.status", created_at: "2026-10-01T01:00:00.000Z" },
        { entity: "lead", entity_id: "l2", action: "lead.status", created_at: "2026-10-02T01:00:00.000Z" },
        { entity: "booking", entity_id: "l3", action: "booking.status", created_at: "2026-10-01T01:00:00.000Z" },
      ],
    );
    expect(out).toEqual({ count: 2, medianHours: 13, meanHours: 13, unanswered: 1 });
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
  });

  it("leadSourceCounts, quoteConversion and deliveryDelays carry their definitions in the numbers", () => {
    expect(leadSourceCounts([{ source: "website" }, { source: "instagram" }, { source: "website" }, { source: "" }])).toEqual([{ source: "website", count: 2 }, { source: "instagram", count: 1 }, { source: "unknown", count: 1 }]);
    expect(quoteConversion([
      { quoted_at: "x", confirmed_at: "y", booking_status: "confirmed" },
      { quoted_at: "x", confirmed_at: "y", booking_status: "completed" },
      { quoted_at: "x", confirmed_at: null, booking_status: "cancelled" },
      { quoted_at: "x", confirmed_at: null, booking_status: "quoted" },
      { quoted_at: null, confirmed_at: "y", booking_status: "confirmed" },
    ])).toEqual({ quoted: 4, confirmed: 2, cancelled: 1, open: 1, rate: 66.7 });
    expect(quoteConversion([]).rate).toBeNull();
    expect(deliveryDelays([
      { session_at: "2026-10-01T00:00:00.000Z", delivered_at: "2026-10-08T00:00:00.000Z", gallery_delivered_at: null, booking_status: "delivered" },
      { session_at: "2026-09-01T00:00:00.000Z", delivered_at: null, gallery_delivered_at: "2026-09-21T00:00:00.000Z", booking_status: "completed" },
      { session_at: "2026-09-01T00:00:00.000Z", delivered_at: "2026-09-02T00:00:00.000Z", gallery_delivered_at: null, booking_status: "in_progress" },
      { session_at: null, delivered_at: "2026-09-02T00:00:00.000Z", gallery_delivered_at: null, booking_status: "delivered" },
    ])).toEqual({ count: 2, medianDays: 13.5, meanDays: 13.5, over14: 1 });
  });

  it("forecastVsCollected walks back month by month, oldest first", () => {
    const out = forecastVsCollected(
      [{ booking_status: "confirmed", confirmed_at: "2026-09-10T00:00:00.000Z", amount_qr: 400, status: "pending", amount_paid_qr: 0, manual_paid_at: null }],
      [{ amount_qr: 150, paid_at: "2026-10-02T00:00:00.000Z" }, { amount_qr: 50, paid_at: "2026-08-02T00:00:00.000Z" }],
      NOW,
      3,
    );
    expect(out.map((m) => [m.range.label, m.forecastQr, m.collectedQr])).toEqual([["August 2026", 0, 50], ["September 2026", 400, 0], ["October 2026", 0, 150]]);
  });

  it("normalizeSearchTerm strips filter-breaking characters and needs two characters", () => {
    expect(normalizeSearchTerm("  BB-7K3,(x) ")).toBe("BB-7K3 x");
    expect(normalizeSearchTerm("a")).toBeNull();
    expect(normalizeSearchTerm(null)).toBeNull();
    expect(normalizeSearchTerm("x".repeat(100))?.length).toBe(60);
  });
});
