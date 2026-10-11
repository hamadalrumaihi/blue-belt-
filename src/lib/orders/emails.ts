import { buildEmail, type EmailContent, type EmailDraft } from "@/lib/notifications/email/templates";

/**
 * Customer e-mails about a photo order. Pure: the same wording for the
 * runner, the owner's "Resend" and the tests. Customer copy rules: "Online
 * payment", "Private gallery", no provider names, no internal ids, short
 * sentences, no em dashes.
 */
export type OrderEmailOrder = {
  customer_name: string;
  customer_email: string | null;
  external_ref: string | null;
  pictime_order_id: string | null;
  gallery_name: string | null;
  amount_qr: number;
  currency: string;
  items: unknown;
};

type Item = { name?: unknown; quantity?: unknown };

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

export function orderReference(o: Pick<OrderEmailOrder, "external_ref" | "pictime_order_id">): string | null {
  return o.external_ref ?? o.pictime_order_id ?? null;
}

export function formatOrderMoney(amount: number, currency: string): string {
  return `${Number(amount).toLocaleString("en-QA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${(currency || "QAR").toUpperCase()}`;
}

/** "2× Digital download, 1× Print 20x30" from the stored items, at most eight. */
export function itemsSummary(items: unknown): string | null {
  const raw = Array.isArray(items) ? (items as Item[]) : [];
  const parts = raw
    .filter((it) => it && typeof it.name === "string" && it.name.trim())
    .slice(0, 8)
    .map((it) => `${Math.max(1, Math.round(Number(it.quantity) || 1))}× ${String(it.name).trim()}`);
  if (!parts.length) return null;
  return raw.length > 8 ? `${parts.join(", ")} and ${raw.length - 8} more` : parts.join(", ");
}

export function orderFacts(o: OrderEmailOrder): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  const ref = orderReference(o);
  if (ref) facts.push(["Order reference", ref]);
  if (o.gallery_name) facts.push(["Private gallery", o.gallery_name]);
  const items = itemsSummary(o.items);
  if (items) facts.push(["Items", items]);
  facts.push(["Amount due", formatOrderMoney(o.amount_qr, o.currency)]);
  return facts;
}

export function orderPaymentLinkContent(o: OrderEmailOrder, opts: { businessName: string; payUrl: string }): EmailContent {
  const ref = orderReference(o);
  return {
    kind: "ORDER_PAYMENT_LINK",
    businessName: opts.businessName,
    subject: ref ? `Your photo order payment link (order ${ref})` : "Your photo order payment link",
    greeting: `Hi ${firstName(o.customer_name)},`,
    paragraphs: [
      `Thank you for your photo order from your private gallery. The amount due is ${formatOrderMoney(o.amount_qr, o.currency)}.`,
      "Open your payment link below to pay online by card. The page shows your order reference, the items and the amount before you pay.",
      "Your purchased photos are released once the payment is confirmed. If anything looks wrong, reply to this e-mail before paying.",
    ],
    facts: orderFacts(o),
    cta: { label: "Pay online", url: opts.payUrl },
    footer: `${opts.businessName} · This message was sent about your photo order.`,
  };
}

export function orderPaymentReceivedContent(o: OrderEmailOrder, opts: { businessName: string; amountText: string }): EmailContent {
  const ref = orderReference(o);
  return {
    kind: "ORDER_PAYMENT_RECEIVED",
    businessName: opts.businessName,
    subject: ref ? `Your payment was received (order ${ref})` : "Your payment was received",
    greeting: `Hi ${firstName(o.customer_name)},`,
    paragraphs: [`We received your payment of ${opts.amountText}. Thank you.`, "We are preparing your purchased photos for download in your private gallery. You will hear from us as soon as they are released."],
    facts: orderFacts(o).filter(([k]) => k !== "Amount due"),
    cta: null,
    footer: `${opts.businessName} · This message was sent about your photo order.`,
  };
}

export function orderPaymentLinkEmail(o: OrderEmailOrder, opts: { businessName: string; payUrl: string }): EmailDraft | null {
  if (!o.customer_email) return null;
  return buildEmail(o.customer_email, orderPaymentLinkContent(o, opts));
}

export function orderPaymentReceivedEmail(o: OrderEmailOrder, opts: { businessName: string; amountText: string }): EmailDraft | null {
  if (!o.customer_email) return null;
  return buildEmail(o.customer_email, orderPaymentReceivedContent(o, opts));
}

/** Dedupe keys: one link mail per send count (a resend is a new key), one receipt per order. */
export function orderEmailAlertKey(kind: "ORDER_PAYMENT_LINK" | "ORDER_PAYMENT_RECEIVED", orderId: string, sendCount?: number): string {
  return kind === "ORDER_PAYMENT_LINK" ? `email:order:${orderId}:payment-link:${sendCount ?? 1}` : `email:order:${orderId}:paid`;
}
