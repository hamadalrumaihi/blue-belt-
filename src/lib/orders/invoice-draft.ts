import { METHOD_LABEL, type PaymentMethod, type PaymentState } from "./contract";

/**
 * Invoice drafts for Pic-Time orders from buyers who are not already clients.
 *
 * A draft is only ever prepared for the owner to review: it is put in the
 * owner's own Telegram [Orders] message and on the order page, and the owner
 * decides whether and how to send it. Nothing here messages a buyer, charges
 * anyone or talks to a payment provider. Prices are never invented: a line
 * without a unit price stays blank and the total is the order's own amount.
 */

export type ClientCandidate = { id: string; name: string; email: string | null; phone: string | null };
export type ClientMatch = { athleteId: string; name: string; by: "email" | "phone" };

export type DraftOrder = {
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  gallery_name: string | null;
  external_ref: string | null;
  amount: number;
  currency: string;
  payment_method: PaymentMethod;
  payment_state: PaymentState;
  status: string;
  items: unknown;
};

export type InvoiceDraftLine = { description: string; quantity: number; unitAmount: number | null; amount: number | null };

export type InvoiceDraft = {
  billTo: { name: string; email: string | null; phone: string | null };
  reference: string | null;
  gallery: string | null;
  lines: InvoiceDraftLine[];
  total: number;
  currency: string;
  paymentMethod: PaymentMethod;
  /** False when the priced lines do not add up to the order total (or some lines have no price). */
  linesMatchTotal: boolean;
};

/** Why an order does or does not get an invoice draft, in owner-facing terms. */
export type InvoiceNeed =
  | { kind: "draft" }
  | { kind: "client"; match: ClientMatch }
  | { kind: "paid" }
  | { kind: "card" }
  | { kind: "closed" }
  | { kind: "no_amount" };

/** Digits only, last 8 (Qatar numbers are 8 digits; this ignores +974 / 00974 prefixes). */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : null;
}

/** Finds the client (tracked athlete record) the buyer already is, by email first, then phone. */
export function matchClient(buyer: { email: string | null; phone: string | null }, clients: ClientCandidate[]): ClientMatch | null {
  const email = buyer.email?.trim().toLowerCase() || null;
  if (email) {
    const hit = clients.find((c) => c.email?.trim().toLowerCase() === email);
    if (hit) return { athleteId: hit.id, name: hit.name, by: "email" };
  }
  const phone = phoneKey(buyer.phone);
  if (phone) {
    const hit = clients.find((c) => phoneKey(c.phone) === phone);
    if (hit) return { athleteId: hit.id, name: hit.name, by: "phone" };
  }
  return null;
}

/**
 * Decides whether the owner needs an invoice for this order. Card orders are
 * settled inside Pic-Time, so invoicing them would ask the buyer to pay twice.
 */
export function invoiceNeed(order: Pick<DraftOrder, "payment_method" | "payment_state" | "status" | "amount">, client: ClientMatch | null): InvoiceNeed {
  if (order.status === "cancelled") return { kind: "closed" };
  if (order.payment_state === "paid" || order.payment_state === "refunded") return { kind: "paid" };
  if (order.payment_method === "card") return { kind: "card" };
  if (client) return { kind: "client", match: client };
  if (!(order.amount > 0)) return { kind: "no_amount" };
  return { kind: "draft" };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function buildInvoiceDraft(order: DraftOrder): InvoiceDraft {
  const raw = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [];
  const lines: InvoiceDraftLine[] = raw.slice(0, 50).map((it) => {
    const quantity = Math.max(1, Math.round(num(it?.quantity) ?? 1));
    const unitAmount = num(it?.unitAmount);
    return {
      description: typeof it?.name === "string" && it.name.trim() ? it.name.trim() : "Item",
      quantity,
      unitAmount,
      amount: unitAmount === null ? null : Math.round(unitAmount * quantity * 100) / 100,
    };
  });
  const priced = lines.every((l) => l.amount !== null);
  const sum = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  return {
    billTo: { name: order.customer_name, email: order.customer_email, phone: order.customer_phone },
    reference: order.external_ref,
    gallery: order.gallery_name,
    lines,
    total: order.amount,
    currency: order.currency,
    paymentMethod: order.payment_method,
    linesMatchTotal: lines.length > 0 && priced && Math.abs(sum - order.amount) < 0.005,
  };
}

const money = (n: number, cur: string) => `${n.toFixed(2)} ${cur}`;

/** Plain text the owner can review, edit and paste to the buyer themselves. */
export function invoiceDraftText(d: InvoiceDraft): string {
  const out = ["Invoice — Blue Belt Media", `Bill to: ${d.billTo.name}`];
  const contact = [d.billTo.email, d.billTo.phone].filter(Boolean).join(" · ");
  if (contact) out.push(contact);
  const ref = [d.reference ? `Pic-Time order ${d.reference}` : null, d.gallery ? `Gallery: ${d.gallery}` : null].filter(Boolean).join(" · ");
  if (ref) out.push(ref);
  out.push("");
  for (const l of d.lines) out.push(`${l.quantity} × ${l.description}${l.amount !== null ? ` — ${money(l.amount, d.currency)}` : ""}`);
  if (d.lines.length) out.push("");
  out.push(`Total due: ${money(d.total, d.currency)}`);
  if (d.paymentMethod !== "unknown" && d.paymentMethod !== "card") out.push(`Payment by ${METHOD_LABEL[d.paymentMethod]}`);
  return out.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Extra lines for the owner's Telegram [Orders] message: who the buyer is and,
 * for a new buyer, the invoice draft to review. Never sent to the buyer.
 */
export function invoiceTelegramLines(need: InvoiceNeed, draft: InvoiceDraft | null, reviewUrl: string | null): string[] {
  switch (need.kind) {
    case "client":
      return [`Buyer: existing client (${esc(need.match.name)}, matched by ${need.match.by}) — no invoice draft prepared.`];
    case "paid":
    case "card":
      return ["Paid through Pic-Time — no invoice needed."];
    case "closed":
      return [];
    case "no_amount":
      return ["Buyer: new customer — no amount on the order, so no invoice draft. Check it in Pic-Time."];
    case "draft": {
      if (!draft) return [];
      const lines = ["Buyer: new customer — invoice draft below.", "", "<b>Invoice draft (not sent to the buyer)</b>"];
      const contact = [draft.billTo.email, draft.billTo.phone].filter(Boolean).map((s) => esc(String(s))).join(" · ");
      lines.push(`Bill to: ${esc(draft.billTo.name)}${contact ? ` · ${contact}` : ""}`);
      for (const l of draft.lines.slice(0, 8)) lines.push(`${l.quantity}× ${esc(l.description.slice(0, 80))}${l.amount !== null ? ` — ${money(l.amount, esc(draft.currency))}` : ""}`);
      if (draft.lines.length > 8) lines.push(`…and ${draft.lines.length - 8} more`);
      lines.push(`Total due: ${money(draft.total, esc(draft.currency))}`);
      if (!draft.linesMatchTotal && draft.lines.length) lines.push("Check: item prices are missing or do not add up to the total.");
      lines.push(reviewUrl ? `Review, copy and send it yourself: ${reviewUrl}` : "Review it on the order page and send it yourself.");
      return lines;
    }
  }
}

/** Owner bookkeeping kept on the order's metadata (no schema change). */
export function invoiceSentAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).invoice_sent_at;
  return typeof v === "string" && v ? v : null;
}

/** Maps a stored order row onto the draft input (amounts live in amount_qr). */
export function draftOrderOf(row: { customer_name: string; customer_email: string | null; customer_phone: string | null; gallery_name: string | null; external_ref: string | null; pictime_order_id: string | null; amount_qr: number; currency: string; payment_method: string; payment_state: string; status: string; items: unknown }): DraftOrder {
  return {
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    customer_phone: row.customer_phone,
    gallery_name: row.gallery_name,
    external_ref: row.external_ref ?? row.pictime_order_id,
    amount: Number(row.amount_qr),
    currency: row.currency,
    payment_method: row.payment_method as PaymentMethod,
    payment_state: row.payment_state as PaymentState,
    status: row.status,
    items: row.items,
  };
}
