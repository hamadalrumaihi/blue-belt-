import type { Json } from "@/lib/supabase/database.types";
import { isPlainObject } from "@/lib/validation";
import { OFFLINE_METHODS, type PaymentMethod } from "./contract";

/**
 * Who gets a payment link, and when. Pure, so the intake route, the invoice
 * runner, the dashboard and the Telegram buttons all agree, and the tests can
 * pin every rule without a database.
 *
 * Two modes, chosen by the owner in Settings and kept on
 * photo_studio.settings.orderInvoicing:
 *   auto    eligible new orders get their payment link without anyone pressing
 *           anything; `autoSince` is the activation time, and an order that
 *           arrived before it is NEVER billed automatically (history is safe);
 *   review  every order waits for the owner's "Send invoice" (Telegram or dashboard).
 * The server-side flag PAYMENTS_AUTO_INVOICE_ENABLED is the master switch for
 * the automatic path; with it off, "auto" behaves like "review".
 */
export type InvoiceMode = "auto" | "review";

export type OrderInvoicingSettings = {
  mode: InvoiceMode;
  /** Set each time automatic mode is switched on; orders received before it stay manual. */
  autoSince: string | null;
};

export const DEFAULT_ORDER_INVOICING: OrderInvoicingSettings = { mode: "review", autoSince: null };

export function readOrderInvoicing(settings: Json | null | undefined): OrderInvoicingSettings {
  if (!isPlainObject(settings) || !isPlainObject(settings.orderInvoicing)) return DEFAULT_ORDER_INVOICING;
  const raw = settings.orderInvoicing;
  const mode: InvoiceMode = raw.mode === "auto" ? "auto" : "review";
  const since = typeof raw.autoSince === "string" && Number.isFinite(Date.parse(raw.autoSince)) ? new Date(raw.autoSince).toISOString() : null;
  return { mode, autoSince: since };
}

/** The order columns the rules read. */
export type PlanOrder = {
  status: string;
  payment_state: string;
  payment_method: string;
  amount_qr: number;
  customer_email: string | null;
  received_at: string | null;
  created_at: string;
  invoice_requested_at: string | null;
  invoice_completed_at: string | null;
  invoice_exception: string | null;
};

/** Why an order sits in the exception queue instead of getting its link automatically. */
export type InvoiceExceptionReason = "no_email" | "invalid_email" | "unknown_method" | "payments_off" | "email_disabled" | "provider_failed";

export type SkipReason = "paid" | "refunded" | "cancelled" | "free" | "card" | "already_requested";

export type InvoicePlan =
  | { kind: "auto" }
  | { kind: "review"; reason: "mode" | "auto_off" | "historical" | "not_activated" }
  | { kind: "exception"; reason: InvoiceExceptionReason }
  | { kind: "skip"; reason: SkipReason };

export type PlanContext = {
  settings: OrderInvoicingSettings;
  /** isPaymentsEnabled() */
  paymentsEnabled: boolean;
  /** PAYMENTS_AUTO_INVOICE_ENABLED=1 */
  autoEnabled: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when money is genuinely still owed on this order (existing clients included). */
export function isOutstanding(order: Pick<PlanOrder, "status" | "payment_state" | "amount_qr">): boolean {
  return order.status !== "cancelled" && order.payment_state !== "paid" && order.payment_state !== "refunded" && Number(order.amount_qr) > 0;
}

/** Whether an order's money is collected by the photographer (and so needs our payment link) or was settled inside the gallery. */
export function collectedByPhotographer(method: string): boolean {
  return OFFLINE_METHODS.includes(method as PaymentMethod);
}

/**
 * Hard blockers for ANY invoice (automatic or owner-pressed): nothing here may
 * ever be billed. Returns the reason, or null when a link may be created.
 */
export function invoiceBlocker(order: Pick<PlanOrder, "status" | "payment_state" | "amount_qr" | "payment_method">): SkipReason | null {
  if (order.status === "cancelled") return "cancelled";
  if (order.payment_state === "refunded") return "refunded";
  if (order.payment_state === "paid") return "paid";
  if (!(Number(order.amount_qr) > 0)) return "free";
  // Settled by card inside the gallery: a link would ask the buyer to pay twice.
  if (order.payment_method === "card") return "card";
  return null;
}

/** The customer e-mail problem, if any, that would stop the link from being sent. */
export function emailProblem(email: string | null): Extract<InvoiceExceptionReason, "no_email" | "invalid_email"> | null {
  if (!email || !email.trim()) return "no_email";
  return EMAIL_RE.test(email.trim()) ? null : "invalid_email";
}

/** When the order arrived, for the activation cutoff (received_at, else created_at). */
export function orderArrivedAt(order: Pick<PlanOrder, "received_at" | "created_at">): string {
  return order.received_at ?? order.created_at;
}

/**
 * What should happen to a freshly recorded order. Called once at intake and
 * again by the runner before it bills anything (so a mode change between the
 * two is honoured).
 */
export function planInvoice(order: PlanOrder, ctx: PlanContext): InvoicePlan {
  const blocker = invoiceBlocker(order);
  if (blocker) return { kind: "skip", reason: blocker };
  if (order.invoice_requested_at) return { kind: "skip", reason: "already_requested" };
  if (!collectedByPhotographer(order.payment_method)) return { kind: "exception", reason: "unknown_method" };
  const email = emailProblem(order.customer_email);
  if (email) return { kind: "exception", reason: email };
  if (ctx.settings.mode !== "auto") return { kind: "review", reason: "mode" };
  if (!ctx.autoEnabled) return { kind: "review", reason: "auto_off" };
  if (!ctx.paymentsEnabled) return { kind: "exception", reason: "payments_off" };
  if (!ctx.settings.autoSince) return { kind: "review", reason: "not_activated" };
  if (orderArrivedAt(order) < ctx.settings.autoSince) return { kind: "review", reason: "historical" };
  return { kind: "auto" };
}

/** Owner-facing words for a plan, used on the Telegram card and the order page. */
export function planLabel(plan: InvoicePlan): string {
  switch (plan.kind) {
    case "auto":
      return "Invoice: queued automatically";
    case "review":
      return plan.reason === "historical" ? "Invoice: not sent automatically (order is older than the activation time). Tap Send invoice to send it." : "Invoice: waiting for you. Tap Send invoice to e-mail the payment link.";
    case "exception":
      return `Invoice: needs attention (${EXCEPTION_LABEL[plan.reason]}).`;
    case "skip":
      return SKIP_LABEL[plan.reason];
  }
}

export const EXCEPTION_LABEL: Record<InvoiceExceptionReason, string> = {
  no_email: "no e-mail address on the order",
  invalid_email: "the e-mail address on the order is not valid",
  unknown_method: "payment method unknown",
  payments_off: "online payments are not configured",
  email_disabled: "payment-link e-mails are switched off under Notifications",
  provider_failed: "the payment service could not create the invoice",
};

export const SKIP_LABEL: Record<SkipReason, string> = {
  paid: "Invoice: not needed, already paid.",
  refunded: "Invoice: not needed, refunded.",
  cancelled: "Invoice: not needed, order cancelled.",
  free: "Invoice: not needed, nothing to pay.",
  card: "Invoice: not needed, paid by card in the gallery.",
  already_requested: "Invoice: already requested.",
};

export function isInvoiceExceptionReason(v: unknown): v is InvoiceExceptionReason {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(EXCEPTION_LABEL, v);
}
