import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } })) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(), isServiceClientConfigured: () => false }));

import { clientBookingSummary } from "@/lib/client-portal/queries";
import { booking } from "./payments/fixtures";

const PAY = "https://site.test/pay/bbp_" + "a".repeat(40);
const base = () => booking({ amount_qr: 1000, deposit_qr: 500, balance_qr: 500, deposit_state: "pending", balance_state: "not_due", requires_contract: true, contract_state: "required", booking_status: "awaiting_contract" });

describe("clientBookingSummary", () => {
  it("before signing: agreement to sign, deposit due, balance not due yet, no pay button even if a link exists", () => {
    const s = clientBookingSummary(base(), [{ stage: "deposit", status: "pending", payment_url: PAY, amount_qr: 500, currency: "QAR" }]);
    expect(s.contract).toMatchObject({ label: "Agreement to sign", signed: false });
    expect(s.deposit).toMatchObject({ label: "Deposit due", amount: "500 QAR", due: true });
    expect(s.balance).toMatchObject({ label: "Not due yet", amount: "500 QAR", due: false });
    expect(s.pay).toBeNull();
    expect(s.headline).toBe("Agreement to sign, then deposit");
  });

  it("after signing: the pay button links ONLY to our pending deposit request (never a provider URL)", () => {
    const b = { ...base(), contract_state: "signed" as const, booking_status: "awaiting_payment" as const };
    expect(clientBookingSummary(b, [{ stage: "deposit", status: "pending", payment_url: PAY, amount_qr: 500, currency: "QAR" }])).toMatchObject({ headline: "Deposit due", contract: { label: "Agreement signed" }, pay: { stage: "deposit", amount: "500 QAR", payUrl: PAY } });
    expect(clientBookingSummary(b, [{ stage: "deposit", status: "pending", payment_url: "https://demo.myfatoorah.com/ie/123", amount_qr: 500, currency: "QAR" }]).pay).toBeNull();
    expect(clientBookingSummary(b, [{ stage: "deposit", status: "cancelled", payment_url: PAY, amount_qr: 500, currency: "QAR" }]).pay).toBeNull();
    expect(clientBookingSummary(b, [{ stage: "balance", status: "pending", payment_url: PAY, amount_qr: 500, currency: "QAR" }]).pay).toBeNull();
  });

  it("deposit paid, then delivery makes the balance due, then paid in full", () => {
    const paidDeposit = { ...base(), contract_state: "signed" as const, deposit_state: "paid" as const, deposit_paid_at: "2026-10-01T07:00:00.000Z", booking_status: "confirmed" as const };
    const a = clientBookingSummary(paidDeposit);
    expect(a.deposit.label).toMatch(/^Deposit paid on /);
    expect(a.headline).toBe("Deposit paid");
    expect(a.pay).toBeNull();
    const due = { ...paidDeposit, booking_status: "delivered" as const, balance_state: "due" as const };
    const d = clientBookingSummary(due, [{ stage: "balance", status: "pending", payment_url: PAY, amount_qr: 500, currency: "QAR" }]);
    expect(d.balance).toMatchObject({ label: "Remaining balance due", amount: "500 QAR", due: true });
    expect(d.headline).toBe("Remaining balance due");
    expect(d.pay).toMatchObject({ stage: "balance", payUrl: PAY });
    const full = clientBookingSummary({ ...due, balance_state: "paid", balance_paid_at: "2026-10-09T07:00:00.000Z" });
    expect(full.balance.label).toMatch(/^Paid in full on /);
    expect(full.headline).toBe("Paid in full");
    expect(full.pay).toBeNull();
  });

  it("never exposes provider names, invoice ids or internal states", () => {
    const s = clientBookingSummary({ ...base(), contract_state: "signed", booking_status: "awaiting_payment" }, [{ stage: "deposit", status: "pending", payment_url: PAY, amount_qr: 500, currency: "QAR" }]);
    const text = JSON.stringify(s).toLowerCase();
    expect(text).not.toMatch(/fatoorah|pic-time|pictime|invoice|awaiting_payment|not_due/);
  });
});
