import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * MyFatoorah Webhook V2 signature verification.
 *
 * Source: https://docs.myfatoorah.com/docs/webhook-signature (steps 1-6) and
 * the per-event "Webhook Signature" sections of
 *   https://docs.myfatoorah.com/docs/webhook-v2-payment-status-data-model
 *   https://docs.myfatoorah.com/docs/webhook-v2-refund-data-model
 *   https://docs.myfatoorah.com/docs/webhook-v2-dispute-data-model
 *
 * Algorithm as documented:
 *   1. Take ONLY the properties listed for the event type, in the documented
 *      order (not every field of the payload; nested objects such as Card,
 *      Customer, Amount.* beyond the listed ones are excluded).
 *   2. Build one string `key=value,key2=value2,...` (comma separated, no
 *      spaces). A null/missing property is written as an empty value
 *      (`CustomerEmail=`), per the "Null Properties" note.
 *   3. UTF-8 encode the secret key and the string.
 *   4. HMAC-SHA256 the string with the portal's webhook secret key (binary).
 *   5. Base64 encode the raw digest.
 *   6. Compare with the `MyFatoorah-Signature` request header.
 *
 * Documented field order per event (dotted paths are nested JSON paths in `Data`):
 *   PAYMENT_STATUS_CHANGED (Event.Code 1):
 *     Invoice.Id, Invoice.Status, Transaction.Status, Transaction.PaymentId, Invoice.ExternalIdentifier
 *   REFUND_STATUS_CHANGED (Event.Code 2):
 *     Refund.Id, Refund.Status, Amount.ValueInBaseCurrency, ReferencedInvoice.Id
 *   DISPUTE_STATUS_CHANGED (Event.Code 6):
 *     Dispute.DisputeTransactionId, Dispute.Status, Invoice.Id, Invoice.Status,
 *     Transaction.Status, Transaction.PaymentId, Invoice.ExternalIdentifier
 *
 * Events whose field list is not documented here (BALANCE_TRANSFERRED,
 * SUPPLIER_*, RECURRING_UPDATES) are not verified and are reported as
 * `unsupported_event`; the webhook route rejects them with 401 rather than
 * guessing an order. Do not subscribe to those events in the portal.
 */

export const SIGNATURE_HEADER = "myfatoorah-signature";
export const VERSION_HEADER = "myfatoorah-webhook-version";

/**
 * Only Webhook V2 is supported (V1 signs every field of `Data` sorted
 * case-insensitively, which this adapter does not implement). The official
 * PHP library rejects a missing or unknown version header outright; MyFatoorah
 * always sends it, so an absent header is treated as V2 for forward
 * compatibility while any other value is refused.
 */
export function isSupportedWebhookVersion(headerValue: string | null | undefined): boolean {
  const v = (headerValue ?? "").trim().toLowerCase();
  return v === "" || v === "v2";
}

export type SignedEventName = "PAYMENT_STATUS_CHANGED" | "REFUND_STATUS_CHANGED" | "DISPUTE_STATUS_CHANGED";

export const SIGNATURE_FIELDS: Readonly<Record<SignedEventName, readonly string[]>> = {
  PAYMENT_STATUS_CHANGED: ["Invoice.Id", "Invoice.Status", "Transaction.Status", "Transaction.PaymentId", "Invoice.ExternalIdentifier"],
  REFUND_STATUS_CHANGED: ["Refund.Id", "Refund.Status", "Amount.ValueInBaseCurrency", "ReferencedInvoice.Id"],
  DISPUTE_STATUS_CHANGED: [
    "Dispute.DisputeTransactionId",
    "Dispute.Status",
    "Invoice.Id",
    "Invoice.Status",
    "Transaction.Status",
    "Transaction.PaymentId",
    "Invoice.ExternalIdentifier",
  ],
};

const EVENT_CODES: Readonly<Record<number, SignedEventName>> = { 1: "PAYMENT_STATUS_CHANGED", 2: "REFUND_STATUS_CHANGED", 6: "DISPUTE_STATUS_CHANGED" };

export function isSignedEventName(name: unknown): name is SignedEventName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(SIGNATURE_FIELDS, name);
}

/** Resolves the event name from `Event.Name`, falling back to `Event.Code`. */
export function eventNameOf(body: Record<string, unknown>): SignedEventName | null {
  const event = isRecord(body.Event) ? body.Event : null;
  if (!event) return null;
  if (isSignedEventName(event.Name)) return event.Name;
  if (typeof event.Code === "number" && EVENT_CODES[event.Code]) return EVENT_CODES[event.Code];
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reads `a.b.c` from an object; undefined when any hop is missing. */
export function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Scalar -> string as MyFatoorah serialises it; null/undefined -> "". */
export function signatureValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  // Objects/arrays are never in the documented field lists; stringify so a
  // malformed payload still yields a deterministic (and non-matching) value.
  return JSON.stringify(v);
}

/**
 * Builds the `key=value,key2=value2` string for a webhook body (the whole
 * JSON body: `{ Event, Data }`). The documented fields are read from `Data`.
 * Returns null for events without a documented field list.
 */
export function buildSignaturePayload(body: Record<string, unknown>, eventName: SignedEventName | null = eventNameOf(body)): string | null {
  if (!eventName) return null;
  const data = isRecord(body.Data) ? body.Data : {};
  return SIGNATURE_FIELDS[eventName].map((field) => `${field}=${signatureValue(readPath(data, field))}`).join(",");
}

export function computeSignature(payload: string, secret: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(Buffer.from(payload, "utf8")).digest("base64");
}

export type SignatureVerdict = { valid: true; eventName: SignedEventName } | { valid: false; reason: "missing_header" | "missing_secret" | "unsupported_event" | "mismatch"; eventName: SignedEventName | null };

/**
 * Verifies the `MyFatoorah-Signature` header against the body. Constant-time
 * comparison; a header of a different length is a mismatch, never a throw.
 */
export function verifySignature(headerValue: string | null | undefined, body: Record<string, unknown>, secret: string): SignatureVerdict {
  const eventName = eventNameOf(body);
  if (!secret) return { valid: false, reason: "missing_secret", eventName };
  if (!eventName) return { valid: false, reason: "unsupported_event", eventName: null };
  const header = (headerValue ?? "").trim();
  if (!header) return { valid: false, reason: "missing_header", eventName };
  const payload = buildSignaturePayload(body, eventName);
  if (payload === null) return { valid: false, reason: "unsupported_event", eventName };
  const expected = Buffer.from(computeSignature(payload, secret), "utf8");
  const received = Buffer.from(header, "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { valid: false, reason: "mismatch", eventName };
  return { valid: true, eventName };
}
