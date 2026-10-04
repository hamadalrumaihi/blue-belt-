import { isPlainObject } from "@/lib/validation";

/**
 * Pic-Time order intake contract (PROPOSED — no real Pic-Time payload was
 * available while building; see docs/orders-intake.md for the Zapier mapping
 * and the labelled synthetic fixtures under tests/fixtures/orders/).
 *
 * A Zap ("Pic-Time → New order" trigger → "Webhooks by Zapier: POST JSON")
 * sends this shape to POST /api/orders/intake with an orders intake
 * credential. Everything optional is nullable; amounts are never invented:
 * an order without an amount is refused. Buyers are customers, not tracked
 * athletes — `athleteNameHint` is free text for the photographer's eyes only.
 */

export type PaymentMethod = "card" | "fawran" | "bank_transfer" | "cash" | "unknown";
export type PaymentState = "unknown" | "pending" | "paid" | "failed" | "refunded";
export type OrderStatus = "placed" | "fulfilled" | "cancelled";

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["card", "fawran", "bank_transfer", "cash", "unknown"];
export const PAYMENT_STATES: readonly PaymentState[] = ["unknown", "pending", "paid", "failed", "refunded"];
/** Methods settled outside Pic-Time: the owner confirms receipt by hand. */
export const OFFLINE_METHODS: readonly PaymentMethod[] = ["fawran", "bank_transfer", "cash"];

export type OrderItem = { name: string; quantity: number; unitAmount: number | null; sku: string | null };

export type NormalizedOrder = {
  source: "pictime";
  externalRef: string;
  placedAt: string | null;
  buyer: { name: string; email: string | null; phone: string | null };
  gallery: { name: string | null; id: string | null };
  items: OrderItem[];
  amount: { value: number; currency: string };
  payment: { method: PaymentMethod; state: PaymentState; reference: string | null; reportedState: PaymentState | null };
  notes: string | null;
  athleteNameHint: string | null;
};

export type OrderParse = { ok: true; order: NormalizedOrder } | { ok: false; code: "INVALID_ORDER"; error: string };

const MAX_TEXT = 200;
const REF_RE = /^[A-Za-z0-9._:#/-]{1,120}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

function str(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function methodOf(v: unknown): PaymentMethod {
  const s = (str(v) ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return "unknown";
  if (/fawran|fawri|offline_transfer/.test(s)) return "fawran";
  if (/bank|transfer|iban|wire/.test(s)) return "bank_transfer";
  if (/cash/.test(s)) return "cash";
  if (/card|visa|master|stripe|credit|debit|apple|google|online/.test(s)) return "card";
  return "unknown";
}

function stateOf(v: unknown): PaymentState | null {
  const s = (str(v) ?? "").toLowerCase();
  if (!s) return null;
  if (/paid|succe|complete|captured|settled/.test(s)) return "paid";
  if (/refund/.test(s)) return "refunded";
  if (/fail|declin|error/.test(s)) return "failed";
  if (/pend|await|unpaid|open|process/.test(s)) return "pending";
  return "unknown";
}

/** Validates and normalises an intake body. Never throws. */
export function parseOrderIntake(body: unknown): OrderParse {
  if (!isPlainObject(body)) return { ok: false, code: "INVALID_ORDER", error: "Body must be a JSON object." };
  const source = (str(body.source) ?? "pictime").toLowerCase();
  if (source !== "pictime") return { ok: false, code: "INVALID_ORDER", error: "source must be \"pictime\"." };
  const externalRef = str(body.externalRef ?? body.orderId ?? body.orderNumber, 120);
  if (!externalRef || !REF_RE.test(externalRef)) return { ok: false, code: "INVALID_ORDER", error: "externalRef (the Pic-Time order id / number) is required." };

  const buyerRaw = isPlainObject(body.buyer) ? body.buyer : {};
  const buyerName = str(buyerRaw.name ?? body.buyerName ?? body.customerName);
  if (!buyerName) return { ok: false, code: "INVALID_ORDER", error: "buyer.name is required." };
  const emailRaw = str(buyerRaw.email ?? body.buyerEmail ?? body.customerEmail);
  if (emailRaw && !EMAIL_RE.test(emailRaw)) return { ok: false, code: "INVALID_ORDER", error: "buyer.email is not a valid email." };
  const phone = str(buyerRaw.phone ?? body.buyerPhone ?? body.customerPhone, 40);

  const amountRaw = isPlainObject(body.amount) ? body.amount : { value: body.amount ?? body.total, currency: body.currency };
  const value = numberOf(amountRaw.value ?? amountRaw.total);
  if (value === null || value < 0) return { ok: false, code: "INVALID_ORDER", error: "amount.value is required (a number >= 0); prices are never invented." };
  const currency = (str(amountRaw.currency, 3) ?? "QAR").toUpperCase();
  if (!CURRENCY_RE.test(currency)) return { ok: false, code: "INVALID_ORDER", error: "amount.currency must be a 3-letter code." };

  const items: OrderItem[] = [];
  if (Array.isArray(body.items)) {
    for (const raw of body.items.slice(0, 50)) {
      if (!isPlainObject(raw)) continue;
      const name = str(raw.name ?? raw.title ?? raw.product);
      if (!name) continue;
      const quantity = Math.max(1, Math.round(numberOf(raw.quantity ?? raw.qty) ?? 1));
      items.push({ name, quantity, unitAmount: numberOf(raw.unitAmount ?? raw.price ?? raw.unit_price), sku: str(raw.sku, 60) });
    }
  }

  const paymentRaw = isPlainObject(body.payment) ? body.payment : { method: body.paymentMethod, state: body.paymentState ?? body.paymentStatus, reference: body.paymentReference };
  const method = methodOf(paymentRaw.method);
  const reportedState = stateOf(paymentRaw.state ?? paymentRaw.status);
  // Offline methods (Fawran, bank transfer, cash) are never "paid" at intake:
  // the money is confirmed by the owner, not by the order notification.
  const state: PaymentState = OFFLINE_METHODS.includes(method) ? (reportedState === "refunded" ? "refunded" : "pending") : (reportedState ?? "unknown");

  const placedRaw = str(body.placedAt ?? body.createdAt ?? body.orderDate, 40);
  const placedAt = placedRaw && Number.isFinite(new Date(placedRaw).getTime()) ? new Date(placedRaw).toISOString() : null;
  const galleryRaw = isPlainObject(body.gallery) ? body.gallery : { name: body.galleryName, id: body.galleryId };

  return {
    ok: true,
    order: {
      source: "pictime",
      externalRef,
      placedAt,
      buyer: { name: buyerName, email: emailRaw ? emailRaw.toLowerCase() : null, phone },
      gallery: { name: str(galleryRaw.name), id: str(galleryRaw.id, 80) },
      items,
      amount: { value: Math.round(value * 100) / 100, currency },
      payment: { method, state, reference: str(paymentRaw.reference ?? paymentRaw.transactionId, 120), reportedState },
      notes: str(body.notes ?? body.note ?? body.comment, 500),
      athleteNameHint: str(body.athleteNameHint ?? body.athleteName ?? body.competitorName),
    },
  };
}

/** Owner-facing label for the payment situation of an order. */
export function paymentLabel(method: PaymentMethod, state: PaymentState): string {
  if (state === "paid") return method === "card" ? "Paid (card, reported by Pic-Time)" : "Paid (confirmed by you)";
  if (state === "refunded") return "Refunded";
  if (state === "failed") return "Payment failed";
  if (OFFLINE_METHODS.includes(method)) return `Order placed — ${METHOD_LABEL[method]} payment not yet confirmed`;
  if (state === "pending") return "Payment pending";
  return "Payment status unknown";
}

export const METHOD_LABEL: Record<PaymentMethod, string> = { card: "Card", fawran: "Fawran", bank_transfer: "Bank transfer", cash: "Cash", unknown: "Unknown method" };

/** Telegram text for a new order ([Orders] prefix is added by the runner). */
export function orderMessage(o: NormalizedOrder): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = [
    `<b>New order — ${esc(o.buyer.name)}</b>`,
    `${o.amount.value.toFixed(2)} ${esc(o.amount.currency)} · ${esc(paymentLabel(o.payment.method, o.payment.state))}`,
  ];
  if (o.gallery.name) lines.push(`Gallery: ${esc(o.gallery.name)}`);
  if (o.items.length) lines.push(`Items: ${esc(o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ").slice(0, 200))}`);
  lines.push(`Ref: ${esc(o.externalRef)}`);
  return lines.join("\n");
}

/** Redacted copy of the raw payload for the order's audit column: known keys only, no card data. */
export function redactRawOrder(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (/card|cvv|pan|token|secret|password|authorization/i.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 300);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 50).map((x) => (isPlainObject(x) ? redactRawOrder(x) : typeof x === "string" ? x.slice(0, 300) : x));
    else if (isPlainObject(v)) out[k] = redactRawOrder(v);
  }
  return out;
}
