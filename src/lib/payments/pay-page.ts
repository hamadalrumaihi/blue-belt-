import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import type { PublicBookingDetails } from "@/lib/bookings/public-form";
import { bookingDetails, canRequestPayment, effectivePayment, type EffectivePayment } from "@/lib/bookings/state";
import type { Logger } from "@/lib/log";
import { DEFAULT_STUDIO } from "@/lib/studio/queries";
import type { Database, Json, PhotoBookingRow } from "@/lib/supabase/database.types";
import { MYFATOORAH_PROVIDER, type CardPaymentProvider } from "./myfatoorah/client";
import { applyStatusToBooking, mapInquiry, supersededInvoices } from "./myfatoorah/webhook";
import { hashPayToken, isPayTokenExpired, isPayTokenShape, payPageUrl, payTokenMetadata } from "./pay-token";

type Client = SupabaseClient<Database>;

/**
 * The website pay page (`/pay/<token>`): what it shows and what its two
 * server actions do. There is no session on that page, the token is the
 * credential, so everything here runs with the service client and looks the
 * booking up by the token's hash. Money rules:
 *   - the amount always comes from the booking row, never from the browser;
 *   - a card session / hosted invoice is created only while the booking is
 *     payable (shoot complete, final amount recorded, not yet paid);
 *   - nothing here ever marks a booking paid by itself: the return visit asks
 *     MyFatoorah (GetPaymentStatus) and applies the SAME atomic transition as
 *     the webhook (applyStatusToBooking), which also enforces the amount.
 */

export type PayPageDeps = {
  supabase: Client;
  now: () => Date;
  log: Logger;
  /** Null while payments are not enabled: no provider call can happen. */
  provider: CardPaymentProvider | null;
  /** isPaymentsEnabled() at the time of the call. */
  enabled: boolean;
  siteUrl: string;
  /** cardViewScriptUrl(baseUrl) for the configured base. */
  scriptUrl: string;
};

/** What the public page may show: no notes, no metadata, no contact details beyond the first name. */
export type PayBookingView = {
  id: string;
  publicRef: string | null;
  packageName: string;
  athleteName: string;
  bookingType: PhotoBookingRow["booking_type"];
  eventName: string | null;
  customerFirstName: string;
  amountQr: number;
  currency: string;
  /** What the customer pays now (the booking amount less anything recorded by hand). */
  dueQr: number;
  payment: EffectivePayment;
  paidAt: string | null;
  bookingStatus: PhotoBookingRow["booking_status"];
  /** True when a payment may be taken right now (payments on + booking payable). */
  payable: boolean;
  /** True when the booking is payable but online payment is not switched on yet. */
  paymentsOff: boolean;
  providerInvoiceId: string | null;
};

export type LoadPayResult = { ok: true; view: PayBookingView; studioName: string; payUrl: string } | { ok: false; error: "not_found" | "expired" };

type Loaded = { booking: PhotoBookingRow; expired: boolean };

async function findByToken(supabase: Client, token: string, now: Date): Promise<Loaded | null> {
  if (!isPayTokenShape(token)) return null;
  const hash = hashPayToken(token);
  const { data } = await supabase.from("photo_bookings").select("*").eq("metadata->>pay_token_hash", hash).maybeSingle();
  if (!data) return null;
  const meta = payTokenMetadata(data.metadata);
  // Belt and braces: the JSON filter above is the lookup, this is the check.
  if (meta.pay_token_hash !== hash) return null;
  return { booking: data, expired: isPayTokenExpired(meta.pay_token_created_at, now) };
}

async function studioNameOf(supabase: Client, ownerId: string): Promise<string> {
  const { data } = await supabase.from("photo_studio").select("business_name").eq("owner_id", ownerId).maybeSingle();
  return data?.business_name ?? DEFAULT_STUDIO.business_name;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

export function payBookingView(booking: PhotoBookingRow, eventName: string | null, enabled: boolean): PayBookingView {
  const payment = effectivePayment(booking);
  const payable = canRequestPayment(booking);
  return {
    id: booking.id,
    publicRef: booking.public_ref,
    packageName: booking.package_name,
    athleteName: booking.athlete_name,
    bookingType: booking.booking_type,
    eventName: eventName ?? (bookingDetails(booking) as PublicBookingDetails).event_name ?? null,
    customerFirstName: firstName(booking.customer_name),
    amountQr: Number(booking.amount_qr) || 0,
    currency: booking.currency,
    dueQr: payment.dueQr,
    payment,
    paidAt: booking.status === "paid" ? booking.paid_at : payment.state === "paid" ? booking.manual_paid_at : null,
    bookingStatus: booking.booking_status,
    payable: enabled && payable,
    paymentsOff: !enabled && payable,
    providerInvoiceId: booking.provider_invoice_id,
  };
}

/** The booking behind a pay link, for rendering. Never mutates anything. */
export async function loadPayBooking(token: string, deps: PayPageDeps): Promise<LoadPayResult> {
  const found = await findByToken(deps.supabase, token, deps.now());
  if (!found) return { ok: false, error: "not_found" };
  if (found.expired) return { ok: false, error: "expired" };
  const { booking } = found;
  let eventName: string | null = null;
  if (booking.event_id) {
    const { data } = await deps.supabase.from("photo_events").select("name").eq("id", booking.event_id).maybeSingle();
    eventName = data?.name ?? null;
  }
  const studioName = await studioNameOf(deps.supabase, booking.owner_id);
  return { ok: true, view: payBookingView(booking, eventName, deps.enabled), studioName, payUrl: payPageUrl(deps.siteUrl, token) };
}

export type PayActionError = "not_found" | "expired" | "not_payable" | "payments_off" | "provider_error" | "conflict" | "invalid";

/** Loads a booking for a mutating action: it must exist, be fresh and be payable right now. */
async function loadPayable(token: string, deps: PayPageDeps): Promise<{ ok: true; booking: PhotoBookingRow } | { ok: false; error: PayActionError }> {
  const found = await findByToken(deps.supabase, token, deps.now());
  if (!found) return { ok: false, error: "not_found" };
  if (found.expired) return { ok: false, error: "expired" };
  if (!canRequestPayment(found.booking)) return { ok: false, error: "not_payable" };
  if (!deps.enabled || !deps.provider) return { ok: false, error: "payments_off" };
  return { ok: true, booking: found.booking };
}

export type StartSessionResult = { ok: true; sessionId: string; countryCode: string; scriptUrl: string } | { ok: false; error: PayActionError };

/** Step 1 of the embedded card view: a MyFatoorah session the browser renders the card fields with. No amount is involved yet. */
export async function startCardSession(token: string, deps: PayPageDeps): Promise<StartSessionResult> {
  const loaded = await loadPayable(token, deps);
  if (!loaded.ok) return loaded;
  const res = await deps.provider!.initiateSession({});
  if (!res.ok) {
    deps.log.warn("payments.pay_page_session_failed", { bookingId: loaded.booking.id, code: res.error.code, httpStatus: res.error.httpStatus });
    return { ok: false, error: "provider_error" };
  }
  return { ok: true, sessionId: res.data.sessionId, countryCode: res.data.countryCode, scriptUrl: deps.scriptUrl };
}

export type StartPaymentResult = { ok: true; redirectUrl: string; invoiceId: string } | { ok: false; error: PayActionError };

const SESSION_ID_RE = /^[A-Za-z0-9_.:=-]{8,200}$/;

function returnUrls(deps: PayPageDeps, token: string): { callbackUrl: string; errorUrl: string } {
  const base = payPageUrl(deps.siteUrl, token);
  return { callbackUrl: `${base}?result=callback`, errorUrl: `${base}?result=error` };
}

/**
 * Records the provider invoice a checkout attempt created on the booking.
 * Guarded by the invoice id the attempt read (null or the previous one), so
 * two concurrent attempts cannot both link; the previous invoice id is kept
 * in metadata.superseded_invoices so a late payment of it still finds the
 * booking (see findBookingForMapping in webhook.ts). `payment_url` stays the
 * website page; the provider's own URL goes to metadata.provider_payment_url.
 */
async function linkAttempt(booking: PhotoBookingRow, attempt: { invoiceId: string; paymentUrl: string; amount: number; kind: "card" | "hosted" }, deps: PayPageDeps): Promise<boolean> {
  const now = deps.now().toISOString();
  const metadata = isRecord(booking.metadata) ? booking.metadata : {};
  const patch: Partial<PhotoBookingRow> = {
    provider: MYFATOORAH_PROVIDER,
    provider_invoice_id: attempt.invoiceId,
    metadata: {
      ...metadata,
      provider_payment_url: attempt.paymentUrl,
      pay_session: { invoice_id: attempt.invoiceId, amount: attempt.amount, currency: booking.currency, kind: attempt.kind, created_at: now },
      superseded_invoices: supersededInvoices(metadata, booking.provider_invoice_id) as Json,
    } as Json,
  };
  let q = deps.supabase.from("photo_bookings").update(patch).eq("id", booking.id).eq("owner_id", booking.owner_id).in("status", ["pending", "failed"]);
  q = booking.provider_invoice_id ? q.eq("provider_invoice_id", booking.provider_invoice_id) : q.is("provider_invoice_id", null);
  const { data, error } = await q.select("id");
  if (error || !(data ?? []).length) {
    deps.log.error("payments.pay_page_invoice_orphan", { bookingId: booking.id, invoiceId: attempt.invoiceId, error: error?.message ?? "booking changed" });
    return false;
  }
  await writeAudit(deps.supabase, { ownerId: booking.owner_id, actorKind: "client", entity: "booking", entityId: booking.id, action: "payment.session_started", data: { invoice_id: attempt.invoiceId, amount_qr: attempt.amount, currency: booking.currency, kind: attempt.kind } });
  deps.log.info("payments.pay_page_attempt", { bookingId: booking.id, invoiceId: attempt.invoiceId, kind: attempt.kind });
  return true;
}

/**
 * Step 2 of the card view: the browser hands back the session id after the
 * customer typed their card; the server executes the payment for the amount
 * the BOOKING says (never the browser) and returns the 3-D Secure URL.
 */
export async function executeCardPayment(token: string, sessionId: string, deps: PayPageDeps): Promise<StartPaymentResult> {
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) return { ok: false, error: "invalid" };
  const loaded = await loadPayable(token, deps);
  if (!loaded.ok) return loaded;
  const { booking } = loaded;
  const amount = effectivePayment(booking).dueQr;
  if (!(amount > 0)) return { ok: false, error: "not_payable" };
  const urls = returnUrls(deps, token);
  const res = await deps.provider!.executePayment({
    sessionId,
    amount,
    displayCurrencyIso: booking.currency,
    customerReference: booking.id,
    customerName: booking.customer_name,
    customerEmail: booking.customer_email || undefined,
    customerMobile: booking.customer_phone || undefined,
    callbackUrl: urls.callbackUrl,
    errorUrl: urls.errorUrl,
    language: "EN",
    userDefinedField: booking.public_ref ?? undefined,
  });
  if (!res.ok) {
    deps.log.warn("payments.pay_page_execute_failed", { bookingId: booking.id, code: res.error.code, httpStatus: res.error.httpStatus });
    return { ok: false, error: "provider_error" };
  }
  const linked = await linkAttempt(booking, { invoiceId: res.data.invoiceId, paymentUrl: res.data.paymentUrl, amount, kind: "card" }, deps);
  if (!linked) return { ok: false, error: "conflict" };
  return { ok: true, redirectUrl: res.data.paymentUrl, invoiceId: res.data.invoiceId };
}

/** Fallback when the card view cannot load: MyFatoorah's own hosted payment page (SendPayment), same guards and storage. */
export async function startHostedPayment(token: string, deps: PayPageDeps): Promise<StartPaymentResult> {
  const loaded = await loadPayable(token, deps);
  if (!loaded.ok) return loaded;
  const { booking } = loaded;
  const amount = effectivePayment(booking).dueQr;
  if (!(amount > 0)) return { ok: false, error: "not_payable" };
  const urls = returnUrls(deps, token);
  const res = await deps.provider!.createInvoice({
    amount,
    customerName: booking.customer_name,
    customerReference: booking.id,
    customerEmail: booking.customer_email || undefined,
    customerMobile: booking.customer_phone || undefined,
    displayCurrencyIso: booking.currency,
    language: "EN",
    userDefinedField: booking.public_ref ?? undefined,
    callbackUrl: urls.callbackUrl,
    errorUrl: urls.errorUrl,
  });
  if (!res.ok) {
    deps.log.warn("payments.pay_page_hosted_failed", { bookingId: booking.id, code: res.error.code, httpStatus: res.error.httpStatus });
    return { ok: false, error: "provider_error" };
  }
  const linked = await linkAttempt(booking, { invoiceId: res.data.invoiceId, paymentUrl: res.data.paymentUrl, amount, kind: "hosted" }, deps);
  if (!linked) return { ok: false, error: "conflict" };
  return { ok: true, redirectUrl: res.data.paymentUrl, invoiceId: res.data.invoiceId };
}

export type VerifyStatus = "paid" | "pending" | "failed" | "mismatch" | "unavailable" | "provider_error" | "invalid";
export type VerifyResult = { status: VerifyStatus; detail?: string };

const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The return visit (`?result=callback&paymentId=...`). The redirect proves
 * nothing: MyFatoorah is asked about that payment id, the answer must name
 * THIS booking's invoice (or one it superseded), and only then is the
 * webhook's transition applied, which enforces the amount and currency and
 * is idempotent (a second visit, or the webhook arriving first, is a no-op).
 */
export async function verifyReturnedPayment(token: string, paymentId: string, deps: PayPageDeps): Promise<VerifyResult> {
  if (typeof paymentId !== "string" || !PAYMENT_ID_RE.test(paymentId)) return { status: "invalid" };
  const found = await findByToken(deps.supabase, token, deps.now());
  if (!found || found.expired) return { status: "invalid" };
  const { booking } = found;
  if (booking.status === "paid") return { status: "paid" };
  if (!deps.enabled || !deps.provider) return { status: "unavailable" };

  const res = await deps.provider.getPaymentStatus({ key: paymentId, keyType: "PaymentId" });
  if (!res.ok) {
    deps.log.warn("payments.pay_page_verify_failed", { bookingId: booking.id, code: res.error.code, httpStatus: res.error.httpStatus });
    return { status: "provider_error" };
  }
  const inquiry = res.data;
  const metadata = isRecord(booking.metadata) ? booking.metadata : {};
  const known = inquiry.invoiceId === booking.provider_invoice_id || supersededInvoices(metadata, null).includes(inquiry.invoiceId);
  if (!known) {
    deps.log.warn("payments.pay_page_verify_wrong_invoice", { bookingId: booking.id, invoiceId: inquiry.invoiceId });
    return { status: "mismatch", detail: "invoice" };
  }
  const mapping = mapInquiry(inquiry);
  if (mapping.kind === "ignore") return { status: "pending" };
  const applied = await applyStatusToBooking(booking, mapping, { source: `pay-page:${paymentId}`, eventId: `return:${paymentId}` }, deps);
  if (applied.result === "amount_mismatch") return { status: "mismatch", detail: applied.detail };
  if (mapping.status === "paid") return applied.result === "processed" || applied.result === "unchanged" || applied.status === "paid" ? { status: "paid" } : { status: "pending", detail: applied.detail };
  if (mapping.status === "failed" || mapping.status === "cancelled") return { status: "failed" };
  return { status: "pending" };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
