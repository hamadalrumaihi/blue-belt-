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
import { BOOKING_EMAIL_KINDS, bookingEmailAlertKey, bookingEmailContent, bookingFacts, SECURE_PAYMENT_STORY } from "@/lib/bookings/emails";
import { BOOKING_STATUS_CLIENT_LABEL, BOOKING_STATUS_LABEL, deliveryColumns, formatMoney, isCompletionReady, isStageOpen, manualPaymentStages, nextActionFor, stageAmount, stageLabel, stageWords } from "@/lib/bookings/state";
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
    // Provider-paid in full means both stages settled (what the migration backfills for status=paid).
    expect(paymentRequestBlocker({ ...base, status: "paid", deposit_state: "paid", balance_state: "paid" })).toBe("already_paid");
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

describe("stage helpers", () => {
  const b = booking({ amount_qr: 1000, deposit_qr: 500, balance_qr: 500, deposit_state: "pending", balance_state: "not_due" });

  it("labels and amounts come from the booking row", () => {
    expect(stageAmount(b, "deposit")).toBe(500);
    expect(stageAmount(b, "balance")).toBe(500);
    expect(stageWords(b, "deposit")).toBe("deposit (50%)");
    expect(stageWords(b, "balance")).toBe("remaining balance (50%)");
    expect(stageLabel({ deposit_percent: 30 }, "balance")).toBe("Remaining 70%");
    expect(formatMoney(500, "QAR")).toBe("500 QAR");
    expect(BOOKING_STATUS_LABEL.awaiting_payment).toBe("Awaiting deposit");
    expect(BOOKING_STATUS_CLIENT_LABEL.awaiting_payment).toBe("Deposit due");
    expect(BOOKING_STATUS_CLIENT_LABEL.in_progress).toBe("Editing");
  });

  it("a stage is open only while it can be paid: deposit until paid, balance only once due", () => {
    expect(isStageOpen(b, "deposit")).toBe(true);
    expect(isStageOpen(b, "balance")).toBe(false);
    expect(isStageOpen({ ...b, deposit_state: "paid", balance_state: "due" }, "deposit")).toBe(false);
    expect(isStageOpen({ ...b, deposit_state: "paid", balance_state: "due" }, "balance")).toBe(true);
    expect(manualPaymentStages(b).map((s) => [s.stage, s.open, s.reason])).toEqual([["deposit", true, null], ["balance", false, "Not due until delivery."]]);
    expect(manualPaymentStages(b, [{ stage: "deposit", status: "paid" }])[0]).toMatchObject({ open: false, reason: "Paid online." });
  });

  it("delivery makes the balance due (only when there is one) and stamps timestamps once", () => {
    const now = new Date("2026-10-08T10:00:00.000Z");
    const cols = deliveryColumns({ ...b, booking_status: "in_progress", delivered_at: null, gallery_delivered_at: null, balance_due_at: null }, now);
    expect(cols).toEqual({ gallery_delivered_at: now.toISOString(), booking_status: "delivered", delivered_at: now.toISOString(), balance_state: "due", balance_due_at: now.toISOString(), balanceBecameDue: true });
    const free = deliveryColumns({ ...b, booking_status: "in_progress", balance_qr: 0, delivered_at: null, gallery_delivered_at: null, balance_due_at: null }, now);
    expect(free).toMatchObject({ balance_state: "waived", balanceBecameDue: false });
    const again = deliveryColumns({ ...b, booking_status: "delivered", delivered_at: "2026-10-01T00:00:00.000Z", gallery_delivered_at: "2026-10-01T00:00:00.000Z", balance_state: "due", balance_due_at: "2026-10-01T00:00:00.000Z" }, now);
    expect(again).toEqual({ gallery_delivered_at: "2026-10-01T00:00:00.000Z", balanceBecameDue: false });
  });

  it("a delivered booking completes only once both stages are settled", () => {
    expect(isCompletionReady({ booking_status: "delivered", deposit_state: "paid", balance_state: "paid", balance_qr: 500 })).toBe(true);
    expect(isCompletionReady({ booking_status: "delivered", deposit_state: "paid", balance_state: "due", balance_qr: 500 })).toBe(false);
    expect(isCompletionReady({ booking_status: "in_progress", deposit_state: "paid", balance_state: "paid", balance_qr: 500 })).toBe(false);
    expect(isCompletionReady({ booking_status: "delivered", deposit_state: "waived", balance_state: "not_due", balance_qr: 0 })).toBe(true);
  });

  it("nextActionFor walks the owner through the flow", () => {
    const base = { ...b, booking_status: "quoted" as const, requires_contract: true, contract_state: "required" as const, coverage_done_at: null };
    expect(nextActionFor({ ...base, amount_qr: 0, booking_status: "inquiry" }).code).toBe("set_price");
    expect(nextActionFor({ ...base, booking_status: "inquiry" }).code).toBe("approve_quote");
    expect(nextActionFor(base)).toMatchObject({ code: "send_agreement", blockers: [expect.objectContaining({ code: "contract_unsigned" }), expect.objectContaining({ code: "deposit_unpaid" })] });
    expect(nextActionFor({ ...base, contract_state: "sent" }).code).toBe("await_signature");
    expect(nextActionFor({ ...base, contract_state: "signed", booking_status: "awaiting_payment" })).toMatchObject({ code: "request_deposit", text: "Create the deposit payment link." });
    expect(nextActionFor({ ...base, contract_state: "signed", booking_status: "awaiting_payment" }, [{ stage: "deposit", status: "pending" }]).code).toBe("await_deposit");
    expect(nextActionFor({ ...base, booking_status: "confirmed", contract_state: "signed", deposit_state: "paid" }).code).toBe("shoot");
    expect(nextActionFor({ ...base, booking_status: "in_progress", deposit_state: "paid", coverage_done_at: "x" }).code).toBe("deliver");
    expect(nextActionFor({ ...base, booking_status: "delivered", deposit_state: "paid", balance_state: "due" })).toMatchObject({ code: "request_balance" });
    expect(nextActionFor({ ...base, booking_status: "delivered", deposit_state: "paid", balance_state: "due" }, [{ stage: "balance", status: "pending" }]).code).toBe("await_balance");
    expect(nextActionFor({ ...base, booking_status: "delivered", deposit_state: "paid", balance_state: "paid" }).code).toBe("complete");
    expect(nextActionFor({ ...base, booking_status: "cancelled" }).code).toBe("cancelled");
  });
});

describe("effectivePayment", () => {
  it("with stage columns: paid stages add up, the balance stays due until delivery settles it", () => {
    const b = booking({ amount_qr: 1000, deposit_qr: 500, balance_qr: 500, deposit_state: "pending", balance_state: "not_due", status: "pending" });
    expect(effectivePayment(b)).toEqual({ state: "unpaid", source: "none", paidQr: 0, dueQr: 1000 });
    // The deposit arrived through the provider: the booking's provider status is "paid" but half is still owed.
    expect(effectivePayment({ ...b, status: "paid", deposit_state: "paid" })).toEqual({ state: "partial", source: "provider", paidQr: 500, dueQr: 500 });
    expect(effectivePayment({ ...b, status: "paid", deposit_state: "paid", balance_state: "paid" })).toEqual({ state: "paid", source: "provider", paidQr: 1000, dueQr: 0 });
    expect(effectivePayment({ ...b, deposit_state: "paid", amount_paid_qr: 500, manual_paid_at: "x" })).toEqual({ state: "partial", source: "manual", paidQr: 500, dueQr: 500 });
    expect(effectivePayment({ ...b, deposit_state: "paid", balance_state: "waived" })).toMatchObject({ state: "paid", dueQr: 0 });
    expect(effectivePayment({ ...b, status: "refunded" })).toMatchObject({ state: "refunded" });
  });
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
  const b = booking({ public_ref: "BB-7K3PQ2", session_at: "2026-10-10T07:00:00.000Z", location: "Lusail", amount_qr: 1000, deposit_qr: 500, balance_qr: 500, payment_url: "https://pay.example/1" });
  const o = { businessName: "Blue Belt Media", portalUrl: "https://site/client/bookings/x" };
  const payUrl = "https://site/pay/bbp_" + "a".repeat(40);

  it("puts the reference, time (Qatar) and amount in the facts", () => {
    const facts = bookingFacts(b);
    expect(facts).toContainEqual(["Reference", "BB-7K3PQ2"]);
    expect(facts.find(([k]) => k === "When")?.[1]).toMatch(/10 Oct, 10:00 Qatar time/);
    expect(facts).toContainEqual(["Amount", "1,000 QAR"]);
  });

  it("PAYMENT_REQUESTED for a stage request: 'Complete your online payment', stage in plain words, amount + currency, button 'Open your payment link' to OUR page", () => {
    const deposit = bookingEmailContent("PAYMENT_REQUESTED", b, { ...o, request: { stage: "deposit", amountQr: 500, currency: "QAR", payUrl } });
    expect(deposit.subject).toBe("Complete your online payment (BB-7K3PQ2)");
    expect(deposit.paragraphs[0]).toBe("The deposit (50%) for your booking is 500 QAR.");
    expect(deposit.cta).toEqual({ label: "Open your payment link", url: payUrl });
    const balance = bookingEmailContent("PAYMENT_REQUESTED", b, { ...o, request: { stage: "balance", amountQr: 500, currency: "QAR", payUrl } });
    expect(balance.paragraphs[0]).toBe("The remaining balance (50%) for your booking is 500 QAR.");
    // Legacy booking-level link: still our page only, never a provider URL.
    expect(bookingEmailContent("PAYMENT_REQUESTED", { ...b, payment_url: payUrl }, o).cta).toEqual({ label: "Open your payment link", url: payUrl });
    expect(bookingEmailContent("PAYMENT_REQUESTED", b, o).cta).toEqual({ label: "View your booking", url: o.portalUrl });
  });

  it("received / confirmed mails tell the secure online payment story; nothing customer-facing names a vendor or carries an em dash", () => {
    expect(bookingEmailContent("BOOKING_RECEIVED", b, o).paragraphs).toContain(SECURE_PAYMENT_STORY);
    expect(bookingEmailContent("BOOKING_CONFIRMED", { ...b, deposit_state: "paid" }, o).paragraphs.join(" ")).toMatch(/deposit is paid.*500 QAR is due after delivery/);
    expect(bookingEmailContent("BOOKING_CONFIRMED", { ...b, deposit_state: "paid", balance_state: "paid", status: "paid" }, o).paragraphs.join(" ")).toMatch(/fully paid/i);
    expect(bookingEmailContent("DELIVERY_COMPLETE", { ...b, balance_state: "due" }, o).paragraphs.join(" ")).toMatch(/remaining balance of 500 QAR is now due/);
    for (const kind of BOOKING_EMAIL_KINDS) {
      const c = bookingEmailContent(kind, { ...b, cancel_reason: "No" }, { ...o, payment: { amountQr: 100, methodLabel: "Cash", dueQr: 250 }, request: { stage: "deposit", amountQr: 500, currency: "QAR", payUrl }, previous: { session_at: b.session_at, location: "Doha" } });
      const text = [c.subject, c.greeting, ...c.paragraphs, c.cta?.label ?? "", ...(c.facts ?? []).flat()].join(" ");
      expect(text, kind).not.toContain("\u2014");
      expect(text.toLowerCase(), kind).not.toMatch(/fatoorah|pic-time|pictime|docusign/);
    }
  });

  it("cancellation carries the reason and no button; payment received names the stage", () => {
    const cancelled = bookingEmailContent("BOOKING_CANCELLED", { ...b, cancel_reason: "Athlete withdrew" }, o);
    expect(cancelled.cta).toBeNull();
    expect(cancelled.paragraphs[0]).toContain("Athlete withdrew");
    const received = bookingEmailContent("PAYMENT_RECEIVED", b, { ...o, payment: { amountQr: 500, methodLabel: "Cash", dueQr: 500, stage: "deposit" } });
    expect(received.subject).toBe("Your payment was received (BB-7K3PQ2)");
    expect(received.paragraphs.join(" ")).toMatch(/500 QAR for the deposit \(50%\) by cash.*Remaining balance: 500 QAR, due after delivery/);
  });

  it("dedupe keys are stable per kind and extend with a suffix", () => {
    expect(bookingEmailAlertKey("PAYMENT_RECEIVED", "id1")).toBe("email:booking:id1:paid");
    expect(bookingEmailAlertKey("BOOKING_CONFIRMED", "id1")).toBe("email:booking:id1:confirmed");
    expect(bookingEmailAlertKey("BOOKING_CHANGED", "id1", "99")).toBe("email:booking:id1:changed:99");
  });
});
