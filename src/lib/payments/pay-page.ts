import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import type { PublicBookingDetails } from "@/lib/bookings/public-form";
import { bookingDetails, canRequestPayment, effectivePayment, isStageOpen, stageAmount, type EffectivePayment } from "@/lib/bookings/state";
import type { Logger } from "@/lib/log";
import { DEFAULT_STUDIO } from "@/lib/studio/queries";
import type { Database, Json, PaymentStage, PhotoBookingPaymentRequestRow, PhotoBookingRow } from "@/lib/supabase/database.types";
import { MYFATOORAH_PROVIDER, type CardPaymentProvider } from "./myfatoorah/client";
import { applyStatusToBooking, mapInquiry, supersededInvoices } from "./myfatoorah/webhook";
import { hashPayToken, isPayTokenExpired, isPayTokenShape, payPageUrl, payTokenMetadata } from "./pay-token";
import { findRequestByTokenHash, requestMetadata, requestSupersededInvoices } from "./requests";

type Client = SupabaseClient<Database>;

/**
 * The website pay page (`/pay/<token>`): what it shows and what its server
 * actions do. There is no session on that page, the token is the credential,
 * so everything here runs with the service client. The token is looked up on
 * `photo_booking_payment_requests.pay_token_hash` (one request per stage:
 * the 50% deposit or the remaining balance); links created before stage
 * requests existed are still found through the booking's metadata. Money
 * rules:
 *   - the amount is the REQUEST row's amount (deposit_qr / balance_qr set by
 *     the server), never the browser's;
 *   - a card session / hosted invoice is created only while the request is
 *     pending and its stage is still open; a paid, cancelled or expired
 *     request never starts a session;
 *   - nothing here ever marks anything paid by itself: the return visit asks
 *     the provider (GetPaymentStatus) and applies the SAME atomic transition
 *     as the webhook (applyStatusToBooking), which enforces the amount.
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

export type PayViewState = "payable" | "payments_off" | "not_payable" | "paid" | "failed" | "cancelled" | "expired" | "refunded";

/** What the public page may show: no notes, no metadata, no provider ids, no contact details beyond the first name. */
export type PayBookingView = {
  id: string;
  publicRef: string | null;
  packageName: string;
  athleteName: string;
  bookingType: PhotoBookingRow["booking_type"];
  eventName: string | null;
  customerFirstName: string;
  /** What this link asks for: the stage amount, or (legacy link) the amount still due. */
  amountQr: number;
  /** The whole booking. */
  totalQr: number;
  currency: string;
  /** Which stage this link is for; null for a legacy booking link. */
  stage: PaymentStage | null;
  /** @deprecated legacy: what the customer pays now on a booking-level link. */
  dueQr: number;
  payment: EffectivePayment;
  paidAt: string | null;
  bookingStatus: PhotoBookingRow["booking_status"];
  state: PayViewState;
  /** True when a payment may be taken right now (payments on + request open). */
  payable: boolean;
  /** True when the link is open but online payment is not switched on yet. */
  paymentsOff: boolean;
  providerInvoiceId: string | null;
};

export type LoadPayResult = { ok: true; view: PayBookingView; studioName: string; payUrl: string } | { ok: false; error: "not_found" | "expired" };

type Loaded = { booking: PhotoBookingRow; request: PhotoBookingPaymentRequestRow | null; expired: boolean };

async function findByToken(supabase: Client, token: string, now: Date): Promise<Loaded | null> {
  if (!isPayTokenShape(token)) return null;
  const hash = hashPayToken(token);
  const request = await findRequestByTokenHash(supabase, hash);
  if (request) {
    if (request.pay_token_hash !== hash) return null;
    const { data: booking } = await supabase.from("photo_bookings").select("*").eq("id", request.booking_id).maybeSingle();
    if (!booking) return null;
    // Only an unpaid link ages out; a paid one keeps showing "Payment confirmed".
    const expired = request.status === "expired" || (request.status === "pending" && isPayTokenExpired(request.created_at, now));
    return { booking, request, expired };
  }
  // Legacy: the token hash lives on the booking row (links created before stage requests).
  const { data } = await supabase.from("photo_bookings").select("*").eq("metadata->>pay_token_hash", hash).maybeSingle();
  if (!data) return null;
  const meta = payTokenMetadata(data.metadata);
  if (meta.pay_token_hash !== hash) return null;
  return { booking: data, request: null, expired: isPayTokenExpired(meta.pay_token_created_at, now) };
}

async function studioNameOf(supabase: Client, ownerId: string): Promise<string> {
  const { data } = await supabase.from("photo_studio").select("business_name").eq("owner_id", ownerId).maybeSingle();
  return data?.business_name ?? DEFAULT_STUDIO.business_name;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

/** True while this request may still be paid: pending, and its stage still open on the booking. */
export function isRequestPayable(booking: PhotoBookingRow, request: PhotoBookingPaymentRequestRow): boolean {
  return request.status === "pending" && isStageOpen(booking, request.stage) && stageAmount(booking, request.stage) > 0;
}

export function payBookingView(booking: PhotoBookingRow, request: PhotoBookingPaymentRequestRow | null, eventName: string | null, enabled: boolean, expired = false): PayBookingView {
  const payment = effectivePayment(booking);
  const base = {
    id: booking.id,
    publicRef: booking.public_ref,
    packageName: booking.package_name,
    athleteName: booking.athlete_name,
    bookingType: booking.booking_type,
    eventName: eventName ?? (bookingDetails(booking) as PublicBookingDetails).event_name ?? null,
    customerFirstName: firstName(booking.customer_name),
    totalQr: Number(booking.amount_qr) || 0,
    currency: request?.currency ?? booking.currency,
    payment,
    bookingStatus: booking.booking_status,
  };
  if (request) {
    const open = isRequestPayable(booking, request);
    const stagePaid = request.status === "paid" || !isStageOpen(booking, request.stage) && (request.stage === "deposit" ? booking.deposit_state === "paid" : booking.balance_state === "paid");
    const state: PayViewState =
      booking.status === "refunded" && request.status === "paid" ? "refunded" : stagePaid ? "paid" : expired ? "expired" : request.status === "cancelled" ? "cancelled" : request.status === "failed" ? "failed" : open ? (enabled ? "payable" : "payments_off") : "not_payable";
    return {
      ...base,
      amountQr: Number(request.amount_qr) || 0,
      dueQr: Number(request.amount_qr) || 0,
      stage: request.stage,
      paidAt: request.paid_at ?? (request.stage === "deposit" ? booking.deposit_paid_at : booking.balance_paid_at) ?? null,
      state,
      payable: state === "payable",
      paymentsOff: state === "payments_off",
      providerInvoiceId: request.provider_invoice_id ?? null,
    };
  }
  const payable = canRequestPayment(booking);
  const state: PayViewState = payment.state === "paid" ? "paid" : payment.state === "refunded" ? "refunded" : expired ? "expired" : payable ? (enabled ? "payable" : "payments_off") : "not_payable";
  return {
    ...base,
    amountQr: payment.dueQr,
    dueQr: payment.dueQr,
    stage: null,
    paidAt: booking.status === "paid" ? booking.paid_at : payment.state === "paid" ? booking.manual_paid_at : null,
    state,
    payable: state === "payable",
    paymentsOff: state === "payments_off",
    providerInvoiceId: booking.provider_invoice_id,
  };
}

/** The booking behind a pay link, for rendering. Never mutates anything. */
export async function loadPayBooking(token: string, deps: PayPageDeps): Promise<LoadPayResult> {
  const found = await findByToken(deps.supabase, token, deps.now());
  if (!found) return { ok: false, error: "not_found" };
  // A legacy link that aged out has nothing to show; a stage link still shows its state (paid stays paid).
  if (found.expired && !found.request) return { ok: false, error: "expired" };
  const { booking, request } = found;
  let eventName: string | null = null;
  if (booking.event_id) {
    const { data } = await deps.supabase.from("photo_events").select("name").eq("id", booking.event_id).maybeSingle();
    eventName = data?.name ?? null;
  }
  const studioName = await studioNameOf(deps.supabase, booking.owner_id);
  return { ok: true, view: payBookingView(booking, request, eventName, deps.enabled, found.expired), studioName, payUrl: payPageUrl(deps.siteUrl, token) };
}

export type PayActionError = "not_found" | "expired" | "not_payable" | "payments_off" | "provider_error" | "conflict" | "invalid";

/** Loads a request for a mutating action: it must exist, be fresh and be payable right now. */
async function loadPayable(token: string, deps: PayPageDeps): Promise<{ ok: true; booking: PhotoBookingRow; request: PhotoBookingPaymentRequestRow | null } | { ok: false; error: PayActionError }> {
  const found = await findByToken(deps.supabase, token, deps.now());
  if (!found) return { ok: false, error: "not_found" };
  if (found.expired) return { ok: false, error: "expired" };
  if (found.request ? !isRequestPayable(found.booking, found.request) : !canRequestPayment(found.booking)) return { ok: false, error: "not_payable" };
  if (!deps.enabled || !deps.provider) return { ok: false, error: "payments_off" };
  return { ok: true, booking: found.booking, request: found.request };
}

export type StartSessionResult = { ok: true; sessionId: string; countryCode: string; scriptUrl: string } | { ok: false; error: PayActionError };

/** Step 1 of the embedded card view: a provider session the browser renders the card fields with. No amount is involved yet. */
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

/** The amount a checkout attempt charges: the request's stage amount, or (legacy link) what is still due on the booking. */
function chargeFor(booking: PhotoBookingRow, request: PhotoBookingPaymentRequestRow | null): number {
  return request ? Math.round(Number(request.amount_qr) * 100) / 100 : effectivePayment(booking).dueQr;
}

/**
 * Records the provider invoice a checkout attempt created. With a stage
 * request the invoice goes on the REQUEST row (guarded by the invoice id the
 * attempt read, so two concurrent attempts cannot both link; the previous
 * id is kept in metadata.superseded_invoices so a late payment of it still
 * finds the request), and the booking's own provider_invoice_id is kept in
 * sync for the legacy lookups. `payment_url` stays the website page; the
 * provider's own URL goes to metadata.provider_payment_url.
 */
async function linkAttempt(booking: PhotoBookingRow, request: PhotoBookingPaymentRequestRow | null, attempt: { invoiceId: string; paymentUrl: string; amount: number; kind: "card" | "hosted" }, deps: PayPageDeps): Promise<boolean> {
  const now = deps.now().toISOString();
  const session = { invoice_id: attempt.invoiceId, amount: attempt.amount, currency: request?.currency ?? booking.currency, kind: attempt.kind, created_at: now };
  if (request) {
    const rm = requestMetadata(request);
    const previous = requestSupersededInvoices(request);
    const superseded = request.provider_invoice_id && !previous.includes(request.provider_invoice_id) ? [...previous, request.provider_invoice_id].slice(-20) : previous;
    let q = deps.supabase
      .from("photo_booking_payment_requests")
      .update({ provider_invoice_id: attempt.invoiceId, provider_reference: booking.id, metadata: { ...rm, provider_payment_url: attempt.paymentUrl, pay_session: session, superseded_invoices: superseded } as Json })
      .eq("id", request.id)
      .eq("status", "pending");
    q = request.provider_invoice_id ? q.eq("provider_invoice_id", request.provider_invoice_id) : q.is("provider_invoice_id", null);
    const { data, error } = await q.select("id");
    if (error || !(data ?? []).length) {
      deps.log.error("payments.pay_page_invoice_orphan", { bookingId: booking.id, requestId: request.id, invoiceId: attempt.invoiceId, error: error?.message ?? "request changed" });
      return false;
    }
    // Mirror on the booking so reconciliation and the legacy invoice lookup keep working.
    const metadata = isRecord(booking.metadata) ? booking.metadata : {};
    await deps.supabase
      .from("photo_bookings")
      .update({ provider: MYFATOORAH_PROVIDER, provider_invoice_id: attempt.invoiceId, metadata: { ...metadata, provider_payment_url: attempt.paymentUrl, pay_session: session, superseded_invoices: supersededInvoices(metadata, booking.provider_invoice_id) as Json } as Json })
      .eq("id", booking.id)
      .eq("owner_id", booking.owner_id);
    await writeAudit(deps.supabase, { ownerId: booking.owner_id, actorKind: "client", entity: "booking", entityId: booking.id, action: "payment.session_started", data: { request_id: request.id, stage: request.stage, invoice_id: attempt.invoiceId, amount_qr: attempt.amount, currency: request.currency, kind: attempt.kind } });
    deps.log.info("payments.pay_page_attempt", { bookingId: booking.id, requestId: request.id, stage: request.stage, invoiceId: attempt.invoiceId, kind: attempt.kind });
    return true;
  }
  const metadata = isRecord(booking.metadata) ? booking.metadata : {};
  const patch: Partial<PhotoBookingRow> = {
    provider: MYFATOORAH_PROVIDER,
    provider_invoice_id: attempt.invoiceId,
    metadata: { ...metadata, provider_payment_url: attempt.paymentUrl, pay_session: session, superseded_invoices: supersededInvoices(metadata, booking.provider_invoice_id) as Json } as Json,
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
 * the REQUEST says (never the browser) and returns the 3-D Secure URL.
 */
export async function executeCardPayment(token: string, sessionId: string, deps: PayPageDeps): Promise<StartPaymentResult> {
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) return { ok: false, error: "invalid" };
  const loaded = await loadPayable(token, deps);
  if (!loaded.ok) return loaded;
  const { booking, request } = loaded;
  const amount = chargeFor(booking, request);
  if (!(amount > 0)) return { ok: false, error: "not_payable" };
  const urls = returnUrls(deps, token);
  const res = await deps.provider!.executePayment({
    sessionId,
    amount,
    displayCurrencyIso: request?.currency ?? booking.currency,
    customerReference: booking.id,
    customerName: booking.customer_name,
    customerEmail: booking.customer_email || undefined,
    customerMobile: booking.customer_phone || undefined,
    callbackUrl: urls.callbackUrl,
    errorUrl: urls.errorUrl,
    language: "EN",
    userDefinedField: request ? `${booking.public_ref ?? booking.id}:${request.stage}` : booking.public_ref ?? undefined,
  });
  if (!res.ok) {
    deps.log.warn("payments.pay_page_execute_failed", { bookingId: booking.id, code: res.error.code, httpStatus: res.error.httpStatus });
    return { ok: false, error: "provider_error" };
  }
  const linked = await linkAttempt(booking, request, { invoiceId: res.data.invoiceId, paymentUrl: res.data.paymentUrl, amount, kind: "card" }, deps);
  if (!linked) return { ok: false, error: "conflict" };
  return { ok: true, redirectUrl: res.data.paymentUrl, invoiceId: res.data.invoiceId };
}

/** Fallback when the card view cannot load: the provider's own hosted payment page (SendPayment), same guards and storage. */
export async function startHostedPayment(token: string, deps: PayPageDeps): Promise<StartPaymentResult> {
  const loaded = await loadPayable(token, deps);
  if (!loaded.ok) return loaded;
  const { booking, request } = loaded;
  const amount = chargeFor(booking, request);
  if (!(amount > 0)) return { ok: false, error: "not_payable" };
  const urls = returnUrls(deps, token);
  const res = await deps.provider!.createInvoice({
    amount,
    customerName: booking.customer_name,
    customerReference: booking.id,
    customerEmail: booking.customer_email || undefined,
    customerMobile: booking.customer_phone || undefined,
    displayCurrencyIso: request?.currency ?? booking.currency,
    language: "EN",
    userDefinedField: request ? `${booking.public_ref ?? booking.id}:${request.stage}` : booking.public_ref ?? undefined,
    callbackUrl: urls.callbackUrl,
    errorUrl: urls.errorUrl,
  });
  if (!res.ok) {
    deps.log.warn("payments.pay_page_hosted_failed", { bookingId: booking.id, code: res.error.code, httpStatus: res.error.httpStatus });
    return { ok: false, error: "provider_error" };
  }
  const linked = await linkAttempt(booking, request, { invoiceId: res.data.invoiceId, paymentUrl: res.data.paymentUrl, amount, kind: "hosted" }, deps);
  if (!linked) return { ok: false, error: "conflict" };
  return { ok: true, redirectUrl: res.data.paymentUrl, invoiceId: res.data.invoiceId };
}

export type VerifyStatus = "paid" | "pending" | "failed" | "mismatch" | "unavailable" | "provider_error" | "invalid";
export type VerifyResult = { status: VerifyStatus; detail?: string };

const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The return visit (`?result=callback&paymentId=...`). The redirect proves
 * nothing: the provider is asked about that payment id, the answer must name
 * THIS request's invoice (or one it superseded), and only then is the
 * webhook's transition applied, which enforces the amount and currency and
 * is idempotent (a second visit, or the webhook arriving first, is a no-op).
 */
export async function verifyReturnedPayment(token: string, paymentId: string, deps: PayPageDeps): Promise<VerifyResult> {
  if (typeof paymentId !== "string" || !PAYMENT_ID_RE.test(paymentId)) return { status: "invalid" };
  const found = await findByToken(deps.supabase, token, deps.now());
  if (!found || (found.expired && !found.request)) return { status: "invalid" };
  const { booking, request } = found;
  if (request ? request.status === "paid" : booking.status === "paid") return { status: "paid" };
  if (!deps.enabled || !deps.provider) return { status: "unavailable" };

  const res = await deps.provider.getPaymentStatus({ key: paymentId, keyType: "PaymentId" });
  if (!res.ok) {
    deps.log.warn("payments.pay_page_verify_failed", { bookingId: booking.id, code: res.error.code, httpStatus: res.error.httpStatus });
    return { status: "provider_error" };
  }
  const inquiry = res.data;
  const known = request
    ? inquiry.invoiceId === request.provider_invoice_id || requestSupersededInvoices(request).includes(inquiry.invoiceId)
    : inquiry.invoiceId === booking.provider_invoice_id || supersededInvoices(isRecord(booking.metadata) ? booking.metadata : {}, null).includes(inquiry.invoiceId);
  if (!known) {
    deps.log.warn("payments.pay_page_verify_wrong_invoice", { bookingId: booking.id, requestId: request?.id ?? null, invoiceId: inquiry.invoiceId });
    return { status: "mismatch", detail: "invoice" };
  }
  const mapping = mapInquiry(inquiry);
  if (mapping.kind === "ignore") return { status: "pending" };
  const applied = await applyStatusToBooking(booking, mapping, { source: `pay-page:${paymentId}`, eventId: `return:${paymentId}` }, deps, request);
  if (applied.result === "amount_mismatch") return { status: "mismatch", detail: applied.detail };
  if (mapping.status === "paid") return applied.result === "processed" || applied.result === "unchanged" || applied.status === "paid" ? { status: "paid" } : { status: "pending", detail: applied.detail };
  if (mapping.status === "failed" || mapping.status === "cancelled") return { status: "failed" };
  return { status: "pending" };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
