/**
 * MyFatoorah Webhook V2 processing and booking reconciliation.
 *
 * Pure-ish: all I/O goes through `deps` (service-role Supabase client, clock,
 * logger) so the logic is unit-tested with an in-memory fake and no network.
 *
 * Docs: https://docs.myfatoorah.com/docs/webhook-v2 and the per-event data
 * models linked from it. Event identity = `Event.Reference` ("Each webhook has
 * its unique reference"), stored as `photo_payment_events.provider_event_id`
 * (unique per provider) so a redelivered event is a no-op.
 *
 * HARD RULE: a paid booking NEVER creates a `photo_athletes` row (the watcher's
 * tracked clients). `linkBookingToAthlete` only flags
 * `metadata.pending_athlete_link = true`; the actual link stays manual until
 * webhook processing has been verified in production. See docs/payments.md.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "@/lib/log";
import type { Database, Json, PaymentStage, PhotoBookingPaymentRequestRow, PhotoBookingRow, PhotoOrderRow } from "@/lib/supabase/database.types";
import { writeAudit } from "@/lib/audit";
import { bookingEmailAlertKey, bookingEmailDraft, type BookingEmailKind } from "@/lib/bookings/emails";
import { recomputeBookingGates } from "@/lib/bookings/gates";
import { BOOKING_STATUS_LABEL, formatMoney, isCompletionReady, stageWords } from "@/lib/bookings/state";
import { deliveryInsert } from "@/lib/notifications/delivery-runner";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { fulfillmentPlan } from "@/lib/payments/fulfillment";
import { applyProviderResultToRequest, findRequestByInvoice, listStageRequests, requestSupersededInvoices } from "@/lib/payments/requests";
import { applyTransition, isPaymentStatus, type PaymentStatus } from "@/lib/payments/types";
import { isUuid } from "@/lib/validation";
import { MYFATOORAH_PROVIDER, type PaymentProvider, type PaymentStatusOutput } from "./client";
import { buildSignaturePayload, eventNameOf, readPath, signatureValue, type SignedEventName } from "./signature";

export type WebhookDeps = {
  supabase: SupabaseClient<Database>;
  now: () => Date;
  log: Logger;
};

export type WebhookEvent = {
  /** Parsed JSON body: `{ Event, Data }`. */
  body: Record<string, unknown>;
  /** Verdict from `verifySignature` in the route; false also for unsupported event types. */
  signatureValid: boolean;
};

export type ProcessingResult =
  | "processed"
  | "duplicate"
  | "invalid_signature"
  | "ignored_event"
  | "booking_not_found"
  | "unchanged"
  | "ignored_transition"
  | "amount_mismatch"
  | "error";

export type ProcessWebhookOutcome = {
  result: ProcessingResult;
  eventId: string;
  eventType: string;
  bookingId: string | null;
  /** Booking status after processing (when a booking was found). */
  status?: PaymentStatus;
  detail?: string;
};

const PG_UNIQUE_VIOLATION = "23505";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function text(v: unknown): string | null {
  const s = signatureValue(v);
  return s === "" ? null : s;
}
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Event identity
// ---------------------------------------------------------------------------

export function eventTypeOf(body: Record<string, unknown>): string {
  const event = isRecord(body.Event) ? body.Event : {};
  return text(event.Name) ?? (event.Code !== undefined ? `CODE_${signatureValue(event.Code)}` : "UNKNOWN");
}

/**
 * `Event.Reference` when present; otherwise a deterministic SHA-256 over the
 * stable fields (event type + the documented signature fields + creation
 * date), so a redelivery without a reference still dedupes.
 */
export function providerEventIdOf(body: Record<string, unknown>): string {
  const event = isRecord(body.Event) ? body.Event : {};
  const ref = text(event.Reference);
  if (ref) return ref;
  const stable = [eventTypeOf(body), buildSignaturePayload(body) ?? JSON.stringify(body.Data ?? null), signatureValue(event.CreationDate)].join("|");
  return `sha256:${createHash("sha256").update(stable, "utf8").digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Provider status -> PaymentStatus
// ---------------------------------------------------------------------------

export type StatusMapping =
  | {
      kind: "apply";
      status: PaymentStatus;
      invoiceId: string;
      paymentId: string | null;
      amount: number | null;
      currency: string | null;
      transaction: Json;
      /** Our CustomerReference (the booking id) as MyFatoorah echoes it; lets a superseded invoice find its booking. */
      externalIdentifier?: string | null;
    }
  | { kind: "ignore"; reason: string };

/**
 * Maps a Webhook V2 event to the booking status it implies.
 *   PAYMENT_STATUS_CHANGED  Transaction.Status SUCCESS→paid, FAILED→failed,
 *                           CANCELED→cancelled, AUTHORIZE→ignored (auth/capture unused)
 *   REFUND_STATUS_CHANGED   Refund.Status REFUNDED→refunded, CANCELED→ignored
 *   DISPUTE_STATUS_CHANGED  Dispute.Status PENDING→disputed, RESOLVED→paid, LOST→refunded
 * Everything else is ignored. Statuses are compared case-insensitively.
 */
export function mapWebhookEvent(eventName: SignedEventName | null, data: Record<string, unknown>): StatusMapping {
  const upper = (v: unknown) => (text(v) ?? "").toUpperCase();
  switch (eventName) {
    case "PAYMENT_STATUS_CHANGED": {
      const invoiceId = text(readPath(data, "Invoice.Id"));
      if (!invoiceId) return { kind: "ignore", reason: "missing_invoice_id" };
      const tx = upper(readPath(data, "Transaction.Status"));
      const status: PaymentStatus | null = tx === "SUCCESS" ? "paid" : tx === "FAILED" ? "failed" : tx === "CANCELED" || tx === "CANCELLED" ? "cancelled" : null;
      if (!status) return { kind: "ignore", reason: `transaction_status:${tx || "empty"}` };
      return {
        kind: "apply",
        status,
        invoiceId,
        paymentId: text(readPath(data, "Transaction.PaymentId")),
        amount: num(readPath(data, "Amount.ValueInBaseCurrency")),
        currency: text(readPath(data, "Amount.BaseCurrency")),
        transaction: (isRecord(data.Transaction) ? data.Transaction : {}) as Json,
        externalIdentifier: text(readPath(data, "Invoice.ExternalIdentifier")),
      };
    }
    case "REFUND_STATUS_CHANGED": {
      const invoiceId = text(readPath(data, "ReferencedInvoice.Id")) ?? text(readPath(data, "Refund.InvoiceId"));
      if (!invoiceId) return { kind: "ignore", reason: "missing_invoice_id" };
      const rs = upper(readPath(data, "Refund.Status"));
      if (rs !== "REFUNDED") return { kind: "ignore", reason: `refund_status:${rs || "empty"}` };
      const refundId = text(readPath(data, "Refund.Id"));
      return {
        kind: "apply",
        status: "refunded",
        invoiceId,
        paymentId: refundId ? `refund:${refundId}` : null,
        amount: num(readPath(data, "Amount.ValueInBaseCurrency")),
        currency: text(readPath(data, "Amount.BaseCurrency")),
        transaction: (isRecord(data.Refund) ? data.Refund : {}) as Json,
      };
    }
    case "DISPUTE_STATUS_CHANGED": {
      const invoiceId = text(readPath(data, "Invoice.Id"));
      if (!invoiceId) return { kind: "ignore", reason: "missing_invoice_id" };
      const ds = upper(readPath(data, "Dispute.Status"));
      const status: PaymentStatus | null = ds === "PENDING" ? "disputed" : ds === "RESOLVED" ? "paid" : ds === "LOST" ? "refunded" : null;
      if (!status) return { kind: "ignore", reason: `dispute_status:${ds || "empty"}` };
      const disputeId = text(readPath(data, "Dispute.DisputeTransactionId"));
      return {
        kind: "apply",
        status,
        invoiceId,
        paymentId: disputeId ? `dispute:${disputeId}:${ds}` : null,
        amount: num(readPath(data, "Amount.ValueInBaseCurrency")),
        currency: text(readPath(data, "Amount.BaseCurrency")),
        transaction: (isRecord(data.Dispute) ? data.Dispute : {}) as Json,
      };
    }
    default:
      return { kind: "ignore", reason: "unsupported_event" };
  }
}

/**
 * Maps a GetPaymentStatus inquiry to a booking status.
 *   InvoiceStatus Paid / DuplicatePayment→paid, Canceled→cancelled;
 *   Pending → paid if any transaction Succss/Success, failed if the only
 *   transactions failed, otherwise pending (nothing to apply yet).
 */
export function mapInquiry(inquiry: PaymentStatusOutput): StatusMapping {
  const invoiceStatus = inquiry.invoiceStatus.toUpperCase();
  const success = inquiry.transactions.find((t) => ["SUCCSS", "SUCCESS"].includes(t.status.toUpperCase()));
  const latest = inquiry.transactions[inquiry.transactions.length - 1] ?? null;
  const base = { invoiceId: inquiry.invoiceId, amount: inquiry.invoiceValue, currency: latest?.currency ?? null, externalIdentifier: inquiry.customerReference };
  // "DuplicatePayment" is a paid invoice that was paid twice (official library
  // treats it as Paid; the duplicate is refunded by MyFatoorah).
  if (invoiceStatus === "PAID" || invoiceStatus === "DUPLICATEPAYMENT" || success) {
    return { kind: "apply", status: "paid", paymentId: success?.paymentId ?? latest?.paymentId ?? null, transaction: (success?.raw ?? latest?.raw ?? null) as Json, ...base };
  }
  if (invoiceStatus === "CANCELED" || invoiceStatus === "CANCELLED") {
    return { kind: "apply", status: "cancelled", paymentId: latest?.paymentId ?? null, transaction: (latest?.raw ?? null) as Json, ...base };
  }
  if (inquiry.transactions.length > 0 && inquiry.transactions.every((t) => t.status.toUpperCase() === "FAILED")) {
    return { kind: "apply", status: "failed", paymentId: latest?.paymentId ?? null, transaction: (latest?.raw ?? null) as Json, ...base };
  }
  return { kind: "ignore", reason: `invoice_status:${invoiceStatus || "empty"}` };
}

// ---------------------------------------------------------------------------
// Booking updates (shared by webhook + reconciliation)
// ---------------------------------------------------------------------------

export type ApplyOutcome = { result: Extract<ProcessingResult, "processed" | "unchanged" | "ignored_transition" | "amount_mismatch" | "error">; status: PaymentStatus; detail?: string };

/** Amount tolerance when comparing what the provider says was paid with what the booking expects. */
export const AMOUNT_TOLERANCE_QR = 0.01;

/**
 * What a provider payment for this booking must be worth. The website
 * checkout records the amount it asked for in metadata.pay_session (keyed by
 * invoice id); otherwise it is the booking amount less anything already
 * recorded by hand (a partial cash payment followed by card for the rest).
 */
export function expectedChargeQr(booking: Pick<PhotoBookingRow, "amount_qr" | "amount_paid_qr" | "metadata">, invoiceId?: string | null): number {
  const metadata = isRecord(booking.metadata) ? booking.metadata : {};
  const session = isRecord(metadata.pay_session) ? metadata.pay_session : null;
  if (session && invoiceId && session.invoice_id === invoiceId && typeof session.amount === "number" && Number.isFinite(session.amount)) return session.amount;
  const paid = Number(booking.amount_paid_qr) || 0;
  return Math.max(0, Math.round((Number(booking.amount_qr) - paid) * 100) / 100);
}

/**
 * Null when the provider's amount and currency match what the booking
 * expects (or the event carries no amount at all); otherwise a short reason.
 * A verified "paid" with the wrong amount must never mark the booking paid.
 * With a stage request the expected charge is THAT request's amount (the
 * 50% deposit or the balance), never the booking total.
 */
export function amountMismatch(
  booking: Pick<PhotoBookingRow, "amount_qr" | "amount_paid_qr" | "metadata" | "currency">,
  mapping: Pick<Extract<StatusMapping, { kind: "apply" }>, "amount" | "currency" | "invoiceId">,
  request: Pick<PhotoBookingPaymentRequestRow, "amount_qr" | "currency"> | null = null,
): string | null {
  if (mapping.amount === null) return null;
  const expected = request ? Math.round(Number(request.amount_qr) * 100) / 100 : expectedChargeQr(booking, mapping.invoiceId);
  const currency = request ? request.currency : booking.currency;
  if (Math.abs(mapping.amount - expected) > AMOUNT_TOLERANCE_QR) return `amount ${mapping.amount} expected ${expected}`;
  if (mapping.currency && currency && mapping.currency.trim().toUpperCase() !== currency.trim().toUpperCase()) return `currency ${mapping.currency} expected ${currency}`;
  return null;
}

/**
 * Request-level legality of a provider verdict (the booking's provider
 * status is only "the latest result" once there are two stages):
 *   pending → paid | failed | cancelled;  failed → paid | cancelled;
 *   paid never regresses; cancelled / expired take nothing.
 * Refunds and disputes stay booking-level (applyTransition) on a paid request.
 */
export function requestTransition(from: PhotoBookingPaymentRequestRow["status"], to: PaymentStatus): "ok" | "same" | "illegal" {
  if (to === "paid") return from === "paid" ? "same" : from === "pending" || from === "failed" ? "ok" : "illegal";
  if (to === "failed") return from === "failed" ? "same" : from === "pending" ? "ok" : "illegal";
  if (to === "cancelled") return from === "cancelled" ? "same" : from === "pending" || from === "failed" ? "ok" : "illegal";
  return from === "paid" ? "ok" : "illegal";
}

/**
 * TODO(payments): the real link from a paid booking to a tracked athlete.
 * Deliberately NOT implemented: it must never insert into `photo_athletes`
 * (the watcher's critical path). Until webhook processing is verified in
 * production this only flags the booking for a manual link.
 */
export async function linkBookingToAthlete(booking: PhotoBookingRow, deps: WebhookDeps): Promise<void> {
  const metadata = isRecord(booking.metadata) ? booking.metadata : {};
  if (metadata.pending_athlete_link === true) return;
  const { error } = await deps.supabase
    .from("photo_bookings")
    .update({ metadata: { ...metadata, pending_athlete_link: true } as Json })
    .eq("id", booking.id);
  if (error) deps.log.warn("payments.link_flag_failed", { bookingId: booking.id, error: error.message });
}

export type ApplyContext = { source: string; eventRowId?: number | null; /** Provider event reference (or another stable id) for alert dedupe keys. */ eventId?: string | null };

/**
 * Applies one status transition ATOMICALLY through photo_apply_payment_transition:
 * booking columns (guarded by the previous status), the payment attempt row,
 * the delivery row's outcome and — on paid — the owner's [Orders]
 * confirmation in the notification outbox, in one database transaction.
 * A concurrent writer wins and this delivery is reported as an ignored
 * transition instead of clobbering it. Shared by the webhook, the replay and
 * reconcile jobs and the website pay page's return-visit verification.
 */
export async function applyStatusToBooking(booking: PhotoBookingRow, mapping: Extract<StatusMapping, { kind: "apply" }>, ctx: ApplyContext, deps: WebhookDeps, request: PhotoBookingPaymentRequestRow | null = null): Promise<ApplyOutcome> {
  const now = deps.now();
  let columns: Record<string, Json>;
  if (request && (mapping.status === "paid" || mapping.status === "failed" || mapping.status === "cancelled")) {
    // Stage request: legality is per request (paid never regresses), the
    // booking's provider status just follows as "the latest provider result".
    const legal = requestTransition(request.status, mapping.status);
    if (legal === "same") return { result: "unchanged", status: booking.status };
    if (legal === "illegal") {
      deps.log.warn("payments.illegal_request_transition", { bookingId: booking.id, requestId: request.id, from: request.status, to: mapping.status, source: ctx.source });
      return { result: "ignored_transition", status: booking.status, detail: `request:${request.status}->${mapping.status}` };
    }
    columns = { status: mapping.status, payment_status_updated_at: now.toISOString() };
    if (mapping.status === "paid") columns.paid_at = booking.paid_at ?? now.toISOString();
  } else {
    if (request && requestTransition(request.status, mapping.status) === "illegal") {
      deps.log.warn("payments.illegal_request_transition", { bookingId: booking.id, requestId: request.id, from: request.status, to: mapping.status, source: ctx.source });
      return { result: "ignored_transition", status: booking.status, detail: `request:${request.status}->${mapping.status}` };
    }
    const transition = applyTransition(booking.status, mapping.status, now, booking);
    if (!transition.ok) {
      if (transition.reason === "same_status") return { result: "unchanged", status: booking.status };
      deps.log.warn("payments.illegal_transition", { bookingId: booking.id, from: booking.status, to: mapping.status, source: ctx.source });
      return { result: "ignored_transition", status: booking.status, detail: `${booking.status}->${mapping.status}` };
    }
    columns = { ...(transition.columns as unknown as Record<string, Json>) };
  }

  // A verified SUCCESS for the wrong amount, currency or reference is still
  // not a payment of THIS stage: keep the status, keep the evidence, tell the owner.
  if (mapping.status === "paid") {
    const reference = request && mapping.externalIdentifier && mapping.externalIdentifier !== booking.id ? `reference ${mapping.externalIdentifier} expected ${booking.id}` : null;
    const mismatch = reference ?? amountMismatch(booking, mapping, request);
    if (mismatch) {
      await recordAmountMismatch(booking, mapping, mismatch, ctx, deps, request);
      return { result: "amount_mismatch", status: booking.status, detail: mismatch };
    }
  }

  // Signature validity is not payment: only Transaction.Status SUCCESS reaches
  // "paid" (mapWebhookEvent), and only then is fulfilment / confirmation planned.
  let delivery: Json | null = null;
  if (mapping.status === "paid") {
    const plan = fulfillmentPlan(booking);
    const metadata = isRecord(booking.metadata) ? booking.metadata : {};
    const relink = booking.provider_invoice_id && booking.provider_invoice_id !== mapping.invoiceId ? { provider_invoice_id: mapping.invoiceId, superseded_invoices: supersededInvoices(metadata, booking.provider_invoice_id) } : {};
    columns.metadata = { ...metadata, ...plan.metadata, pending_athlete_link: true, ...(relink.superseded_invoices ? { superseded_invoices: relink.superseded_invoices as Json } : {}) } as Json;
    if (relink.provider_invoice_id) columns.provider_invoice_id = relink.provider_invoice_id;
    const expectedQr = request ? Number(request.amount_qr) : booking.amount_qr;
    const amount = `${Number(mapping.amount ?? expectedQr).toFixed(2)} ${mapping.currency ?? (request?.currency ?? booking.currency)}`;
    const stageNote = request ? ` · ${stageWords(booking, request.stage)}` : "";
    delivery = {
      alert_key: request ? `payment:${booking.id}:paid:${request.stage}` : `payment:${booking.id}:paid`,
      kind: "PAYMENT_CONFIRMED",
      payload: { text: `<b>Payment confirmed — ${escapeHtml(booking.customer_name)}</b>\n${escapeHtml(amount)}${escapeHtml(stageNote)} · ${escapeHtml(booking.package_name)}${booking.athlete_name ? ` · ${escapeHtml(booking.athlete_name)}` : ""}\n${escapeHtml(plan.ownerText)}`, category: "orders" },
    } as Json;
  }

  const { data, error } = await deps.supabase.rpc("photo_apply_payment_transition", {
    p_booking_id: booking.id,
    p_expected_status: booking.status,
    p_columns: columns as Json,
    p_attempt: {
      provider: MYFATOORAH_PROVIDER,
      provider_invoice_id: mapping.invoiceId,
      provider_payment_id: mapping.paymentId,
      status: mapping.status,
      amount: mapping.amount ?? (request ? Number(request.amount_qr) : booking.amount_qr),
      currency: mapping.currency ?? (request?.currency ?? booking.currency),
      raw: { source: ctx.source, transaction: mapping.transaction, recorded_at: now.toISOString(), request_id: request?.id ?? null, stage: request?.stage ?? null },
    } as Json,
    p_event_row_id: ctx.eventRowId ?? null,
    p_processing_result: "processed",
    p_delivery: delivery,
  });
  if (error) {
    deps.log.error("payments.booking_update_failed", { bookingId: booking.id, error: error.message });
    return { result: "error", status: booking.status, detail: "booking_update_failed" };
  }
  const out = isRecord(data) ? data : {};
  if (out.applied !== true) return { result: "ignored_transition", status: booking.status, detail: out.reason === "booking_not_found" ? "booking_not_found" : "concurrent_update" };
  if (mapping.status === "paid") await afterProviderPaid(booking, mapping, now, deps, request);
  else if (request && (mapping.status === "failed" || mapping.status === "cancelled")) {
    const tx = isRecord(mapping.transaction) ? mapping.transaction : {};
    const err = isRecord(tx.Error) ? tx.Error : {};
    await applyProviderResultToRequest(deps.supabase, { request, status: mapping.status, invoiceId: mapping.invoiceId, providerPaymentId: mapping.paymentId, errorCode: text(err.Code), errorMessage: text(err.Message), now });
  }
  return { result: "processed", status: mapping.status };
}

/** Invoice ids this booking used before (each website checkout attempt creates a new one); the newest last, bounded. */
export function supersededInvoices(metadata: Record<string, unknown>, invoiceId: string | null | undefined): string[] {
  const existing = Array.isArray(metadata.superseded_invoices) ? metadata.superseded_invoices.filter((v): v is string => typeof v === "string") : [];
  if (!invoiceId || existing.includes(invoiceId)) return existing;
  return [...existing, invoiceId].slice(-20);
}

/**
 * Keeps the evidence of a mismatched payment on the booking (metadata only;
 * the provider status is untouched) and alerts the owner once per event.
 * Best effort: a failure here never changes the outcome.
 */
async function recordAmountMismatch(booking: PhotoBookingRow, mapping: Extract<StatusMapping, { kind: "apply" }>, reason: string, ctx: ApplyContext, deps: WebhookDeps, request: PhotoBookingPaymentRequestRow | null = null): Promise<void> {
  const now = deps.now();
  const eventKey = ctx.eventId ?? mapping.paymentId ?? mapping.invoiceId;
  const expected = request ? Number(request.amount_qr) : expectedChargeQr(booking, mapping.invoiceId);
  const expectedCurrency = request ? request.currency : booking.currency;
  deps.log.warn("payments.amount_mismatch", { bookingId: booking.id, requestId: request?.id ?? null, invoiceId: mapping.invoiceId, reason, source: ctx.source });
  try {
    const metadata = isRecord(booking.metadata) ? booking.metadata : {};
    const evidence = { invoice_id: mapping.invoiceId, payment_id: mapping.paymentId, amount: mapping.amount, currency: mapping.currency, expected, reason, source: ctx.source, at: now.toISOString(), request_id: request?.id ?? null, stage: request?.stage ?? null };
    const { error } = await deps.supabase.from("photo_bookings").update({ metadata: { ...metadata, payment_mismatch: evidence } as Json }).eq("id", booking.id);
    if (error) deps.log.warn("payments.mismatch_record_failed", { bookingId: booking.id, error: error.message });
    if (request) {
      const rm = request.metadata && typeof request.metadata === "object" && !Array.isArray(request.metadata) ? (request.metadata as Record<string, unknown>) : {};
      await deps.supabase.from("photo_booking_payment_requests").update({ error_code: "mismatch", error_message: reason.slice(0, 300), metadata: { ...rm, payment_mismatch: evidence } as Json }).eq("id", request.id);
    }
  } catch (err) {
    deps.log.warn("payments.mismatch_record_failed", { bookingId: booking.id, error: err instanceof Error ? err.message : "unknown" });
  }
  try {
    await enqueueOwnerTelegram(deps.supabase, {
      ownerId: booking.owner_id,
      kind: "INTEGRATION_FAILED",
      alertKey: `payment:${booking.id}:mismatch:${eventKey}`,
      title: `Payment amount mismatch: ${booking.customer_name}`,
      lines: [
        `${booking.public_ref ?? booking.id.slice(0, 8)} · ${booking.package_name}${request ? ` · ${stageWords(booking, request.stage)}` : ""}`,
        `MyFatoorah reports ${Number(mapping.amount).toFixed(2)} ${mapping.currency ?? ""}; ${request ? "the payment request" : "the booking"} expects ${expected.toFixed(2)} ${expectedCurrency}.`,
        `Invoice ${mapping.invoiceId}. The booking was NOT marked paid. Check the MyFatoorah portal and record the payment by hand if it is genuine.`,
      ],
      url: `${portalBase()}/bookings/${booking.id}`,
      now,
    });
  } catch (err) {
    deps.log.warn("payments.mismatch_alert_failed", { bookingId: booking.id, error: err instanceof Error ? err.message : "unknown" });
  }
}

/**
 * Which stage a verified payment settles when no request row exists (a
 * legacy link, or a hosted invoice created before stage requests): the
 * pending deposit first, and the balance too when the amount covers the
 * whole booking.
 */
function legacyStagesFor(booking: PhotoBookingRow, amount: number | null): PaymentStage[] {
  const out: PaymentStage[] = [];
  if (booking.deposit_state === "pending") out.push("deposit");
  const paid = amount ?? Number(booking.amount_qr);
  const coversAll = paid + AMOUNT_TOLERANCE_QR >= Number(booking.amount_qr);
  if (booking.balance_state !== "paid" && booking.balance_state !== "waived" && Number(booking.balance_qr) > 0 && (coversAll || booking.deposit_state !== "pending")) out.push("balance");
  return out;
}

/**
 * Studio bookkeeping after a verified "paid" transition. All best effort,
 * so a failure here never fails the webhook (the provider status itself was
 * committed atomically above):
 *   - the stage request becomes paid and the booking's stage columns follow
 *     (deposit_state / balance_state, never the other stage);
 *   - the lifecycle is recomputed through the confirmation gates: a deposit
 *     confirms the booking only when the agreement gate is clear too; a
 *     balance on a delivered booking completes it;
 *   - the payment is mirrored into photo_payment_records (kind 'provider');
 *   - the client's "payment received" (+ "booking confirmed") e-mails and the
 *     owner's Telegram notice are queued.
 * It never creates or links a tracked athlete.
 */
async function afterProviderPaid(booking: PhotoBookingRow, mapping: Extract<StatusMapping, { kind: "apply" }>, now: Date, deps: WebhookDeps, request: PhotoBookingPaymentRequestRow | null): Promise<void> {
  const nowIso = now.toISOString();
  const amountQr = Number(mapping.amount ?? (request ? request.amount_qr : booking.amount_qr));
  const stages: PaymentStage[] = request ? [request.stage] : legacyStagesFor(booking, mapping.amount);
  const audit = (action: string, data: Record<string, Json | undefined>) => writeAudit(deps.supabase, { ownerId: booking.owner_id, actorKind: "system", entity: "booking", entityId: booking.id, action, data }).catch(() => ({ ok: false }));

  if (request) {
    try {
      await applyProviderResultToRequest(deps.supabase, { request, status: "paid", invoiceId: mapping.invoiceId, providerPaymentId: mapping.paymentId, now });
    } catch (err) {
      deps.log.warn("payments.request_paid_update_failed", { bookingId: booking.id, requestId: request.id, error: err instanceof Error ? err.message : "unknown" });
    }
  }

  let confirmedNow = false;
  let completedNow = false;
  let current: PhotoBookingRow = booking;
  try {
    if (stages.includes("deposit")) {
      const { data } = await deps.supabase.from("photo_bookings").update({ deposit_state: "paid", deposit_paid_at: nowIso }).eq("id", booking.id).eq("deposit_state", "pending").select("id");
      if ((data ?? []).length) await audit("deposit.paid", { amount_qr: amountQr, currency: mapping.currency ?? booking.currency, invoice_id: mapping.invoiceId, payment_id: mapping.paymentId, request_id: request?.id ?? null, source: "provider" });
    }
    if (stages.includes("balance")) {
      const { data } = await deps.supabase.from("photo_bookings").update({ balance_state: "paid", balance_paid_at: nowIso }).eq("id", booking.id).in("balance_state", ["due", "not_due"]).select("id");
      if ((data ?? []).length) await audit("balance.paid", { amount_qr: amountQr, currency: mapping.currency ?? booking.currency, invoice_id: mapping.invoiceId, payment_id: mapping.paymentId, request_id: request?.id ?? null, source: "provider" });
    }
    const gates = await recomputeBookingGates(deps.supabase, booking.id, now);
    if (gates.moved && gates.to) await audit("booking.status", { from: booking.booking_status, to: gates.to, reason: stages.includes("deposit") ? "deposit paid" : "payment received" });
    confirmedNow = gates.moved && gates.confirmed;
    const { data: fresh } = await deps.supabase.from("photo_bookings").select("*").eq("id", booking.id).maybeSingle();
    if (fresh) current = fresh;
    if (isCompletionReady(current)) {
      const { data } = await deps.supabase.from("photo_bookings").update({ booking_status: "completed", completed_at: current.completed_at ?? nowIso }).eq("id", booking.id).eq("booking_status", "delivered").select("id");
      if ((data ?? []).length) {
        completedNow = true;
        current = { ...current, booking_status: "completed", completed_at: current.completed_at ?? nowIso };
        await audit("booking.completed", { reason: "final balance paid" });
      }
    }
  } catch (err) {
    deps.log.warn("payments.lifecycle_update_failed", { bookingId: booking.id, error: err instanceof Error ? err.message : "unknown" });
  }

  try {
    // A dispute that resolves back to paid is the same payment, not a new one.
    if (booking.status !== "disputed") {
      const { error } = await deps.supabase.from("photo_payment_records").insert({
        owner_id: booking.owner_id,
        booking_id: booking.id,
        kind: "provider",
        method: "myfatoorah",
        amount_qr: amountQr,
        currency: mapping.currency ?? (request?.currency ?? booking.currency),
        paid_at: nowIso,
        provider: MYFATOORAH_PROVIDER,
        provider_payment_id: mapping.paymentId,
        note: request ? stageWords(booking, request.stage) : null,
      });
      if (error && error.code !== PG_UNIQUE_VIOLATION) deps.log.warn("payments.record_insert_failed", { bookingId: booking.id, error: error.message });
    }
  } catch (err) {
    deps.log.warn("payments.record_insert_failed", { bookingId: booking.id, error: err instanceof Error ? err.message : "unknown" });
  }

  if (request) {
    try {
      await enqueueOwnerTelegram(deps.supabase, {
        ownerId: booking.owner_id,
        kind: "BOOKING_PAID",
        alertKey: `booking:${booking.id}:paid:${request.stage}:${request.id}`,
        title: `${request.stage === "deposit" ? "Deposit paid" : "Final balance paid"}: ${booking.customer_name}`,
        lines: [`${booking.public_ref ?? booking.id.slice(0, 8)} · ${booking.package_name}`, `${formatMoney(amountQr, mapping.currency ?? request.currency)} ${stageWords(booking, request.stage)} verified by MyFatoorah`, confirmedNow ? "Booking confirmed." : completedNow ? "Booking completed." : `Booking: ${BOOKING_STATUS_LABEL[current.booking_status]}`],
        url: `${portalBase()}/bookings/${booking.id}`,
        now,
      });
    } catch (err) {
      deps.log.warn("payments.owner_notice_failed", { bookingId: booking.id, error: err instanceof Error ? err.message : "unknown" });
    }
  }

  if (!booking.customer_email) return;
  try {
    let businessName = "Blue Belt Media";
    const { data: studio } = await deps.supabase.from("photo_studio").select("business_name").eq("owner_id", booking.owner_id).maybeSingle();
    if (studio?.business_name) businessName = studio.business_name;
    const paidBooking: PhotoBookingRow = { ...current, status: "paid" };
    const stillDue = Math.max(0, Math.round((Number(current.amount_qr) - (current.deposit_state === "paid" || current.deposit_state === "waived" ? Number(current.deposit_qr) : 0) - (current.balance_state === "paid" || current.balance_state === "waived" ? Number(current.balance_qr) : 0)) * 100) / 100);
    const options = { businessName, portalUrl: `${portalBase()}/client/bookings/${booking.id}`, payment: { amountQr, methodLabel: "card", dueQr: request ? stillDue : 0, stage: request?.stage ?? null } };
    const kinds: BookingEmailKind[] = confirmedNow ? ["PAYMENT_RECEIVED", "BOOKING_CONFIRMED"] : ["PAYMENT_RECEIVED"];
    for (const kind of kinds) {
      const draft = bookingEmailDraft(kind, paidBooking, options);
      if (!draft) continue;
      await enqueueClientEmail(deps.supabase, { ownerId: booking.owner_id, kind, alertKey: bookingEmailAlertKey(kind, booking.id, kind === "PAYMENT_RECEIVED" && request ? request.stage : null), draft, personId: booking.client_id, bookingId: booking.id, now });
    }
  } catch (err) {
    deps.log.warn("payments.client_email_failed", { bookingId: booking.id, error: err instanceof Error ? err.message : "unknown" });
  }
}

/** Same resolution as siteUrl() in the studio module, without pulling the request-scoped Supabase client into the webhook. */
function portalBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? "https://www.bluebeltmedia.com").replace(/\/$/, "");
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function findBookingByInvoice(invoiceId: string, deps: WebhookDeps): Promise<PhotoBookingRow | null> {
  const { data, error } = await deps.supabase.from("photo_bookings").select("*").eq("provider", MYFATOORAH_PROVIDER).eq("provider_invoice_id", invoiceId).maybeSingle();
  if (error) {
    deps.log.error("payments.booking_lookup_failed", { error: error.message });
    return null;
  }
  return data ?? null;
}

/**
 * The booking an event belongs to. Normally found by (provider, invoice id).
 * Each website checkout attempt creates a fresh invoice, so a customer who
 * pays an EARLIER attempt's invoice (e.g. a hosted link they kept) would not
 * match: for a PAID event only, fall back to the CustomerReference we set
 * (the booking id, echoed as Invoice.ExternalIdentifier) and accept it when
 * that booking lists the invoice among its superseded ones. The amount check
 * in applyStatusToBooking still applies.
 */
async function findBookingForMapping(mapping: Extract<StatusMapping, { kind: "apply" }>, deps: WebhookDeps): Promise<PhotoBookingRow | null> {
  const direct = await findBookingByInvoice(mapping.invoiceId, deps);
  if (direct || mapping.status !== "paid" || !isUuid(mapping.externalIdentifier ?? "")) return direct;
  const { data } = await deps.supabase.from("photo_bookings").select("*").eq("id", mapping.externalIdentifier!).eq("provider", MYFATOORAH_PROVIDER).maybeSingle();
  if (!data) return null;
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  return supersededInvoices(metadata, null).includes(mapping.invoiceId) ? data : null;
}

export type ResolvedTarget = { booking: PhotoBookingRow; request: PhotoBookingPaymentRequestRow | null };

/**
 * The stage request and booking an event belongs to. The request row is
 * found by its provider invoice id (each checkout attempt stores the
 * invoice on the request); a paid event for an invoice the request
 * superseded still matches through its metadata. Without a request row the
 * booking is resolved the legacy way (by invoice, then by CustomerReference).
 */
async function resolveMapping(mapping: Extract<StatusMapping, { kind: "apply" }>, deps: WebhookDeps): Promise<ResolvedTarget | null> {
  const request = await findRequestByInvoice(deps.supabase, mapping.invoiceId);
  if (request) {
    const { data: booking } = await deps.supabase.from("photo_bookings").select("*").eq("id", request.booking_id).maybeSingle();
    return booking ? { booking, request } : null;
  }
  const booking = await findBookingForMapping(mapping, deps);
  if (!booking) return null;
  let viaSuperseded: PhotoBookingPaymentRequestRow | null = null;
  if (mapping.status === "paid") {
    const rows = await listStageRequests(deps.supabase, booking.id);
    viaSuperseded = rows.find((r) => requestSupersededInvoices(r).includes(mapping.invoiceId)) ?? null;
  }
  return { booking, request: viaSuperseded };
}

// ---------------------------------------------------------------------------
// Order updates — the Pic-Time order side of the same invoice
// ---------------------------------------------------------------------------

/**
 * A MyFatoorah invoice can belong to a Pic-Time order instead of a standalone
 * booking: createInvoiceForOrder stamps the order with (provider,
 * provider_invoice_id). This resolves the webhook's invoice to that order.
 */
async function findOrderByInvoice(invoiceId: string, deps: WebhookDeps): Promise<PhotoOrderRow | null> {
  const { data, error } = await deps.supabase.from("photo_orders").select("*").eq("provider", MYFATOORAH_PROVIDER).eq("provider_invoice_id", invoiceId).maybeSingle();
  if (error) {
    deps.log.error("payments.order_lookup_failed", { error: error.message });
    return null;
  }
  return data ?? null;
}

type OrderApplyOutcome = { result: Extract<ProcessingResult, "processed" | "unchanged" | "ignored_transition" | "error">; detail?: string };

/**
 * Order payment_state transitions a provider event may cause. Mirrors the
 * booking rules: paid never regresses to failed (a late FAILED attempt after a
 * successful one, or after the owner confirmed an offline payment, is ignored),
 * and only a refund moves a paid order on. `unknown` behaves like `pending`.
 */
const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  unknown: ["paid", "failed"],
  pending: ["paid", "failed"],
  failed: ["paid"],
  paid: ["refunded"],
  refunded: [],
};

/** The provider-written failure result that replayUnmatchedEvents retries. */
export const ORDER_RETRY_RESULT = "error:order_update_failed";

/**
 * Applies a provider status to a Pic-Time order's payment_state. Only paid /
 * failed / refunded can change it (the order enum has no disputed or
 * cancelled); a dispute or cancellation is recorded in metadata only. The
 * update is conditional on the state it was read in, so a concurrent writer
 * (the owner confirming, another event) is never overwritten. The buyer's own
 * reported state (payment_reported_state) is left as Pic-Time sent it; the
 * provider's verdict goes in metadata. On the first transition to paid the
 * owner's [Orders] confirmation is enqueued — an owner notice, never the buyer.
 */
async function applyStatusToOrder(order: PhotoOrderRow, mapping: Extract<StatusMapping, { kind: "apply" }>, ctx: ApplyContext, deps: WebhookDeps): Promise<OrderApplyOutcome> {
  const now = deps.now();
  const metadata = isRecord(order.metadata) ? order.metadata : {};
  const lastEvent = { status: mapping.status, at: now.toISOString(), source: ctx.source, invoice_id: mapping.invoiceId };
  const columns: Partial<PhotoOrderRow> = { metadata: { ...metadata, payment_last_event: lastEvent } as Json };

  const stateFor: Partial<Record<PaymentStatus, string>> = { paid: "paid", failed: "failed", refunded: "refunded" };
  const nextState = stateFor[mapping.status];
  if (!nextState) {
    // disputed / cancelled: keep the record, do not invent an order state.
    const { error } = await deps.supabase.from("photo_orders").update(columns).eq("id", order.id).eq("owner_id", order.owner_id);
    if (error) deps.log.warn("payments.order_meta_update_failed", { orderId: order.id, error: error.message });
    return { result: "unchanged", detail: `order_${mapping.status}` };
  }
  if (order.payment_state === nextState) return { result: "unchanged", detail: `already_${nextState}` };
  if (!(ORDER_TRANSITIONS[order.payment_state] ?? []).includes(nextState)) {
    deps.log.warn("payments.order_illegal_transition", { orderId: order.id, from: order.payment_state, to: nextState, source: ctx.source });
    return { result: "ignored_transition", detail: `${order.payment_state}->${nextState}` };
  }

  columns.payment_state = nextState;
  let delivery: Database["public"]["Tables"]["photo_notification_deliveries"]["Insert"] | null = null;
  if (mapping.status === "paid") {
    // payment_confirmed_by is a user id (uuid) for owner confirmations; a
    // provider confirmation records its source in metadata instead.
    columns.paid_at = now.toISOString();
    columns.payment_confirmed_at = now.toISOString();
    columns.metadata = { ...metadata, payment_last_event: lastEvent, payment_confirmed_source: MYFATOORAH_PROVIDER } as Json;
    const amount = `${Number(mapping.amount ?? order.amount_qr).toFixed(2)} ${mapping.currency ?? order.currency}`;
    const cancelledNote = order.status === "cancelled" ? "\n⚠ This order was marked cancelled — the buyer paid its invoice anyway." : "";
    delivery = deliveryInsert({
      ownerId: order.owner_id,
      alertKey: `order-payment:${order.id}:paid`,
      kind: "PAYMENT_CONFIRMED",
      text: `<b>Payment confirmed — ${escapeHtml(order.customer_name)}</b>\n${escapeHtml(amount)}${order.gallery_name ? ` · ${escapeHtml(order.gallery_name)}` : ""}${cancelledNote}`,
      category: "orders",
      now,
    });
  }

  const { data: updated, error } = await deps.supabase
    .from("photo_orders")
    .update(columns)
    .eq("id", order.id)
    .eq("owner_id", order.owner_id)
    .eq("payment_state", order.payment_state)
    .select("id");
  if (error) {
    deps.log.error("payments.order_update_failed", { orderId: order.id, error: error.message });
    return { result: "error", detail: "order_update_failed" };
  }
  if (!updated?.length) return { result: "ignored_transition", detail: "concurrent_update" };
  if (delivery) {
    const { error: dErr } = await deps.supabase.from("photo_notification_deliveries").insert(delivery);
    if (dErr) deps.log.warn("payments.order_confirm_enqueue_failed", { orderId: order.id, error: dErr.message });
  }
  return { result: "processed" };
}

// ---------------------------------------------------------------------------
// Webhook entry point
// ---------------------------------------------------------------------------

/** Stop polling / replaying a stuck booking or unmatched event after this long. */
const MAX_PENDING_AGE_MINUTES = 14 * 24 * 60;

/**
 * What to persist as a delivery's payload. A verified delivery keeps its full
 * body (needed for replay/reconcile). An UNVERIFIED delivery is attacker-
 * controlled, so only a hash + size is stored as evidence — never the raw
 * blob — until a real signed copy upgrades the row to the full body.
 */
function storedPayload(body: Record<string, unknown>, signatureValid: boolean): Json {
  if (signatureValid) return body as Json;
  const text = JSON.stringify(body);
  return { unverified: true, hash: createHash("sha256").update(text, "utf8").digest("hex"), bytes: Buffer.byteLength(text, "utf8") };
}

export async function processWebhook(event: WebhookEvent, deps: WebhookDeps): Promise<ProcessWebhookOutcome> {
  const { body } = event;
  const eventId = providerEventIdOf(body);
  const eventType = eventTypeOf(body);
  const eventName = eventNameOf(body);
  const receivedAt = deps.now().toISOString();

  // (1) Record the delivery. The partial unique index (provider, provider_event_id)
  // makes a redelivery fail with 23505; PostgREST upsert cannot target a partial
  // index, so insert-then-handle-conflict is the idempotency primitive.
  const { data: inserted, error: insertError } = await deps.supabase
    .from("photo_payment_events")
    .insert({ provider: MYFATOORAH_PROVIDER, provider_event_id: eventId, event_type: eventType, payload: storedPayload(body, event.signatureValid), signature_valid: event.signatureValid, received_at: receivedAt, attempts: 1 })
    .select("id")
    .single();

  let rowId: number;
  if (insertError) {
    if (insertError.code !== PG_UNIQUE_VIOLATION) {
      deps.log.error("payments.event_insert_failed", { eventId, eventType, error: insertError.message });
      return { result: "error", eventId, eventType, bookingId: null, detail: "event_insert_failed" };
    }
    const { data: existing } = await deps.supabase.from("photo_payment_events").select("id, attempts, booking_id, signature_valid, processing_result").eq("provider", MYFATOORAH_PROVIDER).eq("provider_event_id", eventId).maybeSingle();
    // An earlier UNVERIFIED copy of this event (bad signature, replay attempt,
    // transit damage) must never shadow the real, signed delivery: take the
    // row over and process it now.
    if (existing && existing.signature_valid === false && event.signatureValid) {
      await deps.supabase.from("photo_payment_events").update({ attempts: (existing.attempts ?? 1) + 1, signature_valid: true, payload: body as Json, received_at: receivedAt, processing_result: null, processed_at: null }).eq("id", existing.id);
      deps.log.info("payments.event_upgraded", { eventId, eventType, attempts: (existing.attempts ?? 1) + 1 });
      rowId = existing.id;
    } else {
      if (existing) await deps.supabase.from("photo_payment_events").update({ attempts: (existing.attempts ?? 1) + 1 }).eq("id", existing.id);
      deps.log.info("payments.duplicate_event", { eventId, eventType, attempts: (existing?.attempts ?? 1) + 1 });
      return { result: "duplicate", eventId, eventType, bookingId: existing?.booking_id ?? null };
    }
  } else {
    rowId = inserted.id;
  }

  const finish = async (result: ProcessingResult, booking: PhotoBookingRow | null, status?: PaymentStatus, detail?: string, order?: PhotoOrderRow | null): Promise<ProcessWebhookOutcome> => {
    await deps.supabase
      .from("photo_payment_events")
      .update({ processing_result: detail ? `${result}:${detail}` : result, processed_at: deps.now().toISOString(), booking_id: booking?.id ?? null, order_id: order?.id ?? null, owner_id: booking?.owner_id ?? order?.owner_id ?? null })
      .eq("id", rowId);
    return { result, eventId, eventType, bookingId: booking?.id ?? null, status, detail };
  };

  // (2) Untrusted delivery: keep the evidence, touch nothing else.
  if (!event.signatureValid) {
    deps.log.warn("payments.invalid_signature", { eventId, eventType });
    return finish("invalid_signature", null);
  }

  // (3) Map to a booking status and apply the transition.
  const mapping = mapWebhookEvent(eventName, isRecord(body.Data) ? body.Data : {});
  if (mapping.kind === "ignore") return finish("ignored_event", null, undefined, mapping.reason);

  const target = await resolveMapping(mapping, deps);
  if (!target) {
    // Not a standalone booking — the invoice may belong to a Pic-Time order.
    const order = await findOrderByInvoice(mapping.invoiceId, deps);
    if (order) {
      const appliedOrder = await applyStatusToOrder(order, mapping, { source: `webhook:${eventId}`, eventRowId: rowId }, deps);
      return finish(appliedOrder.result, null, appliedOrder.result === "processed" ? mapping.status : undefined, appliedOrder.detail, order);
    }
    deps.log.warn("payments.booking_not_found", { eventId, eventType });
    return finish("booking_not_found", null);
  }
  const { booking, request } = target;

  const applied = await applyStatusToBooking(booking, mapping, { source: `webhook:${eventId}`, eventRowId: rowId, eventId }, deps, request);
  // "processed" already marked the delivery row inside the transaction.
  if (applied.result === "processed") return { result: "processed", eventId, eventType, bookingId: booking.id, status: applied.status };
  return finish(applied.result, booking, applied.status, applied.detail);
}

// ---------------------------------------------------------------------------
// Confirmation job helpers (cron / manual)
// ---------------------------------------------------------------------------

/**
 * Re-applies verified events that arrived before their booking existed
 * (processing_result = booking_not_found), and events whose order update
 * failed transiently (ORDER_RETRY_RESULT) — a redelivery of those is a
 * duplicate, so this is their only retry path. Bounded; safe to repeat.
 */
export async function replayUnmatchedEvents(deps: WebhookDeps, limit = 50): Promise<{ scanned: number; applied: number; abandoned: number }> {
  const floor = new Date(deps.now().getTime() - MAX_PENDING_AGE_MINUTES * 60_000).toISOString();
  // Events still unmatched past the window will almost certainly never match
  // (wrong invoice id, cancelled sale). Retire them to a terminal result so
  // they stop being re-scanned every tick, and report the count.
  const { data: retired, error: retireError } = await deps.supabase
    .from("photo_payment_events")
    .update({ processing_result: "abandoned", processed_at: deps.now().toISOString() })
    .eq("provider", MYFATOORAH_PROVIDER)
    .eq("signature_valid", true)
    .in("processing_result", ["booking_not_found", ORDER_RETRY_RESULT])
    .lte("received_at", floor)
    .select("id");
  if (retireError) deps.log.warn("payments.abandon_failed", { error: retireError.message });
  const abandoned = (retired ?? []).length;

  const { data: events } = await deps.supabase
    .from("photo_payment_events")
    .select("*")
    .eq("provider", MYFATOORAH_PROVIDER)
    .eq("signature_valid", true)
    .in("processing_result", ["booking_not_found", ORDER_RETRY_RESULT])
    .gt("received_at", floor)
    .order("received_at", { ascending: true })
    .limit(limit);
  let applied = 0;
  for (const ev of events ?? []) {
    const body = isRecord(ev.payload) ? ev.payload : {};
    const mapping = mapWebhookEvent(eventNameOf(body), isRecord(body.Data) ? body.Data : {});
    if (mapping.kind === "ignore") continue;
    const source = `replay:${ev.provider_event_id ?? ev.id}`;
    const target = await resolveMapping(mapping, deps);
    if (target) {
      const { booking } = target;
      const out = await applyStatusToBooking(booking, mapping, { source, eventRowId: ev.id, eventId: String(ev.provider_event_id ?? ev.id) }, deps, target.request);
      if (out.result !== "processed") {
        await deps.supabase.from("photo_payment_events").update({ processing_result: out.detail ? `${out.result}:${out.detail}` : out.result, processed_at: deps.now().toISOString(), booking_id: booking.id, owner_id: booking.owner_id }).eq("id", ev.id);
      } else {
        applied += 1;
      }
      continue;
    }
    // No booking — try the Pic-Time order side (the order may have been
    // invoiced after this event first arrived).
    const order = await findOrderByInvoice(mapping.invoiceId, deps);
    if (!order) continue;
    const out = await applyStatusToOrder(order, mapping, { source, eventRowId: ev.id }, deps);
    await deps.supabase.from("photo_payment_events").update({ processing_result: out.detail ? `${out.result}:${out.detail}` : out.result, processed_at: deps.now().toISOString(), order_id: order.id, owner_id: order.owner_id }).eq("id", ev.id);
    if (out.result === "processed") applied += 1;
  }
  return { scanned: (events ?? []).length, applied, abandoned };
}

/**
 * Reconciles bookings that have an invoice but are still pending / failed
 * after `olderThanMinutes` (a missed webhook). Calls the provider once per
 * booking; bounded by `limit`.
 */
export async function reconcilePendingBookings(provider: PaymentProvider, deps: WebhookDeps, opts: { olderThanMinutes?: number; maxAgeMinutes?: number; limit?: number } = {}): Promise<{ scanned: number; changed: number; results: ReconcileResult[] }> {
  const now = deps.now().getTime();
  const cutoff = new Date(now - (opts.olderThanMinutes ?? 10) * 60_000).toISOString();
  // Lower bound: an invoice the customer never paid would otherwise be polled
  // (one provider call each) on every tick forever. Past the window, stop; the
  // owner reconciles those by hand.
  const floor = new Date(now - (opts.maxAgeMinutes ?? MAX_PENDING_AGE_MINUTES) * 60_000).toISOString();
  const { data: bookings } = await deps.supabase
    .from("photo_bookings")
    .select("id")
    .eq("provider", MYFATOORAH_PROVIDER)
    .in("status", ["pending", "failed"])
    .not("provider_invoice_id", "is", null)
    .lt("created_at", cutoff)
    .gt("created_at", floor)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 25);
  // Stage requests: a booking whose provider status is already "paid" (the
  // deposit) can still have a pending balance request with an invoice.
  const { data: requests } = await deps.supabase
    .from("photo_booking_payment_requests")
    .select("booking_id,provider_invoice_id,created_at")
    .eq("status", "pending")
    .not("provider_invoice_id", "is", null)
    .lt("created_at", cutoff)
    .gt("created_at", floor)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 25);
  const ids = [...new Set([...(bookings ?? []).map((b) => b.id), ...(requests ?? []).map((r) => r.booking_id)])].slice(0, opts.limit ?? 25);
  const results: ReconcileResult[] = [];
  for (const id of ids) results.push(await reconcileBooking(id, provider, deps));
  return { scanned: results.length, changed: results.filter((r) => r.result === "processed").length, results };
}

// ---------------------------------------------------------------------------
// Reconciliation (cron / manual)
// ---------------------------------------------------------------------------

export type ReconcileResult = {
  result: ProcessingResult | "no_invoice" | "provider_error";
  bookingId: string;
  status?: PaymentStatus;
  detail?: string;
};

/**
 * Pulls the invoice from GetPaymentStatus and applies the same transition
 * rules as the webhook. Safe to run repeatedly; never creates athletes.
 */
export async function reconcileBooking(bookingId: string, provider: PaymentProvider, deps: WebhookDeps): Promise<ReconcileResult> {
  const { data: booking, error } = await deps.supabase.from("photo_bookings").select("*").eq("id", bookingId).maybeSingle();
  if (error || !booking) return { result: "booking_not_found", bookingId, detail: error?.message };
  if (!booking.provider_invoice_id) return { result: "no_invoice", bookingId, status: booking.status };

  const inquiry = await provider.getPaymentStatus({ key: booking.provider_invoice_id, keyType: "InvoiceId" });
  if (!inquiry.ok) {
    deps.log.warn("payments.reconcile_provider_error", { bookingId, code: inquiry.error.code, httpStatus: inquiry.error.httpStatus });
    return { result: "provider_error", bookingId, status: booking.status, detail: inquiry.error.code };
  }

  const mapping = mapInquiry(inquiry.data);
  if (mapping.kind === "ignore") return { result: "unchanged", bookingId, status: booking.status, detail: mapping.reason };
  if (!isPaymentStatus(mapping.status)) return { result: "error", bookingId, status: booking.status, detail: "bad_status" };

  const request = await findRequestByInvoice(deps.supabase, mapping.invoiceId);
  const applied = await applyStatusToBooking(booking, mapping, { source: "reconcile", eventId: mapping.paymentId ? `reconcile:${mapping.paymentId}` : null }, deps, request);
  deps.log.info("payments.reconcile", { bookingId, result: applied.result, from: booking.status, to: applied.status, requestId: request?.id ?? null });
  return { result: applied.result, bookingId, status: applied.status, detail: applied.detail };
}
