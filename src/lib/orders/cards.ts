import type { CardButton } from "@/lib/notifications/telegram/callbacks";
import { escapeHtml } from "@/lib/notifications/telegram/core";
import { paymentLabel, type PaymentMethod, type PaymentState } from "./contract";
import { EXCEPTION_LABEL, isInvoiceExceptionReason, planLabel, type InvoicePlan } from "./eligibility";

/**
 * The owner's [Orders] Telegram cards and their buttons. Pure: text and a
 * button plan only; the runner signs the actions and talks to Telegram.
 * Every dynamic value is HTML-escaped. Nothing here is ever shown to a buyer.
 */
export type CardOrder = {
  id: string;
  external_ref: string | null;
  pictime_order_id: string | null;
  customer_name: string;
  customer_email: string | null;
  gallery_name: string | null;
  amount_qr: number;
  currency: string;
  status: string;
  payment_method: string;
  payment_state: string;
  invoice_requested_at: string | null;
  invoice_email_state: string;
  invoice_email_count: number;
  invoice_exception: string | null;
  provider_invoice_id: string | null;
  payment_url: string | null;
  fulfilled_at: string | null;
};

export type OrderCard = { text: string; buttons: CardButton[][] };

/** Dedupe keys of the [Orders] cards about one order (also used to edit or disarm earlier cards). */
export const orderCardKeys = {
  placed: (o: { source: string; external_ref: string | null; id: string }) => (o.external_ref ? `order:${o.source}:${o.external_ref}` : `order:${o.id}`),
  invoice: (o: { id: string }, count: number) => `order:${o.id}:invoice:${count}`,
  invoiceSent: (o: { id: string }, count: number) => `order:${o.id}:invoice-sent:${count}`,
  invoiceFailed: (o: { id: string }, count: number) => `order:${o.id}:invoice-failed:${count}`,
  exception: (o: { id: string }, reason: string, n: number) => `order:${o.id}:exception:${reason}:${n}`,
  paid: (o: { id: string }) => `order-payment:${o.id}:paid`,
  fulfilled: (o: { id: string }) => `order:${o.id}:fulfilled`,
};

/** Every card key whose buttons must go dark once the order is paid or closed. */
export function supersededOrderKeys(o: { source: string; external_ref: string | null; id: string; invoice_email_count: number }): string[] {
  const keys = [orderCardKeys.placed(o)];
  const count = Math.max(1, o.invoice_email_count || 1);
  keys.push(orderCardKeys.invoice(o, count), orderCardKeys.invoiceSent(o, count));
  return keys;
}

const money = (o: Pick<CardOrder, "amount_qr" | "currency">) => `${Number(o.amount_qr).toFixed(2)} ${o.currency}`;
const ref = (o: Pick<CardOrder, "external_ref" | "pictime_order_id" | "id">) => o.external_ref ?? o.pictime_order_id ?? o.id.slice(0, 8);

export function orderPageUrl(siteUrl: string, orderId: string): string {
  return `${siteUrl.replace(/\/$/, "")}/orders/${orderId}`;
}

function maskEmail(address: string | null): string {
  if (!address) return "no e-mail";
  const at = address.indexOf("@");
  return at <= 0 ? "***" : `${address.slice(0, 1)}***@${address.slice(at + 1)}`;
}

function headerLines(o: CardOrder): string[] {
  const lines = [`Order ${escapeHtml(ref(o))}`, `Buyer: ${escapeHtml(o.customer_name)}`];
  if (o.gallery_name) lines.push(`Gallery: ${escapeHtml(o.gallery_name)}`);
  lines.push(`Amount: ${escapeHtml(money(o))}`);
  return lines;
}

/** Owner-facing payment line. */
export function paymentLine(o: Pick<CardOrder, "payment_method" | "payment_state" | "provider_invoice_id">): string {
  return `Payment: ${escapeHtml(paymentLabel(o.payment_method as PaymentMethod, o.payment_state as PaymentState))}`;
}

/** Owner-facing invoice / e-mail line from the order's own columns. */
export function invoiceLine(o: Pick<CardOrder, "invoice_requested_at" | "invoice_email_state" | "invoice_email_count" | "invoice_exception" | "provider_invoice_id" | "payment_url">): string {
  if (o.invoice_exception) {
    const why = isInvoiceExceptionReason(o.invoice_exception) ? EXCEPTION_LABEL[o.invoice_exception] : o.invoice_exception;
    return `Invoice: needs attention (${escapeHtml(why)})`;
  }
  switch (o.invoice_email_state) {
    case "sent":
      return `Invoice: payment link e-mailed${o.invoice_email_count > 1 ? ` (${o.invoice_email_count}×)` : ""}`;
    case "queued":
      return "Invoice: payment link created, e-mail queued";
    case "failed":
      return "Invoice: e-mail failed. Tap Retry e-mail.";
    default:
      if (o.invoice_requested_at) return "Invoice: queued";
      return o.payment_url ? "Invoice: payment link ready, not e-mailed" : "Invoice: not sent";
  }
}

const view = (siteUrl: string, o: CardOrder): CardButton => ({ text: "View order", url: orderPageUrl(siteUrl, o.id) });

/** Buttons for an order in its current state; stale actions are never offered. */
export function orderButtons(o: CardOrder, siteUrl: string): CardButton[][] {
  const closed = o.status === "cancelled" || o.payment_state === "refunded";
  if (closed) return [[view(siteUrl, o)]];
  if (o.payment_state === "paid") {
    return o.status === "fulfilled" ? [[view(siteUrl, o)]] : [[{ text: "Done (photos released)", action: "done" }], [view(siteUrl, o)]];
  }
  if (!(Number(o.amount_qr) > 0) || o.payment_method === "card") return [[view(siteUrl, o)]];
  const rows: CardButton[][] = [];
  // "Invoice" means a payment request exists at the provider. Until then the
  // only sensible action is Send invoice (which creates it, idempotently);
  // after that, Check payment and another e-mail with the SAME link.
  const hasInvoice = Boolean(o.provider_invoice_id);
  if (!hasInvoice) rows.push([{ text: "Send invoice", action: "send" }]);
  else {
    const second: CardButton[] = [{ text: "Check payment", action: "check" }];
    second.push({ text: o.invoice_email_state === "failed" || o.invoice_email_state === "exception" ? "Retry e-mail" : "Resend e-mail", action: "resend" });
    rows.push(second);
  }
  rows.push([view(siteUrl, o)]);
  return rows;
}

/** The first card, written at intake. The runner prefixes "[Orders]". */
export function placedCard(o: CardOrder, plan: InvoicePlan, siteUrl: string): OrderCard {
  const lines = [`<b>New photo order — ${escapeHtml(o.customer_name)}</b>`, ...headerLines(o), paymentLine(o), escapeHtml(planLabel(plan))];
  return { text: lines.join("\n"), buttons: orderButtons(o, siteUrl) };
}

/** Status card after the invoice job ran (or the owner pressed something). */
export function invoiceCard(o: CardOrder, siteUrl: string, note?: string | null): OrderCard {
  const lines = [`<b>Photo order — ${escapeHtml(o.customer_name)}</b>`, ...headerLines(o), paymentLine(o), invoiceLine(o)];
  if (o.customer_email && o.invoice_email_state !== "none") lines.push(`E-mail: ${escapeHtml(maskEmail(o.customer_email))}`);
  if (note) lines.push(escapeHtml(note));
  return { text: lines.join("\n"), buttons: orderButtons(o, siteUrl) };
}

/** Card for a verified payment; supersedes the earlier cards' buttons. */
export function paidCard(o: CardOrder, siteUrl: string, paid: { amountText: string; source: "online" | "owner" }): OrderCard {
  const lines = [
    `<b>Payment confirmed — ${escapeHtml(o.customer_name)}</b>`,
    `Amount: ${escapeHtml(paid.amountText)}${paid.source === "online" ? " (online payment, verified)" : " (confirmed by you)"}`,
    `Order ${escapeHtml(ref(o))}`,
  ];
  if (o.gallery_name) lines.push(`Gallery: ${escapeHtml(o.gallery_name)}`);
  lines.push(o.status === "fulfilled" ? "Fulfilment: done" : "Fulfilment: pending. Release the purchased photos in the gallery, then tap Done.");
  if (o.status === "cancelled") lines.push("⚠ This order was marked cancelled, and the buyer paid anyway. Check it.");
  return { text: lines.join("\n"), buttons: orderButtons({ ...o, payment_state: "paid" }, siteUrl) };
}

/** Card for a problem the owner must resolve by hand. */
export function exceptionCard(o: CardOrder, siteUrl: string, detail: string): OrderCard {
  const lines = [`<b>Order needs attention — ${escapeHtml(o.customer_name)}</b>`, ...headerLines(o), paymentLine(o), escapeHtml(detail)];
  return { text: lines.join("\n"), buttons: orderButtons(o, siteUrl) };
}
