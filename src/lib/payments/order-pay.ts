import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import type { Logger } from "@/lib/log";
import { DEFAULT_STUDIO } from "@/lib/studio/queries";
import type { Database, PhotoOrderRow } from "@/lib/supabase/database.types";
import { createInvoiceForOrder, invoiceExpiryDate, providerPaymentUrl, supersedeOrderInvoice } from "./invoicing";
import type { PaymentProvider } from "./myfatoorah/client";
import { applyStatusToOrder, mapInquiry, supersededInvoices } from "./myfatoorah/webhook";
import { hashPayToken, isOrderPayTokenShape, isPayTokenExpired, PAY_TOKEN_TTL_MS } from "./pay-token";

type Client = SupabaseClient<Database>;

/**
 * The private order payment page (`/pay/order/<token>`). No session: the
 * token is the credential. The amount, the currency and the items come from
 * the order row; the query string decides only whether to ask the provider
 * about a returned payment, never what to believe.
 *
 *   - "Pay online" opens the provider's hosted page for the order's invoice.
 *     Before that the invoice is checked: already paid -> the order is marked
 *     paid with the webhook's rules and the page shows it; cancelled or
 *     expired -> a fresh invoice replaces it (old id kept as superseded);
 *   - the return visit verifies the payment id against THIS order's invoice
 *     and applies the same atomic rules (amount + currency enforced);
 *   - a paid, refunded or cancelled order never starts a payment.
 */
export type OrderPayDeps = {
  supabase: Client;
  now: () => Date;
  log: Logger;
  provider: PaymentProvider | null;
  enabled: boolean;
  siteUrl: string;
};

export type OrderPayState = "payable" | "payments_off" | "paid" | "refunded" | "cancelled" | "expired" | "failed";

export type OrderPayItem = { name: string; quantity: number };

/** What the public page may show: reference, items, amount, state. No e-mail, phone, provider ids or internal states. */
export type OrderPayView = {
  reference: string | null;
  customerFirstName: string;
  galleryName: string | null;
  amountQr: number;
  currency: string;
  items: OrderPayItem[];
  state: OrderPayState;
  paidAt: string | null;
  payable: boolean;
};

type Found = { order: PhotoOrderRow; expired: boolean };

async function findByToken(supabase: Client, token: string, now: Date): Promise<Found | null> {
  if (!isOrderPayTokenShape(token)) return null;
  const hash = hashPayToken(token);
  const { data } = await supabase.from("photo_orders").select("*").eq("pay_token_hash", hash).maybeSingle();
  if (!data || data.pay_token_hash !== hash) return null;
  const unpaid = data.payment_state !== "paid" && data.payment_state !== "refunded";
  return { order: data, expired: unpaid && isPayTokenExpired(data.pay_token_created_at, now, PAY_TOKEN_TTL_MS) };
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

export function itemsOf(order: Pick<PhotoOrderRow, "items">): OrderPayItem[] {
  const raw = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [];
  return raw
    .filter((it) => it && typeof it.name === "string" && String(it.name).trim())
    .slice(0, 50)
    .map((it) => ({ name: String(it.name).trim().slice(0, 120), quantity: Math.max(1, Math.round(Number(it.quantity) || 1)) }));
}

export function orderPayState(order: PhotoOrderRow, enabled: boolean, expired: boolean): OrderPayState {
  if (order.payment_state === "refunded") return "refunded";
  if (order.payment_state === "paid") return "paid";
  if (order.status === "cancelled") return "cancelled";
  if (expired) return "expired";
  if (!enabled) return "payments_off";
  if (!(Number(order.amount_qr) > 0)) return "cancelled";
  return order.payment_state === "failed" ? "failed" : "payable";
}

export function orderPayView(order: PhotoOrderRow, enabled: boolean, expired: boolean): OrderPayView {
  const state = orderPayState(order, enabled, expired);
  return {
    reference: order.external_ref ?? order.pictime_order_id,
    customerFirstName: firstName(order.customer_name),
    galleryName: order.gallery_name,
    amountQr: Math.round(Number(order.amount_qr) * 100) / 100,
    currency: order.currency,
    items: itemsOf(order),
    state,
    paidAt: order.payment_state === "paid" ? order.paid_at ?? order.payment_confirmed_at : null,
    payable: state === "payable" || state === "failed",
  };
}

export type LoadOrderPayResult = { ok: true; view: OrderPayView; studioName: string } | { ok: false; error: "not_found" };

export async function loadOrderPay(token: string, deps: OrderPayDeps): Promise<LoadOrderPayResult> {
  const found = await findByToken(deps.supabase, token, deps.now());
  if (!found) return { ok: false, error: "not_found" };
  const { data } = await deps.supabase.from("photo_studio").select("business_name").eq("owner_id", found.order.owner_id).maybeSingle();
  return { ok: true, view: orderPayView(found.order, deps.enabled, found.expired), studioName: data?.business_name ?? DEFAULT_STUDIO.business_name };
}

export type OrderPayActionError = "not_found" | "expired" | "not_payable" | "payments_off" | "provider_error" | "paid";
export type StartOrderPaymentResult = { ok: true; redirectUrl: string; invoiceId: string } | { ok: false; error: OrderPayActionError };

/**
 * "Pay online": the hosted page for the order's current invoice. Checks the
 * invoice first and renews it when the provider says it is cancelled or
 * expired; never charges anything itself.
 */
export async function startOrderHostedPayment(token: string, deps: OrderPayDeps): Promise<StartOrderPaymentResult> {
  const found = await findByToken(deps.supabase, token, deps.now());
  if (!found) return { ok: false, error: "not_found" };
  if (found.expired) return { ok: false, error: "expired" };
  let order = found.order;
  const state = orderPayState(order, deps.enabled, false);
  if (state === "paid") return { ok: false, error: "paid" };
  if (state === "payments_off") return { ok: false, error: "payments_off" };
  if (!(state === "payable" || state === "failed")) return { ok: false, error: "not_payable" };
  if (!deps.provider) return { ok: false, error: "payments_off" };

  const invoiceDeps = { supabase: deps.supabase, now: deps.now, log: deps.log };
  if (order.provider_invoice_id) {
    const inquiry = await deps.provider.getPaymentStatus({ key: order.provider_invoice_id, keyType: "InvoiceId" });
    if (inquiry.ok) {
      const mapping = mapInquiry(inquiry.data);
      if (mapping.kind === "apply" && mapping.status === "paid") {
        const applied = await applyStatusToOrder(order, mapping, { source: "pay-page:start", eventId: mapping.paymentId ? `start:${mapping.paymentId}` : null }, invoiceDeps);
        if (applied.result === "processed" || applied.state === "paid") return { ok: false, error: "paid" };
        if (applied.result === "amount_mismatch") return { ok: false, error: "not_payable" };
      }
      const status = inquiry.data.invoiceStatus.toUpperCase();
      const dead = status === "CANCELED" || status === "CANCELLED" || status === "EXPIRED" || (mapping.kind === "apply" && mapping.status === "cancelled");
      const url = providerPaymentUrl(order);
      if (!dead && url) return { ok: true, redirectUrl: url, invoiceId: order.provider_invoice_id };
      // Dead at the provider, or relinked without a URL: replace it.
      const moved = await supersedeOrderInvoice(order, invoiceDeps, dead ? `provider:${status.toLowerCase()}` : "no_url");
      if (!moved) return { ok: false, error: "provider_error" };
      // Re-read so the new invoice is recorded on top of the superseded list, not over it.
      const { data: fresh } = await deps.supabase.from("photo_orders").select("*").eq("id", order.id).maybeSingle();
      order = fresh ?? { ...order, provider_invoice_id: null, invoice_claimed_at: null };
    } else {
      const url = providerPaymentUrl(order);
      if (url) return { ok: true, redirectUrl: url, invoiceId: order.provider_invoice_id };
      deps.log.warn("payments.order_pay_inquiry_failed", { orderId: order.id, code: inquiry.error.code });
      return { ok: false, error: "provider_error" };
    }
  }

  const created = await createInvoiceForOrder(order, deps.provider, invoiceDeps, {
    callbackUrl: `${order.payment_url ?? `${deps.siteUrl}/pay/order/${token}`}?result=callback`,
    errorUrl: `${order.payment_url ?? `${deps.siteUrl}/pay/order/${token}`}?result=error`,
    expiryDate: invoiceExpiryDate(deps.now(), 30),
  });
  if (!created.ok) {
    if (created.reason === "already_paid") return { ok: false, error: "paid" };
    if (created.reason === "in_progress") return { ok: false, error: "provider_error" };
    deps.log.warn("payments.order_pay_create_failed", { orderId: order.id, reason: created.reason, detail: created.detail });
    return { ok: false, error: created.reason === "provider_error" ? "provider_error" : "not_payable" };
  }
  if (!created.paymentUrl) return { ok: false, error: "provider_error" };
  await writeAudit(deps.supabase, { ownerId: order.owner_id, actorKind: "client", entity: "order", entityId: order.id, action: "payment.session_started", data: { invoice_id: created.invoiceId, amount_qr: order.amount_qr, currency: order.currency, kind: "hosted", renewed: found.order.provider_invoice_id !== null } }).catch(() => ({ ok: false }));
  return { ok: true, redirectUrl: created.paymentUrl, invoiceId: created.invoiceId };
}

export type OrderVerifyStatus = "paid" | "pending" | "failed" | "mismatch" | "unavailable" | "provider_error" | "invalid";
export type OrderVerifyResult = { status: OrderVerifyStatus; detail?: string };

const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The return visit. The redirect proves nothing: the provider is asked about
 * the payment id, the answer must name THIS order's invoice (or one it
 * superseded), and only then is the webhook's transition applied.
 */
export async function verifyReturnedOrderPayment(token: string, paymentId: string, deps: OrderPayDeps): Promise<OrderVerifyResult> {
  if (typeof paymentId !== "string" || !PAYMENT_ID_RE.test(paymentId)) return { status: "invalid" };
  const found = await findByToken(deps.supabase, token, deps.now());
  if (!found) return { status: "invalid" };
  const { order } = found;
  if (order.payment_state === "paid") return { status: "paid" };
  if (!deps.enabled || !deps.provider) return { status: "unavailable" };
  const res = await deps.provider.getPaymentStatus({ key: paymentId, keyType: "PaymentId" });
  if (!res.ok) {
    deps.log.warn("payments.order_pay_verify_failed", { orderId: order.id, code: res.error.code, httpStatus: res.error.httpStatus });
    return { status: "provider_error" };
  }
  const inquiry = res.data;
  const metadata = order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata) ? (order.metadata as Record<string, unknown>) : {};
  const known = inquiry.invoiceId === order.provider_invoice_id || supersededInvoices(metadata, null).includes(inquiry.invoiceId);
  if (!known) {
    deps.log.warn("payments.order_pay_verify_wrong_invoice", { orderId: order.id, invoiceId: inquiry.invoiceId });
    return { status: "mismatch", detail: "invoice" };
  }
  const mapping = mapInquiry(inquiry);
  if (mapping.kind === "ignore") return { status: "pending" };
  const applied = await applyStatusToOrder(order, mapping, { source: `pay-page:${paymentId}`, eventId: `return:${paymentId}` }, { supabase: deps.supabase, now: deps.now, log: deps.log });
  if (applied.result === "amount_mismatch") return { status: "mismatch", detail: applied.detail };
  if (mapping.status === "paid") return applied.result === "processed" || applied.result === "unchanged" || applied.state === "paid" ? { status: "paid" } : { status: "pending", detail: applied.detail };
  if (mapping.status === "failed" || mapping.status === "cancelled") return { status: "failed" };
  return { status: "pending" };
}
