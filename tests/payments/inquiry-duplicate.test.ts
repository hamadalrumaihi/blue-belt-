import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("mapInquiry", () => {
  it("treats DuplicatePayment like Paid, as the official library does", async () => {
    const { mapInquiry } = await import("@/lib/payments/myfatoorah/webhook");
    const { default: _unused } = { default: null };
    void _unused;
    const inquiry = { invoiceId: "123", invoiceStatus: "DuplicatePayment", transactions: [], raw: {} } as unknown as Parameters<typeof mapInquiry>[0];
    const mapping = mapInquiry(inquiry);
    expect(mapping.kind).toBe("apply");
    if (mapping.kind === "apply") expect(mapping.status).toBe("paid");
  });
});
