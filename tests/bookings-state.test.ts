import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  bookingDetails,
  bookingTransitionColumns,
  canTransitionBooking,
  effectivePayment,
  formatQr,
  initialBookingStatus,
  isTerminalBooking,
  makePublicRef,
} from "@/lib/bookings/state";
import { bookingEmailAlertKey, bookingEmailContent, bookingFacts } from "@/lib/bookings/emails";
import { booking } from "./payments/fixtures";

describe("booking lifecycle table", () => {
  it("every status has a transition row and only names known statuses", () => {
    for (const s of BOOKING_STATUSES) {
      expect(BOOKING_TRANSITIONS[s]).toBeDefined();
      for (const to of BOOKING_TRANSITIONS[s]) expect(BOOKING_STATUSES).toContain(to);
      expect(BOOKING_TRANSITIONS[s]).not.toContain(s);
    }
  });

  it("walks forward, steps back one stage, and completed is terminal", () => {
    expect(canTransitionBooking("inquiry", "confirmed")).toBe(true);
    expect(canTransitionBooking("awaiting_payment", "confirmed")).toBe(true);
    expect(canTransitionBooking("confirmed", "awaiting_payment")).toBe(true);
    expect(canTransitionBooking("confirmed", "inquiry")).toBe(false);
    expect(canTransitionBooking("delivered", "cancelled")).toBe(false);
    expect(canTransitionBooking("completed", "inquiry")).toBe(false);
    expect(BOOKING_TRANSITIONS.completed).toEqual([]);
    expect(isTerminalBooking("completed")).toBe(true);
    expect(isTerminalBooking("cancelled")).toBe(false);
  });

  it("cancelled can only be reopened as an inquiry", () => {
    expect(BOOKING_TRANSITIONS.cancelled).toEqual(["inquiry"]);
  });
});

describe("initialBookingStatus", () => {
  it("quotes start as inquiries whatever else is set", () => {
    expect(initialBookingStatus({ paymentMode: "quote", amountQr: 500, requiresContract: true })).toBe("inquiry");
  });
  it("a contract requirement wins over payment", () => {
    expect(initialBookingStatus({ paymentMode: "manual", amountQr: 500, requiresContract: true })).toBe("awaiting_contract");
  });
  it("priced bookings wait for payment; free ones are confirmed at once", () => {
    expect(initialBookingStatus({ paymentMode: "instant", amountQr: 350, requiresContract: false })).toBe("awaiting_payment");
    expect(initialBookingStatus({ paymentMode: "manual", amountQr: 0, requiresContract: false })).toBe("confirmed");
  });
});

describe("bookingTransitionColumns", () => {
  const now = new Date("2026-10-06T10:00:00.000Z");
  const empty = { quoted_at: null, confirmed_at: null, delivered_at: null, completed_at: null, cancelled_at: null };

  it("stamps the first entry into a stage only once", () => {
    expect(bookingTransitionColumns(empty, "confirmed", now)).toEqual({ booking_status: "confirmed", confirmed_at: now.toISOString() });
    expect(bookingTransitionColumns({ ...empty, confirmed_at: "2026-01-01T00:00:00.000Z" }, "confirmed", now)).toEqual({ booking_status: "confirmed" });
    expect(bookingTransitionColumns(empty, "quoted", now)).toEqual({ booking_status: "quoted", quoted_at: now.toISOString() });
    expect(bookingTransitionColumns(empty, "delivered", now)).toEqual({ booking_status: "delivered", delivered_at: now.toISOString() });
    expect(bookingTransitionColumns(empty, "completed", now)).toEqual({ booking_status: "completed", completed_at: now.toISOString() });
  });

  it("cancellation is always re-stamped and reopening clears it", () => {
    expect(bookingTransitionColumns({ ...empty, cancelled_at: "2026-01-01T00:00:00.000Z" }, "cancelled", now)).toEqual({ booking_status: "cancelled", cancelled_at: now.toISOString() });
    expect(bookingTransitionColumns(empty, "inquiry", now)).toEqual({ booking_status: "inquiry", cancelled_at: null, cancel_reason: null });
  });
});

describe("effectivePayment", () => {
  it("provider paid wins over everything, even a zero manual summary", () => {
    expect(effectivePayment({ status: "paid", amount_qr: 350, amount_paid_qr: 0, manual_paid_at: null })).toEqual({ state: "paid", source: "provider", paidQr: 350, dueQr: 0 });
  });
  it("provider refunded wins over manual records", () => {
    expect(effectivePayment({ status: "refunded", amount_qr: 350, amount_paid_qr: 350, manual_paid_at: "2026-10-01T00:00:00.000Z" })).toMatchObject({ state: "refunded", source: "provider", dueQr: 350 });
  });
  it("manual records fill in: partial, then paid once the amount is covered", () => {
    expect(effectivePayment({ status: "pending", amount_qr: 350, amount_paid_qr: 0, manual_paid_at: null })).toEqual({ state: "unpaid", source: "none", paidQr: 0, dueQr: 350 });
    expect(effectivePayment({ status: "pending", amount_qr: 350, amount_paid_qr: 100, manual_paid_at: "x" })).toEqual({ state: "partial", source: "manual", paidQr: 100, dueQr: 250 });
    expect(effectivePayment({ status: "failed", amount_qr: 350, amount_paid_qr: 350, manual_paid_at: "x" })).toEqual({ state: "paid", source: "manual", paidQr: 350, dueQr: 0 });
    expect(effectivePayment({ status: "pending", amount_qr: 350, amount_paid_qr: 400, manual_paid_at: "x" })).toMatchObject({ state: "paid", source: "manual", dueQr: 0 });
  });
});

describe("makePublicRef", () => {
  it("is BB- plus six unambiguous characters", () => {
    for (let i = 0; i < 50; i += 1) expect(makePublicRef()).toMatch(/^BB-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(makePublicRef(() => 0)).toBe("BB-AAAAAA");
    expect(makePublicRef(() => 0.999999)).toBe("BB-999999");
  });
});

describe("formatQr / bookingDetails", () => {
  it("formats amounts and tolerates garbage", () => {
    expect(formatQr(350)).toBe("350 QAR");
    expect(formatQr(1250.5)).toBe("1,250.5 QAR");
    expect(formatQr(null)).toBe("0 QAR");
    expect(formatQr(undefined)).toBe("—");
  });
  it("reads details only when it is an object", () => {
    expect(bookingDetails({ details: { belt: "blue" } })).toEqual({ belt: "blue" });
    expect(bookingDetails({ details: [] })).toEqual({});
    expect(bookingDetails({ details: null })).toEqual({});
  });
});

describe("booking e-mails", () => {
  const b = booking({ public_ref: "BB-7K3PQ2", session_at: "2026-10-10T07:00:00.000Z", location: "Lusail", amount_qr: 350, payment_url: "https://pay.example/1" });
  const o = { businessName: "Blue Belt Media", portalUrl: "https://site/client/bookings/x" };

  it("puts the reference, time (Qatar) and amount in the facts", () => {
    const facts = bookingFacts(b);
    expect(facts).toContainEqual(["Reference", "BB-7K3PQ2"]);
    expect(facts.find(([k]) => k === "When")?.[1]).toMatch(/10 Oct, 10:00 Qatar time/);
    expect(facts).toContainEqual(["Amount", "350 QAR"]);
  });

  it("PAYMENT_REQUESTED links to the payment URL; cancellation carries the reason and no button", () => {
    expect(bookingEmailContent("PAYMENT_REQUESTED", b, o).cta).toEqual({ label: "Pay securely", url: "https://pay.example/1" });
    const cancelled = bookingEmailContent("BOOKING_CANCELLED", { ...b, cancel_reason: "Athlete withdrew" }, o);
    expect(cancelled.cta).toBeNull();
    expect(cancelled.paragraphs[0]).toContain("Athlete withdrew");
    expect(bookingEmailContent("PAYMENT_RECEIVED", b, { ...o, payment: { amountQr: 100, methodLabel: "Cash", dueQr: 250 } }).paragraphs.join(" ")).toMatch(/100 QAR by cash.*250 QAR/);
  });

  it("dedupe keys are stable per kind and extend with a suffix", () => {
    expect(bookingEmailAlertKey("PAYMENT_RECEIVED", "id1")).toBe("email:booking:id1:paid");
    expect(bookingEmailAlertKey("BOOKING_CONFIRMED", "id1")).toBe("email:booking:id1:confirmed");
    expect(bookingEmailAlertKey("BOOKING_CHANGED", "id1", "99")).toBe("email:booking:id1:changed:99");
  });
});
