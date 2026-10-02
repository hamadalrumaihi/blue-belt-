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
import type { Database, Json, PhotoBookingRow } from "@/lib/supabase/database.types";
import { applyTransition, isPaymentStatus, type PaymentStatus } from "@/lib/payments/types";
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
  | { kind: "apply"; status: PaymentStatus; invoiceId: string; paymentId: string | null; amount: number | null; currency: string | null; transaction: Json }
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
  const base = { invoiceId: inquiry.invoiceId, amount: inquiry.invoiceValue, currency: latest?.currency ?? null };
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

type ApplyOutcome = { result: Extract<ProcessingResult, "processed" | "unchanged" | "ignored_transition" | "error">; status: PaymentStatus; detail?: string };

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

async function applyStatusToBooking(booking: PhotoBookingRow, mapping: Extract<StatusMapping, { kind: "apply" }>, source: string, deps: WebhookDeps): Promise<ApplyOutcome> {
  const now = deps.now();
  const transition = applyTransition(booking.status, mapping.status, now, booking);
  if (!transition.ok) {
    if (transition.reason === "same_status") return { result: "unchanged", status: booking.status };
    deps.log.warn("payments.illegal_transition", { bookingId: booking.id, from: booking.status, to: mapping.status, source });
    return { result: "ignored_transition", status: booking.status, detail: `${booking.status}->${mapping.status}` };
  }

  // Optimistic guard on the previous status: a concurrent writer wins and this
  // delivery is reported as an ignored transition instead of clobbering it.
  const { data: updated, error: updateError } = await deps.supabase
    .from("photo_bookings")
    .update(transition.columns)
    .eq("id", booking.id)
    .eq("status", booking.status)
    .select("id");
  if (updateError) {
    deps.log.error("payments.booking_update_failed", { bookingId: booking.id, error: updateError.message });
    return { result: "error", status: booking.status, detail: "booking_update_failed" };
  }
  if (!updated || updated.length === 0) return { result: "ignored_transition", status: booking.status, detail: "concurrent_update" };

  if (mapping.status === "paid") await linkBookingToAthlete(booking, deps);

  // One attempt row per provider payment id; a redelivery with the same id is fine.
  const { error: attemptError } = await deps.supabase.from("photo_payment_attempts").insert({
    owner_id: booking.owner_id,
    booking_id: booking.id,
    provider: MYFATOORAH_PROVIDER,
    provider_invoice_id: mapping.invoiceId,
    provider_payment_id: mapping.paymentId,
    status: mapping.status,
    amount: mapping.amount ?? booking.amount_qr,
    currency: mapping.currency ?? booking.currency,
    raw: { source, transaction: mapping.transaction, recorded_at: now.toISOString() } as Json,
  });
  if (attemptError && attemptError.code !== PG_UNIQUE_VIOLATION) {
    deps.log.warn("payments.attempt_insert_failed", { bookingId: booking.id, error: attemptError.message });
  }
  return { result: "processed", status: mapping.status };
}

async function findBookingByInvoice(invoiceId: string, deps: WebhookDeps): Promise<PhotoBookingRow | null> {
  const { data, error } = await deps.supabase.from("photo_bookings").select("*").eq("provider", MYFATOORAH_PROVIDER).eq("provider_invoice_id", invoiceId).maybeSingle();
  if (error) {
    deps.log.error("payments.booking_lookup_failed", { error: error.message });
    return null;
  }
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Webhook entry point
// ---------------------------------------------------------------------------

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
    .insert({ provider: MYFATOORAH_PROVIDER, provider_event_id: eventId, event_type: eventType, payload: body as Json, signature_valid: event.signatureValid, received_at: receivedAt, attempts: 1 })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code !== PG_UNIQUE_VIOLATION) {
      deps.log.error("payments.event_insert_failed", { eventId, eventType, error: insertError.message });
      return { result: "error", eventId, eventType, bookingId: null, detail: "event_insert_failed" };
    }
    const { data: existing } = await deps.supabase.from("photo_payment_events").select("id, attempts, booking_id").eq("provider", MYFATOORAH_PROVIDER).eq("provider_event_id", eventId).maybeSingle();
    if (existing) await deps.supabase.from("photo_payment_events").update({ attempts: (existing.attempts ?? 1) + 1 }).eq("id", existing.id);
    deps.log.info("payments.duplicate_event", { eventId, eventType, attempts: (existing?.attempts ?? 1) + 1 });
    return { result: "duplicate", eventId, eventType, bookingId: existing?.booking_id ?? null };
  }
  const rowId = inserted.id;

  const finish = async (result: ProcessingResult, booking: PhotoBookingRow | null, status?: PaymentStatus, detail?: string): Promise<ProcessWebhookOutcome> => {
    await deps.supabase
      .from("photo_payment_events")
      .update({ processing_result: detail ? `${result}:${detail}` : result, processed_at: deps.now().toISOString(), booking_id: booking?.id ?? null, owner_id: booking?.owner_id ?? null })
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

  const booking = await findBookingByInvoice(mapping.invoiceId, deps);
  if (!booking) {
    deps.log.warn("payments.booking_not_found", { eventId, eventType });
    return finish("booking_not_found", null);
  }

  const applied = await applyStatusToBooking(booking, mapping, `webhook:${eventId}`, deps);
  return finish(applied.result, booking, applied.status, applied.detail);
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

  const applied = await applyStatusToBooking(booking, mapping, "reconcile", deps);
  deps.log.info("payments.reconcile", { bookingId, result: applied.result, from: booking.status, to: applied.status });
  return { result: applied.result, bookingId, status: applied.status, detail: applied.detail };
}
