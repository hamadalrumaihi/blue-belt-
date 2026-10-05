import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "@/lib/log";
import { OFFLINE_METHODS } from "@/lib/orders/contract";
import type { Database, Json, PhotoOrderRow } from "@/lib/supabase/database.types";
import { MYFATOORAH_PROVIDER, type CreateInvoiceInput, type PaymentProvider } from "./myfatoorah/client";

/**
 * Turning a Pic-Time order into a MyFatoorah invoice — the bridge between the
 * two previously separate worlds (orders intake and the invoice/booking
 * webhook). The order id is carried as the invoice `customerReference`
 * (MyFatoorah's ExternalIdentifier), so a later webhook or GetPaymentStatus can
 * resolve the invoice straight back to the order.
 *
 * Everything here only ever runs behind `isPaymentsEnabled()` (and, for the
 * automatic path, `isAutoInvoiceEnabled()`). The provider client is injected,
 * so no network call happens in tests or when payments are off. Creating an
 * invoice stores a payment URL on the order; it NEVER messages the customer —
 * delivering that link to the buyer is a separate, deliberately unbuilt step.
 */

export type InvoiceDeps = {
  supabase: SupabaseClient<Database>;
  now: () => Date;
  log: Logger;
};

export type CreateInvoiceForOrderResult =
  | { ok: true; orderId: string; invoiceId: string; paymentUrl: string; alreadyInvoiced?: false }
  | { ok: true; orderId: string; invoiceId: string; paymentUrl: string; alreadyInvoiced: true }
  | { ok: false; orderId: string; reason: "already_paid" | "cancelled" | "no_amount" | "provider_error"; detail?: string };

/**
 * An order is eligible for an AUTOMATIC invoice only when it is still unpaid,
 * not cancelled, carries a positive amount, has no invoice yet, and was paid by
 * an offline method (Fawran / bank transfer / cash). A card order is already
 * settled in Pic-Time, so auto-invoicing it would ask the buyer to pay twice —
 * never do that. Manual invoicing (the owner action) is less restrictive but
 * still refuses an order that is already paid or already invoiced.
 */
export function eligibleForAutoInvoice(order: PhotoOrderRow): boolean {
  if (order.provider_invoice_id) return false;
  if (order.status === "cancelled") return false;
  if (order.payment_state === "paid" || order.payment_state === "refunded") return false;
  if (!(order.amount_qr > 0)) return false;
  return OFFLINE_METHODS.includes(order.payment_method as (typeof OFFLINE_METHODS)[number]);
}

/** Builds the provider invoice request for an order; the order id is the shared reference. */
export function invoiceInputForOrder(order: PhotoOrderRow): CreateInvoiceInput {
  return {
    amount: order.amount_qr,
    customerName: order.customer_name,
    customerReference: order.id,
    customerEmail: order.customer_email ?? undefined,
    displayCurrencyIso: order.currency,
    language: "EN",
    userDefinedField: order.external_ref ?? order.pictime_order_id ?? undefined,
  };
}

/**
 * Creates a MyFatoorah invoice for one order and writes the invoice id +
 * payment URL back onto the order row. Refuses an order that is already paid,
 * cancelled or has no amount. If the order already carries an invoice it is a
 * no-op success (returns the existing invoice), so the call is safe to repeat.
 * The caller must have checked `isPaymentsEnabled()`.
 */
export async function createInvoiceForOrder(order: PhotoOrderRow, provider: PaymentProvider, deps: InvoiceDeps): Promise<CreateInvoiceForOrderResult> {
  if (order.provider_invoice_id && order.payment_url) {
    return { ok: true, orderId: order.id, invoiceId: order.provider_invoice_id, paymentUrl: order.payment_url, alreadyInvoiced: true };
  }
  if (order.status === "cancelled") return { ok: false, orderId: order.id, reason: "cancelled" };
  if (order.payment_state === "paid" || order.payment_state === "refunded") return { ok: false, orderId: order.id, reason: "already_paid" };
  if (!(order.amount_qr > 0)) return { ok: false, orderId: order.id, reason: "no_amount" };

  const created = await provider.createInvoice(invoiceInputForOrder(order));
  if (!created.ok) {
    deps.log.warn("payments.order_invoice_failed", { orderId: order.id, code: created.error.code, httpStatus: created.error.httpStatus });
    return { ok: false, orderId: order.id, reason: "provider_error", detail: created.error.code };
  }

  const metadata = isRecord(order.metadata) ? order.metadata : {};
  const { error } = await deps.supabase
    .from("photo_orders")
    .update({
      provider: MYFATOORAH_PROVIDER,
      provider_invoice_id: created.data.invoiceId,
      payment_url: created.data.paymentUrl,
      metadata: { ...metadata, invoice: { provider: MYFATOORAH_PROVIDER, invoice_id: created.data.invoiceId, customer_reference: created.data.customerReference, created_at: deps.now().toISOString() } } as Json,
    })
    .eq("id", order.id)
    .eq("owner_id", order.owner_id);
  if (error) {
    // The invoice exists at the provider but we failed to record it. Surface as
    // a provider_error so a later run (reconcile/auto) can re-link by reference.
    deps.log.error("payments.order_invoice_persist_failed", { orderId: order.id, invoiceId: created.data.invoiceId, error: error.message });
    return { ok: false, orderId: order.id, reason: "provider_error", detail: "persist_failed" };
  }
  deps.log.info("payments.order_invoiced", { orderId: order.id, invoiceId: created.data.invoiceId });
  return { ok: true, orderId: order.id, invoiceId: created.data.invoiceId, paymentUrl: created.data.paymentUrl };
}

/**
 * Automatic path (cron): invoices every eligible unpaid offline order that has
 * no invoice yet. Bounded by `limit`. Only called when both payments and
 * auto-invoicing are enabled; never messages the customer.
 */
export async function autoInvoiceOrders(provider: PaymentProvider, deps: InvoiceDeps, opts: { limit?: number } = {}): Promise<{ scanned: number; invoiced: number; failed: number }> {
  const { data: orders } = await deps.supabase
    .from("photo_orders")
    .select("*")
    .is("provider_invoice_id", null)
    .in("payment_state", ["pending", "unknown"])
    .neq("status", "cancelled")
    .in("payment_method", OFFLINE_METHODS as unknown as string[])
    .order("received_at", { ascending: true })
    .limit(opts.limit ?? 25);
  let invoiced = 0;
  let failed = 0;
  for (const order of (orders ?? []) as PhotoOrderRow[]) {
    if (!eligibleForAutoInvoice(order)) continue;
    const result = await createInvoiceForOrder(order, provider, deps);
    if (result.ok) invoiced += 1;
    else failed += 1;
  }
  return { scanned: (orders ?? []).length, invoiced, failed };
}

// ---------------------------------------------------------------------------
// Standalone / direct invoice — a booking not tied to any Pic-Time order
// ---------------------------------------------------------------------------

export type StandaloneInvoiceInput = {
  ownerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  packageName: string;
  amountQr: number;
  /** Optional athlete label for the owner's own reference; never creates a tracked athlete. */
  athleteName?: string | null;
  eventId?: string | null;
  currency?: string;
};

export type CreateStandaloneInvoiceResult =
  | { ok: true; bookingId: string; invoiceId: string; paymentUrl: string }
  | { ok: false; reason: "no_amount" | "insert_failed" | "provider_error"; detail?: string };

/**
 * Direct invoicing (no Pic-Time order): inserts a `photo_bookings` row owned by
 * the caller, then creates a MyFatoorah invoice whose customerReference is the
 * booking id. From then on the booking flows through the existing webhook /
 * reconcile path like any other. The caller must have checked
 * isPaymentsEnabled(); the Supabase client in deps is the owner's (RLS). Never
 * creates a tracked athlete.
 */
export async function createStandaloneInvoice(input: StandaloneInvoiceInput, provider: PaymentProvider, deps: InvoiceDeps): Promise<CreateStandaloneInvoiceResult> {
  if (!(input.amountQr > 0)) return { ok: false, reason: "no_amount" };
  const { data: booking, error: insertError } = await deps.supabase
    .from("photo_bookings")
    .insert({
      owner_id: input.ownerId,
      event_id: input.eventId ?? null,
      athlete_name: (input.athleteName ?? "").trim(),
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
      package_name: input.packageName,
      amount_qr: input.amountQr,
      currency: input.currency ?? "QAR",
      status: "pending",
      provider: MYFATOORAH_PROVIDER,
    })
    .select("*")
    .single();
  if (insertError || !booking) {
    deps.log.error("payments.standalone_insert_failed", { error: insertError?.message });
    return { ok: false, reason: "insert_failed", detail: insertError?.message };
  }

  const created = await provider.createInvoice({
    amount: input.amountQr,
    customerName: input.customerName,
    customerReference: booking.id,
    customerEmail: input.customerEmail || undefined,
    displayCurrencyIso: input.currency ?? "QAR",
    language: "EN",
  });
  if (!created.ok) {
    deps.log.warn("payments.standalone_invoice_failed", { bookingId: booking.id, code: created.error.code });
    return { ok: false, reason: "provider_error", detail: created.error.code };
  }

  await deps.supabase
    .from("photo_bookings")
    .update({ provider_invoice_id: created.data.invoiceId, payment_url: created.data.paymentUrl })
    .eq("id", booking.id)
    .eq("owner_id", input.ownerId);
  deps.log.info("payments.standalone_invoiced", { bookingId: booking.id, invoiceId: created.data.invoiceId });
  return { ok: true, bookingId: booking.id, invoiceId: created.data.invoiceId, paymentUrl: created.data.paymentUrl };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
