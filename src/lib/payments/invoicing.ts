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
  | { ok: true; orderId: string; invoiceId: string; paymentUrl: string | null; alreadyInvoiced?: boolean; relinked?: boolean }
  | { ok: false; orderId: string; reason: "already_paid" | "cancelled" | "no_amount" | "in_progress" | "provider_error"; detail?: string };

/** How long one caller's invoice claim on an order is honoured before it counts as abandoned. */
export const INVOICE_CLAIM_TTL_MS = 10 * 60_000;
/** The automatic path stops retrying an order after this many provider failures (the owner's button still works). */
export const MAX_AUTO_INVOICE_ATTEMPTS = 3;

function metadataOf(order: Pick<PhotoOrderRow, "metadata">): Record<string, unknown> {
  return isRecord(order.metadata) ? order.metadata : {};
}

function attemptsOf(order: PhotoOrderRow): number {
  const n = metadataOf(order).invoice_attempts;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * An order is eligible for an AUTOMATIC invoice only when it is still unpaid,
 * not cancelled, carries a positive amount, has no invoice yet, has not failed
 * at the provider too often, and was paid by an offline method (Fawran / bank
 * transfer / cash). A card order is already settled in Pic-Time, so
 * auto-invoicing it would ask the buyer to pay twice — never do that.
 */
export function eligibleForAutoInvoice(order: PhotoOrderRow): boolean {
  if (order.provider_invoice_id) return false;
  if (order.status === "cancelled") return false;
  if (order.payment_state === "paid" || order.payment_state === "refunded") return false;
  if (!(order.amount_qr > 0)) return false;
  if (attemptsOf(order) >= MAX_AUTO_INVOICE_ATTEMPTS) return false;
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
 * Creates a MyFatoorah invoice for one order and records it on the order.
 *
 * Money safety:
 *   1. CLAIM first: a conditional update stamps invoice_claimed_at only if the
 *      order still has no invoice and no live claim. A concurrent caller (a
 *      second cron run, a double click) gets `in_progress` and calls nothing.
 *   2. A STALE claim (older than INVOICE_CLAIM_TTL_MS: the earlier caller died
 *      after SendPayment but before recording it) is never answered by blindly
 *      creating another invoice. MyFatoorah is asked for the invoice by
 *      CustomerReference (the order id); a found invoice is re-linked. Only a
 *      clear "no such invoice" lets this caller take the claim over. An
 *      inconclusive answer (network, timeout) stops here.
 *   3. The write-back is conditional on the order still having no invoice; a
 *      lost race is logged as an orphan invoice id, not silently overwritten.
 *   4. A provider failure releases the claim and counts an attempt.
 * The caller must have checked `isPaymentsEnabled()`. Never messages the buyer.
 */
export async function createInvoiceForOrder(order: PhotoOrderRow, provider: PaymentProvider, deps: InvoiceDeps): Promise<CreateInvoiceForOrderResult> {
  if (order.provider_invoice_id) {
    return { ok: true, orderId: order.id, invoiceId: order.provider_invoice_id, paymentUrl: order.payment_url, alreadyInvoiced: true };
  }
  if (order.status === "cancelled") return { ok: false, orderId: order.id, reason: "cancelled" };
  if (order.payment_state === "paid" || order.payment_state === "refunded") return { ok: false, orderId: order.id, reason: "already_paid" };
  if (!(order.amount_qr > 0)) return { ok: false, orderId: order.id, reason: "no_amount" };

  const now = deps.now();
  const claimAt = now.toISOString();

  // (1)/(2) Take the claim.
  let claim = deps.supabase.from("photo_orders").update({ invoice_claimed_at: claimAt }).eq("id", order.id).eq("owner_id", order.owner_id).is("provider_invoice_id", null);
  if (order.invoice_claimed_at) {
    const age = now.getTime() - new Date(order.invoice_claimed_at).getTime();
    if (age < INVOICE_CLAIM_TTL_MS) return { ok: false, orderId: order.id, reason: "in_progress" };
    const existing = await provider.getPaymentStatus({ key: order.id, keyType: "CustomerReference" });
    if (existing.ok) {
      deps.log.warn("payments.order_invoice_relink", { orderId: order.id, invoiceId: existing.data.invoiceId });
      return linkInvoice(order, { invoiceId: existing.data.invoiceId, paymentUrl: null, customerReference: existing.data.customerReference }, deps, true);
    }
    if (!isNotFound(existing.error)) {
      deps.log.warn("payments.order_invoice_relink_unknown", { orderId: order.id, code: existing.error.code, httpStatus: existing.error.httpStatus });
      return { ok: false, orderId: order.id, reason: "provider_error", detail: `relink_${existing.error.code}` };
    }
    claim = claim.eq("invoice_claimed_at", order.invoice_claimed_at);
  } else {
    claim = claim.is("invoice_claimed_at", null);
  }
  const { data: claimed, error: claimError } = await claim.select("id");
  if (claimError) {
    deps.log.error("payments.order_invoice_claim_failed", { orderId: order.id, error: claimError.message });
    return { ok: false, orderId: order.id, reason: "provider_error", detail: "claim_failed" };
  }
  if (!claimed?.length) return { ok: false, orderId: order.id, reason: "in_progress" };

  // (3) Create at the provider.
  const created = await provider.createInvoice(invoiceInputForOrder(order));
  if (!created.ok) {
    deps.log.warn("payments.order_invoice_failed", { orderId: order.id, code: created.error.code, httpStatus: created.error.httpStatus });
    // (4) Release the claim and count the attempt so the automatic path backs off.
    const metadata = metadataOf(order);
    const { error: releaseError } = await deps.supabase
      .from("photo_orders")
      .update({ invoice_claimed_at: null, metadata: { ...metadata, invoice_attempts: attemptsOf(order) + 1, invoice_last_error: created.error.code } as Json })
      .eq("id", order.id)
      .eq("owner_id", order.owner_id)
      .eq("invoice_claimed_at", claimAt);
    if (releaseError) deps.log.warn("payments.order_invoice_release_failed", { orderId: order.id, error: releaseError.message });
    return { ok: false, orderId: order.id, reason: "provider_error", detail: created.error.code };
  }

  return linkInvoice(order, { invoiceId: created.data.invoiceId, paymentUrl: created.data.paymentUrl, customerReference: created.data.customerReference }, deps, false);
}

/** A GetPaymentStatus answer that clearly means "no invoice with that reference" (not a transport failure). */
function isNotFound(error: { code: string; httpStatus?: number }): boolean {
  return error.code === "provider" || (error.code === "http" && (error.httpStatus === 400 || error.httpStatus === 404));
}

/** Records an invoice on the order, only if the order still has none (never overwrites another invoice). */
async function linkInvoice(
  order: PhotoOrderRow,
  invoice: { invoiceId: string; paymentUrl: string | null; customerReference: string | null },
  deps: InvoiceDeps,
  relinked: boolean,
): Promise<CreateInvoiceForOrderResult> {
  const metadata = metadataOf(order);
  const { invoice_attempts: _attempts, invoice_last_error: _lastError, ...rest } = metadata;
  void _attempts;
  void _lastError;
  const { data, error } = await deps.supabase
    .from("photo_orders")
    .update({
      provider: MYFATOORAH_PROVIDER,
      provider_invoice_id: invoice.invoiceId,
      payment_url: invoice.paymentUrl,
      invoice_claimed_at: null,
      metadata: { ...rest, invoice: { provider: MYFATOORAH_PROVIDER, invoice_id: invoice.invoiceId, customer_reference: invoice.customerReference, created_at: deps.now().toISOString(), relinked } } as Json,
    })
    .eq("id", order.id)
    .eq("owner_id", order.owner_id)
    .is("provider_invoice_id", null)
    .select("id");
  if (error || !data?.length) {
    // The invoice exists at MyFatoorah but is not on the order. With the claim
    // still in place, the next attempt after the TTL re-links it by reference.
    deps.log.error("payments.order_invoice_orphan", { orderId: order.id, invoiceId: invoice.invoiceId, error: error?.message ?? "order already has an invoice" });
    return { ok: false, orderId: order.id, reason: "provider_error", detail: error ? "persist_failed" : "orphan" };
  }
  deps.log.info(relinked ? "payments.order_invoice_relinked" : "payments.order_invoiced", { orderId: order.id, invoiceId: invoice.invoiceId });
  return { ok: true, orderId: order.id, invoiceId: invoice.invoiceId, paymentUrl: invoice.paymentUrl, relinked };
}

/**
 * Automatic path (cron): invoices eligible unpaid offline orders that have no
 * invoice yet. Bounded by `limit` and by a wall-clock `budgetMs` (each provider
 * call can take up to the client timeout, and the cron route shares its
 * maxDuration with reconcile), so a slow provider cannot run the function into
 * its hard limit mid-write. Never messages the customer.
 */
export async function autoInvoiceOrders(provider: PaymentProvider, deps: InvoiceDeps, opts: { limit?: number; budgetMs?: number } = {}): Promise<{ scanned: number; invoiced: number; failed: number }> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 25_000;
  const { data: orders } = await deps.supabase
    .from("photo_orders")
    .select("*")
    .is("provider_invoice_id", null)
    .in("payment_state", ["pending", "unknown"])
    .neq("status", "cancelled")
    .in("payment_method", OFFLINE_METHODS as unknown as string[])
    .order("received_at", { ascending: true })
    .limit(opts.limit ?? 10);
  let invoiced = 0;
  let failed = 0;
  let scanned = 0;
  for (const order of (orders ?? []) as PhotoOrderRow[]) {
    if (Date.now() - started >= budgetMs) break;
    scanned += 1;
    if (!eligibleForAutoInvoice(order)) continue;
    const result = await createInvoiceForOrder(order, provider, deps);
    if (result.ok) invoiced += 1;
    else if (result.reason !== "in_progress") failed += 1;
  }
  return { scanned, invoiced, failed };
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
    // No invoice exists: don't leave a pending booking that can never be paid.
    const { error: cancelError } = await deps.supabase
      .from("photo_bookings")
      .update({ status: "cancelled", notes: `Invoice creation failed (${created.error.code}).` })
      .eq("id", booking.id)
      .eq("owner_id", input.ownerId);
    if (cancelError) deps.log.warn("payments.standalone_cancel_failed", { bookingId: booking.id, error: cancelError.message });
    return { ok: false, reason: "provider_error", detail: created.error.code };
  }

  const { data: linked, error: linkError } = await deps.supabase
    .from("photo_bookings")
    .update({ provider_invoice_id: created.data.invoiceId, payment_url: created.data.paymentUrl })
    .eq("id", booking.id)
    .eq("owner_id", input.ownerId)
    .select("id");
  if (linkError || !linked?.length) {
    // The invoice exists but the booking does not carry it, so its webhook would not match.
    deps.log.error("payments.standalone_invoice_orphan", { bookingId: booking.id, invoiceId: created.data.invoiceId, error: linkError?.message ?? "booking not updated" });
    return { ok: false, reason: "provider_error", detail: "persist_failed" };
  }
  deps.log.info("payments.standalone_invoiced", { bookingId: booking.id, invoiceId: created.data.invoiceId });
  return { ok: true, bookingId: booking.id, invoiceId: created.data.invoiceId, paymentUrl: created.data.paymentUrl };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
