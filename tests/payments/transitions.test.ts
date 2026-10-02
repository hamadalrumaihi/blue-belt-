import { describe, expect, it } from "vitest";
import { PAYMENT_STATUSES, applyTransition, canTransition, isTerminalStatus, type PaymentStatus } from "@/lib/payments/types";

const ALLOWED: Array<[PaymentStatus, PaymentStatus]> = [
  ["pending", "paid"],
  ["pending", "failed"],
  ["pending", "cancelled"],
  ["paid", "refunded"],
  ["paid", "disputed"],
  ["disputed", "refunded"],
  ["disputed", "paid"],
  ["failed", "pending"],
];

describe("transition table", () => {
  it("allows exactly the documented transitions and nothing else", () => {
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        const expected = ALLOWED.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it("marks refunded and cancelled as terminal", () => {
    expect(isTerminalStatus("refunded")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    for (const s of ["pending", "paid", "failed", "disputed"] as const) expect(isTerminalStatus(s)).toBe(false);
  });
});

describe("applyTransition", () => {
  const now = new Date("2026-10-02T12:00:00.000Z");

  it("sets paid_at when a booking becomes paid", () => {
    expect(applyTransition("pending", "paid", now)).toEqual({ ok: true, columns: { status: "paid", payment_status_updated_at: now.toISOString(), paid_at: now.toISOString() } });
  });

  it("keeps the original paid_at when a dispute resolves back to paid", () => {
    const r = applyTransition("disputed", "paid", now, { paid_at: "2026-09-01T00:00:00.000Z" });
    expect(r).toEqual({ ok: true, columns: { status: "paid", payment_status_updated_at: now.toISOString() } });
  });

  it("sets refunded_at / disputed_at", () => {
    expect(applyTransition("paid", "refunded", now)).toMatchObject({ ok: true, columns: { status: "refunded", refunded_at: now.toISOString() } });
    expect(applyTransition("paid", "disputed", now)).toMatchObject({ ok: true, columns: { status: "disputed", disputed_at: now.toISOString() } });
  });

  it("rejects illegal and no-op transitions with typed reasons", () => {
    expect(applyTransition("refunded", "paid", now)).toEqual({ ok: false, reason: "illegal_transition" });
    expect(applyTransition("cancelled", "paid", now)).toEqual({ ok: false, reason: "illegal_transition" });
    expect(applyTransition("paid", "paid", now)).toEqual({ ok: false, reason: "same_status" });
  });
});
