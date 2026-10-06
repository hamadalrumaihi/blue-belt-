import { describe, expect, it } from "vitest";
import { buildInvoiceDraft, invoiceDraftText, invoiceNeed, invoiceSentAt, invoiceTelegramLines, matchClient, phoneKey, type DraftOrder } from "@/lib/orders/invoice-draft";

const order = (over: Partial<DraftOrder> = {}): DraftOrder => ({
  customer_name: "Khalid <Al-Thani>",
  customer_email: "khalid@example.com",
  customer_phone: "+974 5555 0101",
  gallery_name: "AJP Qatar",
  external_ref: "PT-7",
  amount: 150,
  currency: "QAR",
  payment_method: "fawran",
  payment_state: "pending",
  status: "placed",
  items: [{ name: "Digital download", quantity: 2, unitAmount: 50 }, { name: "Print", quantity: 1, unitAmount: 50 }],
  ...over,
});

describe("matchClient", () => {
  const clients = [
    { id: "a", name: "By Email", email: "KHALID@example.com ", phone: null },
    { id: "b", name: "By Phone", email: null, phone: "0097455550101" },
  ];

  it("matches by email (case-insensitive) before phone, and by the last 8 phone digits", () => {
    expect(matchClient({ email: "khalid@example.com", phone: "55550101" }, clients)).toEqual({ athleteId: "a", name: "By Email", by: "email" });
    expect(matchClient({ email: null, phone: "+974 5555-0101" }, clients)).toEqual({ athleteId: "b", name: "By Phone", by: "phone" });
    expect(matchClient({ email: "other@example.com", phone: "1234" }, clients)).toBeNull();
    expect(matchClient({ email: null, phone: null }, clients)).toBeNull();
  });

  it("ignores phone numbers too short to compare", () => {
    expect(phoneKey("1234567")).toBeNull();
    expect(phoneKey("+974 5555 0101")).toBe("55550101");
  });
});

describe("invoiceNeed", () => {
  it("drafts only for unpaid, open, non-card orders from new buyers with an amount", () => {
    expect(invoiceNeed(order(), null)).toEqual({ kind: "draft" });
    expect(invoiceNeed(order({ payment_method: "card", payment_state: "unknown" }), null).kind).toBe("card");
    expect(invoiceNeed(order({ payment_state: "paid" }), null).kind).toBe("paid");
    expect(invoiceNeed(order({ status: "cancelled" }), null).kind).toBe("closed");
    expect(invoiceNeed(order({ amount: 0 }), null).kind).toBe("no_amount");
    expect(invoiceNeed(order(), { athleteId: "a", name: "X", by: "email" }).kind).toBe("client");
  });
});

describe("buildInvoiceDraft / invoiceDraftText", () => {
  it("uses the order's own lines and total, and flags when they do not add up", () => {
    const d = buildInvoiceDraft(order());
    expect(d.lines).toEqual([
      { description: "Digital download", quantity: 2, unitAmount: 50, amount: 100 },
      { description: "Print", quantity: 1, unitAmount: 50, amount: 50 },
    ]);
    expect(d).toMatchObject({ total: 150, currency: "QAR", linesMatchTotal: true });
    expect(buildInvoiceDraft(order({ amount: 175 })).linesMatchTotal).toBe(false);
  });

  it("never invents a price for a line without one", () => {
    const d = buildInvoiceDraft(order({ items: [{ name: "Bundle", quantity: 1 }] }));
    expect(d.lines[0]).toMatchObject({ unitAmount: null, amount: null });
    expect(d.linesMatchTotal).toBe(false);
    expect(invoiceDraftText(d)).toContain("1 × Bundle\n");
  });

  it("produces copyable text with bill-to, reference, lines and total", () => {
    const text = invoiceDraftText(buildInvoiceDraft(order()));
    expect(text).toContain("Bill to: Khalid <Al-Thani>");
    expect(text).toContain("khalid@example.com · +974 5555 0101");
    expect(text).toContain("Pic-Time order PT-7 · Gallery: AJP Qatar");
    expect(text).toContain("2 × Digital download — 100.00 QAR");
    expect(text).toContain("Total due: 150.00 QAR");
    expect(text).toContain("Payment by Fawran");
  });
});

describe("invoiceTelegramLines", () => {
  it("escapes HTML and says the draft was not sent to the buyer", () => {
    const lines = invoiceTelegramLines({ kind: "draft" }, buildInvoiceDraft(order()), "https://app.test/orders?ref=PT-7").join("\n");
    expect(lines).toContain("<b>Invoice draft (not sent to the buyer)</b>");
    expect(lines).toContain("Bill to: Khalid &lt;Al-Thani&gt;");
    expect(lines).toContain("Review, copy and send it yourself: https://app.test/orders?ref=PT-7");
  });

  it("names the existing client or says no invoice is needed", () => {
    expect(invoiceTelegramLines({ kind: "client", match: { athleteId: "a", name: "Sara", by: "phone" } }, null, null)[0]).toContain("existing client (Sara, matched by phone)");
    expect(invoiceTelegramLines({ kind: "paid" }, null, null)[0]).toContain("no invoice needed");
  });
});

describe("invoiceSentAt", () => {
  it("reads the owner's mark from metadata", () => {
    expect(invoiceSentAt({ invoice_sent_at: "2026-10-06T10:00:00.000Z" })).toBe("2026-10-06T10:00:00.000Z");
    expect(invoiceSentAt({})).toBeNull();
    expect(invoiceSentAt(null)).toBeNull();
  });
});
