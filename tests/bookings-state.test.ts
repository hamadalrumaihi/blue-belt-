import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  bookingDetails,
  bookingTransitionColumns,
  canRequestPayment,
  canTransitionBooking,
  effectivePayment,
  formatQr,
  initialBookingStatus,
  isShootComplete,
  isTerminalBooking,
  makePublicRef,
  paymentRequestBlocker,
} from "@/lib/bookings/state";
import { BOOKING_EMAIL_KINDS, bookingEmailAlertKey, bookingEmailContent, bookingFacts, NO_PAYMENT_NEEDED_NOW } from "@/lib/bookings/emails";
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
  it("a contract requirement comes first", () => {
    expect(initialBookingStatus({ paymentMode: "manual", amountQr: 500, requiresContract: true })).toBe("awaiting_contract");
    expect(initialBookingStatus({ paymentMode: "link_later", amountQr: 0, requiresContract: true })).toBe("awaiting_contract");
  });
  it("booking never requires payment: a priced service starts as an inquiry the owner confirms; only a free one is confirmed at once", () => {
    for (const paymentMode of ["instant", "link_later", "manual"] as const) {
      expect(initialBookingStatus({ paymentMode, amountQr: 350, requiresContract: false })).toBe("inquiry");
      expect(initialBookingStatus({ paymentMode, amountQr: 350, requiresContract: false })).not.toBe("awaiting_payment");
    }
    expect(initialBookingStatus({ paymentMode: "manual", amountQr: 0, requiresContract: false })).toBe("confirmed");
  });
});

describe("canRequestPayment", () => {
  const done = "2026-10-06T10:00:00.000Z";
  const base = booking({ coverage_done_at: done, amount_qr: 350, booking_status: "in_progress", status: "pending", amount_paid_qr: 0, manual_paid_at: null });

  it("needs the shoot complete, an amount, a confirmed-or-later stage and something still due", () => {
    expect(isShootComplete(base)).toBe(true);
    expect(canRequestPayment(base)).toBe(true);
    for (const booking_status of ["confirmed", "in_progress", "delivered", "completed"] as const) expect(canRequestPayment({ ...base, booking_status })).toBe(true);
    expect(paymentRequestBlocker({ ...base, coverage_done_at: null })).toBe("shoot_not_complete");
    expect(isShootComplete({ coverage_done_at: null })).toBe(false);
    expect(paymentRequestBlocker({ ...base, amount_qr: 0 })).toBe("no_amount");
    for (const booking_status of ["inquiry", "quoted", "awaiting_contract", "awaiting_payment", "cancelled"] as const) expect(paymentRequestBlocker({ ...base, booking_status })).toBe("wrong_stage");
  });

  it("partly paid bookings can still be asked for the balance; paid or refunded ones cannot", () => {
    expect(canRequestPayment({ ...base, amount_paid_qr: 100, manual_paid_at: done })).toBe(true);
    expect(paymentRequestBlocker({ ...base, status: "paid" })).toBe("already_paid");
    expect(paymentRequestBlocker({ ...base, amount_paid_qr: 350, manual_paid_at: done })).toBe("already_paid");
    expect(paymentRequestBlocker({ ...base, status: "refunded" })).toBe("refunded");
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

  it("PAYMENT_REQUESTED says the amount, names MyFatoorah on the website, and links 'Pay online' only to OUR pay page", () => {
    const website = { ...b, payment_url: "https://site/pay/bbp_" + "a".repeat(40) };
    const mail = bookingEmailContent("PAYMENT_REQUESTED", website, o);
    expect(mail.subject).toBe("Pay online for your booking (BB-7K3PQ2)");
    expect(mail.cta).toEqual({ label: "Pay online", url: website.payment_url });
    expect(mail.paragraphs.join(" ")).toMatch(/350 QAR/);
    expect(mail.paragraphs.join(" ")).toMatch(/MyFatoorah on the Blue Belt Media website/);
    // A provider URL (MyFatoorah's own invoice page) is never the button: the portal is.
    expect(bookingEmailContent("PAYMENT_REQUESTED", b, o).cta).toEqual({ label: "View your booking", url: o.portalUrl });
    // A partly paid booking is asked for the balance.
    expect(bookingEmailContent("PAYMENT_REQUESTED", { ...website, amount_paid_qr: 100, manual_paid_at: "x" }, o).paragraphs[0]).toMatch(/250 QAR/);
  });

  it("received / confirmed mails say no payment is needed now; nothing customer-facing carries an em dash", () => {
    expect(bookingEmailContent("BOOKING_RECEIVED", b, o).paragraphs).toContain(NO_PAYMENT_NEEDED_NOW);
    expect(bookingEmailContent("BOOKING_CONFIRMED", b, o).paragraphs).toContain(NO_PAYMENT_NEEDED_NOW);
    expect(bookingEmailContent("BOOKING_CONFIRMED", { ...b, status: "paid" }, o).paragraphs.join(" ")).toMatch(/payment has been received/i);
    for (const kind of BOOKING_EMAIL_KINDS) {
      const c = bookingEmailContent(kind, { ...b, cancel_reason: "No" }, { ...o, payment: { amountQr: 100, methodLabel: "Cash", dueQr: 250 }, previous: { session_at: b.session_at, location: "Doha" } });
      const text = [c.subject, c.greeting, ...c.paragraphs, c.cta?.label ?? "", ...(c.facts ?? []).flat()].join(" ");
      expect(text, kind).not.toContain("\u2014");
    }
  });

  it("cancellation carries the reason and no button", () => {
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
