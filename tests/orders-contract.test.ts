import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { orderMessage, parseOrderIntake, paymentLabel, redactRawOrder } from "@/lib/orders/contract";

const fixture = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/orders/${name}.json`, import.meta.url)), "utf8")) as unknown;

describe("parseOrderIntake (proposed Pic-Time contract, synthetic fixtures)", () => {
  it("normalises a card order reported paid by Pic-Time", () => {
    const r = parseOrderIntake(fixture("pictime-card-paid"));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.order).toMatchObject({
      source: "pictime",
      externalRef: "PT-2026-000123",
      placedAt: "2026-03-14T06:12:00.000Z",
      buyer: { name: "Fatima Al-Kuwari", email: "fatima@example.com", phone: "+974 5555 0100" },
      gallery: { name: "Qatar National Pro 2026", id: "g_8812" },
      amount: { value: 370, currency: "QAR" },
      payment: { method: "card", state: "paid", reference: "ch_synthetic_01", reportedState: "paid" },
      athleteNameHint: "Hamad Al Rumaihi",
    });
    expect(r.order.items).toEqual([
      { name: "Digital download — full match set", quantity: 1, unitAmount: 250, sku: "DL-FULL" },
      { name: "Print 20x30", quantity: 2, unitAmount: 60, sku: null },
    ]);
  });

  it("accepts the flat Zapier field names and never marks a Fawran order paid at intake, whatever Pic-Time reported", () => {
    const r = parseOrderIntake(fixture("pictime-fawran-pending"));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.order).toMatchObject({ externalRef: "PT-2026-000124", buyer: { name: "Khalid Al-Thani", email: null }, amount: { value: 120, currency: "QAR" }, payment: { method: "fawran", state: "pending", reportedState: "paid" } });
    expect(r.order.items).toEqual([{ name: "Digital download — single match", quantity: 1, unitAmount: 120, sku: null }]);
    expect(paymentLabel("fawran", "pending")).toBe("Order placed — Fawran payment not yet confirmed");
    expect(paymentLabel("bank_transfer", "pending")).toContain("not yet confirmed");
  });

  it("refuses orders without an amount, a buyer name, a reference, or with a bad email / source", () => {
    expect(parseOrderIntake(fixture("pictime-invalid-no-amount"))).toMatchObject({ ok: false, code: "INVALID_ORDER", error: expect.stringContaining("amount.value") });
    expect(parseOrderIntake({ source: "pictime", externalRef: "x1", amount: { value: 1 } })).toMatchObject({ ok: false, error: expect.stringContaining("buyer.name") });
    expect(parseOrderIntake({ source: "pictime", buyer: { name: "A" }, amount: { value: 1 } })).toMatchObject({ ok: false, error: expect.stringContaining("externalRef") });
    expect(parseOrderIntake({ source: "pictime", externalRef: "x1", buyer: { name: "A", email: "nope" }, amount: { value: 1 } })).toMatchObject({ ok: false, error: expect.stringContaining("email") });
    expect(parseOrderIntake({ source: "shopify", externalRef: "x1", buyer: { name: "A" }, amount: { value: 1 } })).toMatchObject({ ok: false });
    expect(parseOrderIntake({ source: "pictime", externalRef: "x1", buyer: { name: "A" }, amount: { value: -5 } })).toMatchObject({ ok: false });
    expect(parseOrderIntake("nope")).toMatchObject({ ok: false });
  });

  it("maps method and state words loosely but conservatively", () => {
    const base = { source: "pictime", externalRef: "r", buyer: { name: "B" }, amount: { value: 10 } };
    const parse = (payment: Record<string, unknown>) => {
      const r = parseOrderIntake({ ...base, payment });
      if (!r.ok) throw new Error(r.error);
      return r.order.payment;
    };
    expect(parse({ method: "Apple Pay", state: "Succeeded" })).toMatchObject({ method: "card", state: "paid" });
    expect(parse({ method: "Bank transfer", state: "paid" })).toMatchObject({ method: "bank_transfer", state: "pending" });
    expect(parse({ method: "cash", state: "refunded" })).toMatchObject({ method: "cash", state: "refunded" });
    expect(parse({ method: "card", state: "Declined" })).toMatchObject({ method: "card", state: "failed" });
    expect(parse({})).toMatchObject({ method: "unknown", state: "unknown" });
    expect(parse({ method: "card" })).toMatchObject({ method: "card", state: "unknown" });
  });

  it("builds the Telegram text and a redacted raw copy without card data", () => {
    const r = parseOrderIntake(fixture("pictime-card-paid"));
    if (!r.ok) throw new Error(r.error);
    const text = orderMessage(r.order);
    expect(text).toContain("<b>New order — Fatima Al-Kuwari</b>");
    expect(text).toContain("370.00 QAR · Paid (card, reported by Pic-Time)");
    expect(text).toContain("Ref: PT-2026-000123");
    const raw = redactRawOrder({ ...(fixture("pictime-card-paid") as object), cardNumber: "4111", nested: { token: "t", ok: "x".repeat(400) } });
    expect(raw).not.toHaveProperty("cardNumber");
    expect((raw.nested as Record<string, unknown>).token).toBeUndefined();
    expect(((raw.nested as Record<string, unknown>).ok as string).length).toBe(300);
  });
});
