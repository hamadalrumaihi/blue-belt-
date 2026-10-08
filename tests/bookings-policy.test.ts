import { describe, expect, it } from "vitest";
import { depositColumnsFor, readDepositPolicy, splitAmounts } from "@/lib/bookings/policy";
import { confirmationBlockers, gatedBookingStatus, type GateBooking } from "@/lib/bookings/gates";

describe("deposit policy", () => {
  it("splits QAR 1000 into a 500 deposit and a 500 balance", () => {
    expect(splitAmounts(1000, 50)).toEqual({ depositQr: 500, balanceQr: 500 });
    expect(splitAmounts(350, 50)).toEqual({ depositQr: 175, balanceQr: 175 });
    expect(splitAmounts(333.33, 50)).toEqual({ depositQr: 166.67, balanceQr: 166.66 });
    expect(splitAmounts(0, 50)).toEqual({ depositQr: 0, balanceQr: 0 });
  });

  it("defaults to a required 50% deposit and never silently turns it off", () => {
    expect(readDepositPolicy({})).toMatchObject({ depositRequired: true, depositPercent: 50, balanceTiming: "after_delivery", warnings: [] });
    const bad = readDepositPolicy({ BOOKINGS_DEPOSIT_REQUIRED: "no", BOOKINGS_DEPOSIT_PERCENT: "abc", BOOKINGS_BALANCE_TIMING: "upfront" });
    expect(bad.depositRequired).toBe(true);
    expect(bad.depositPercent).toBe(50);
    expect(bad.warnings).toHaveLength(3);
    expect(readDepositPolicy({ BOOKINGS_DEPOSIT_REQUIRED: "1", BOOKINGS_DEPOSIT_PERCENT: "30" })).toMatchObject({ depositRequired: true, depositPercent: 30 });
  });

  it("computes booking deposit columns on the server from the total", () => {
    expect(depositColumnsFor(1000, readDepositPolicy({}))).toEqual({ deposit_percent: 50, deposit_qr: 500, balance_qr: 500, deposit_state: "pending" });
    expect(depositColumnsFor(0, readDepositPolicy({}))).toMatchObject({ deposit_qr: 0, balance_qr: 0, deposit_state: "not_required" });
    expect(depositColumnsFor(1000, readDepositPolicy({ BOOKINGS_DEPOSIT_REQUIRED: "0" }))).toEqual({ deposit_percent: 0, deposit_qr: 0, balance_qr: 1000, deposit_state: "not_required" });
  });
});

function gate(overrides: Partial<GateBooking> = {}): GateBooking {
  return { booking_status: "quoted", requires_contract: true, requires_guardian_release: false, contract_state: "required", deposit_state: "pending", balance_state: "not_due", amount_qr: 1000, subject_is_minor: false, ...overrides };
}

describe("confirmation gates", () => {
  it("blocks on the unsigned contract first, then the unpaid deposit", () => {
    expect(confirmationBlockers(gate()).map((b) => b.code)).toEqual(["contract_unsigned", "deposit_unpaid"]);
    expect(gatedBookingStatus(gate())).toBe("awaiting_contract");
  });
  it("a signed contract alone is not enough: the deposit still blocks", () => {
    const b = gate({ contract_state: "signed" });
    expect(confirmationBlockers(b).map((x) => x.code)).toEqual(["deposit_unpaid"]);
    expect(gatedBookingStatus(b)).toBe("awaiting_payment");
  });
  it("a paid deposit alone is not enough: the contract still blocks", () => {
    const b = gate({ deposit_state: "paid" });
    expect(confirmationBlockers(b).map((x) => x.code)).toEqual(["contract_unsigned"]);
    expect(gatedBookingStatus(b)).toBe("awaiting_contract");
  });
  it("confirms once the contract is signed and the deposit is paid; the balance never blocks", () => {
    const b = gate({ contract_state: "signed", deposit_state: "paid", balance_state: "not_due" });
    expect(confirmationBlockers(b)).toEqual([]);
    expect(gatedBookingStatus(b)).toBe("confirmed");
  });
  it("names the guardian release for a minor", () => {
    const b = gate({ subject_is_minor: true, requires_guardian_release: true });
    expect(confirmationBlockers(b)[0]?.code).toBe("guardian_release_unsigned");
  });
  it("never moves a booking that is already confirmed or later", () => {
    expect(gatedBookingStatus(gate({ booking_status: "confirmed" }))).toBeNull();
    expect(gatedBookingStatus(gate({ booking_status: "delivered" }))).toBeNull();
  });
});
