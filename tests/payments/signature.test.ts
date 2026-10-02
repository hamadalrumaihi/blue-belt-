import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSignaturePayload, computeSignature, eventNameOf, verifySignature } from "@/lib/payments/myfatoorah/signature";
import { SECRET, disputeEvent, paymentEvent, refundEvent } from "./fixtures";

const hmacB64 = (payload: string, secret: string) => createHmac("sha256", Buffer.from(secret, "utf8")).update(Buffer.from(payload, "utf8")).digest("base64");

describe("buildSignaturePayload", () => {
  it("matches the documented PAYMENT_STATUS_CHANGED field order verbatim", () => {
    // Expected string copied from the docs' "Webhook Signature" section.
    expect(buildSignaturePayload(paymentEvent())).toBe(
      "Invoice.Id=6409988,Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=07076409988323998875,Invoice.ExternalIdentifier=asdqwd-f13sdf-fasjkz",
    );
  });

  it("matches the documented REFUND_STATUS_CHANGED field order", () => {
    const body = refundEvent();
    body.Data.Refund.Id = "111147";
    body.Data.Amount.ValueInBaseCurrency = "30";
    body.Data.ReferencedInvoice.Id = "5620277";
    expect(buildSignaturePayload(body)).toBe("Refund.Id=111147,Refund.Status=REFUNDED,Amount.ValueInBaseCurrency=30,ReferencedInvoice.Id=5620277");
  });

  it("matches the documented DISPUTE_STATUS_CHANGED field order", () => {
    const body = disputeEvent();
    body.Data.Invoice.Id = "5897264";
    body.Data.Transaction.PaymentId = "07075897264282534874";
    expect(buildSignaturePayload(body)).toBe(
      "Dispute.DisputeTransactionId=112,Dispute.Status=PENDING,Invoice.Id=5897264,Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=07075897264282534874,Invoice.ExternalIdentifier=1hGonC7bf2vNuJWuTgCGURYzi6Yu",
    );
  });

  it("writes null and missing properties as empty values", () => {
    const body = paymentEvent();
    (body.Data.Invoice as Record<string, unknown>).ExternalIdentifier = null;
    delete (body.Data.Transaction as Partial<typeof body.Data.Transaction>).PaymentId;
    expect(buildSignaturePayload(body)).toBe("Invoice.Id=6409988,Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=,Invoice.ExternalIdentifier=");
  });

  it("returns null for events without a documented field list", () => {
    expect(buildSignaturePayload({ Event: { Code: 3, Name: "BALANCE_TRANSFERRED" }, Data: {} })).toBeNull();
    expect(eventNameOf({ Event: { Code: 1 } })).toBe("PAYMENT_STATUS_CHANGED");
    expect(eventNameOf({})).toBeNull();
  });
});

describe("verifySignature", () => {
  it("accepts a header computed with HMAC-SHA256 + base64 over the ordered payload", () => {
    const body = paymentEvent();
    const header = hmacB64(buildSignaturePayload(body)!, SECRET);
    expect(computeSignature(buildSignaturePayload(body)!, SECRET)).toBe(header);
    expect(verifySignature(header, body, SECRET)).toEqual({ valid: true, eventName: "PAYMENT_STATUS_CHANGED" });
    // Known vector so an accidental change in encoding is caught.
    expect(header).toBe(createHmac("sha256", SECRET).update("Invoice.Id=6409988,Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=07076409988323998875,Invoice.ExternalIdentifier=asdqwd-f13sdf-fasjkz").digest("base64"));
  });

  it("rejects tampering of a signed field, a different secret, and a hex-encoded header", () => {
    const body = paymentEvent();
    const header = hmacB64(buildSignaturePayload(body)!, SECRET);
    const tampered = paymentEvent({ transactionStatus: "FAILED" });
    expect(verifySignature(header, tampered, SECRET)).toMatchObject({ valid: false, reason: "mismatch" });
    expect(verifySignature(header, body, "another-secret")).toMatchObject({ valid: false, reason: "mismatch" });
    const hex = createHmac("sha256", SECRET).update(buildSignaturePayload(body)!).digest("hex");
    expect(verifySignature(hex, body, SECRET)).toMatchObject({ valid: false, reason: "mismatch" });
  });

  it("ignores changes to fields outside the documented list (they are not signed)", () => {
    const body = paymentEvent();
    const header = hmacB64(buildSignaturePayload(body)!, SECRET);
    body.Data.Customer.Name = "Someone else";
    expect(verifySignature(header, body, SECRET).valid).toBe(true);
  });

  it("reports missing header, missing secret and unsupported events without throwing", () => {
    const body = paymentEvent();
    expect(verifySignature(null, body, SECRET)).toMatchObject({ valid: false, reason: "missing_header" });
    expect(verifySignature("", body, SECRET)).toMatchObject({ valid: false, reason: "missing_header" });
    expect(verifySignature("abc", body, "")).toMatchObject({ valid: false, reason: "missing_secret" });
    expect(verifySignature("abc", { Event: { Code: 5, Name: "RECURRING_UPDATES" }, Data: {} }, SECRET)).toMatchObject({ valid: false, reason: "unsupported_event" });
    expect(verifySignature("abc", { nothing: true }, SECRET)).toMatchObject({ valid: false, reason: "unsupported_event" });
  });
});
