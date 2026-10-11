import { describe, expect, it } from "vitest";
import { emailProblem, invoiceBlocker, isOutstanding, planInvoice, planLabel, readOrderInvoicing, type PlanContext, type PlanOrder } from "@/lib/orders/eligibility";

const AUTO_SINCE = "2026-10-10T12:00:00.000Z";

const order = (over: Partial<PlanOrder> = {}): PlanOrder => ({
  status: "placed",
  payment_state: "pending",
  payment_method: "photographer",
  amount_qr: 240,
  customer_email: "buyer@example.com",
  received_at: "2026-10-11T09:00:00.000Z",
  created_at: "2026-10-11T09:00:00.000Z",
  invoice_requested_at: null,
  invoice_completed_at: null,
  invoice_exception: null,
  ...over,
});

const auto: PlanContext = { settings: { mode: "auto", autoSince: AUTO_SINCE }, paymentsEnabled: true, autoEnabled: true };
const review: PlanContext = { settings: { mode: "review", autoSince: null }, paymentsEnabled: true, autoEnabled: true };

describe("planInvoice — who gets a payment link automatically", () => {
  it("bills a new unpaid photographer-collected order with an e-mail, in automatic mode, after the activation time", () => {
    expect(planInvoice(order(), auto)).toEqual({ kind: "auto" });
    for (const method of ["photographer", "fawran", "bank_transfer", "cash"]) expect(planInvoice(order({ payment_method: method }), auto)).toEqual({ kind: "auto" });
  });

  it("never bills history: the paid 240 QAR order and anything received before the activation time", () => {
    // The historical paid order: a hard blocker, in every mode.
    const paid = order({ payment_state: "paid", amount_qr: 240, received_at: "2026-09-01T10:00:00.000Z", created_at: "2026-09-01T10:00:00.000Z" });
    expect(planInvoice(paid, auto)).toEqual({ kind: "skip", reason: "paid" });
    expect(planInvoice(paid, review)).toEqual({ kind: "skip", reason: "paid" });
    expect(invoiceBlocker(paid)).toBe("paid");
    // An unpaid order that arrived before automatic mode was switched on waits for the owner.
    const older = order({ received_at: "2026-10-10T11:59:59.000Z", created_at: "2026-10-10T11:59:59.000Z" });
    expect(planInvoice(older, auto)).toEqual({ kind: "review", reason: "historical" });
    // received_at wins over created_at for the cutoff; without received_at, created_at decides.
    expect(planInvoice(order({ received_at: null, created_at: "2026-10-01T00:00:00.000Z" }), auto)).toEqual({ kind: "review", reason: "historical" });
    expect(planInvoice(order({ received_at: AUTO_SINCE }), auto)).toEqual({ kind: "auto" });
  });

  it("skips sample orders with no amount, card orders, refunds and cancellations", () => {
    expect(planInvoice(order({ amount_qr: 0 }), auto)).toEqual({ kind: "skip", reason: "free" });
    expect(planInvoice(order({ amount_qr: Number.NaN }), auto)).toEqual({ kind: "skip", reason: "free" });
    expect(planInvoice(order({ payment_method: "card", payment_state: "pending" }), auto)).toEqual({ kind: "skip", reason: "card" });
    expect(planInvoice(order({ payment_state: "refunded" }), auto)).toEqual({ kind: "skip", reason: "refunded" });
    expect(planInvoice(order({ status: "cancelled" }), auto)).toEqual({ kind: "skip", reason: "cancelled" });
    expect(planInvoice(order({ invoice_requested_at: "2026-10-11T09:01:00.000Z" }), auto)).toEqual({ kind: "skip", reason: "already_requested" });
  });

  it("parks unknown methods and missing / invalid e-mails in the exception queue instead of guessing", () => {
    expect(planInvoice(order({ payment_method: "unknown" }), auto)).toEqual({ kind: "exception", reason: "unknown_method" });
    expect(planInvoice(order({ customer_email: null }), auto)).toEqual({ kind: "exception", reason: "no_email" });
    expect(planInvoice(order({ customer_email: "   " }), auto)).toEqual({ kind: "exception", reason: "no_email" });
    expect(planInvoice(order({ customer_email: "not-an-address" }), auto)).toEqual({ kind: "exception", reason: "invalid_email" });
    // Exceptions are raised even in review mode, so the owner sees them on the card.
    expect(planInvoice(order({ customer_email: null }), review)).toEqual({ kind: "exception", reason: "no_email" });
    expect(emailProblem("a@b.co")).toBeNull();
  });

  it("review mode, the master switch and the activation time each hold the automatic path", () => {
    expect(planInvoice(order(), review)).toEqual({ kind: "review", reason: "mode" });
    expect(planInvoice(order(), { ...auto, autoEnabled: false })).toEqual({ kind: "review", reason: "auto_off" });
    expect(planInvoice(order(), { ...auto, settings: { mode: "auto", autoSince: null } })).toEqual({ kind: "review", reason: "not_activated" });
    // Payments off while automatic mode is on is a configuration problem the owner must see.
    expect(planInvoice(order(), { ...auto, paymentsEnabled: false })).toEqual({ kind: "exception", reason: "payments_off" });
  });

  it("existing clients are eligible whenever money is outstanding (there is no client exemption)", () => {
    const existingClient = order({ customer_email: "client@example.com" });
    expect(planInvoice(existingClient, auto)).toEqual({ kind: "auto" });
    expect(isOutstanding(existingClient)).toBe(true);
    expect(isOutstanding(order({ payment_state: "paid" }))).toBe(false);
  });

  it("labels say what happens next", () => {
    expect(planLabel({ kind: "auto" })).toMatch(/queued automatically/);
    expect(planLabel({ kind: "review", reason: "historical" })).toMatch(/older than the activation time/);
    expect(planLabel({ kind: "exception", reason: "no_email" })).toMatch(/no e-mail address/);
    expect(planLabel({ kind: "skip", reason: "card" })).toMatch(/paid by card in the gallery/);
  });
});

describe("readOrderInvoicing", () => {
  it("defaults to review with no activation time, and only honours a parseable autoSince", () => {
    expect(readOrderInvoicing(null)).toEqual({ mode: "review", autoSince: null });
    expect(readOrderInvoicing({})).toEqual({ mode: "review", autoSince: null });
    expect(readOrderInvoicing({ orderInvoicing: { mode: "auto", autoSince: "2026-10-10T12:00:00Z" } })).toEqual({ mode: "auto", autoSince: AUTO_SINCE });
    expect(readOrderInvoicing({ orderInvoicing: { mode: "auto", autoSince: "yesterday" } })).toEqual({ mode: "auto", autoSince: null });
    expect(readOrderInvoicing({ orderInvoicing: { mode: "weird" } })).toEqual({ mode: "review", autoSince: null });
  });
});
