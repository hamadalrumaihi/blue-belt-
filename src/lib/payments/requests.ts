import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { bookingEmailAlertKey, bookingEmailDraft } from "@/lib/bookings/emails";
import { contractSatisfied } from "@/lib/bookings/gates";
import { formatMoney, isStageOpen, stageAmount, stageWords } from "@/lib/bookings/state";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import type { AuditActorKind, Database, Json, PaymentStage, PhotoBookingPaymentRequestRow, PhotoBookingRow } from "@/lib/supabase/database.types";
import { createPayToken, payPageUrl } from "./pay-token";

type Client = SupabaseClient<Database>;

/**
 * Stage payment requests (round 3): one request per booking stage, deposit
 * before confirmation and balance after delivery. Every amount comes from
 * the booking row (deposit_qr / balance_qr, computed by the policy when the
 * owner sets the price); nothing here reads an amount from a browser.
 *
 * Idempotent: a pending request for (booking, stage) is returned as is
 * (same link, no new row; the partial unique index backs this up); a paid
 * stage refuses; after a failed / cancelled / expired request a new one is
 * created with `generation + 1` and audited as regenerated.
 *
 * Creating a request never messages the customer. `sendStagePaymentLink` is
 * the separate, explicit owner action that queues the e-mail and the owner's
 * Telegram notice.
 *
 * Providers (the `provider` column of the request row):
 *   WEBSITE      our /pay/<token> page (default; needs MyFatoorah configured)
 *   MANUAL_LINK  a link the owner pasted from the provider dashboard
 *   MYFATOORAH   reserved for API-created hosted invoices
 */
export const REQUEST_PROVIDER = { WEBSITE: "WEBSITE", MANUAL_LINK: "MANUAL_LINK", MYFATOORAH: "MYFATOORAH" } as const;

/** Owner-facing blocker when MyFatoorah is not configured: nothing is faked. */
export const PAYMENTS_NOT_CONFIGURED_MESSAGE = "Online card payments are not configured. Paste a payment link from your payment provider dashboard, or set the keys.";

export type StageRequestBlocker =
  | "cancelled"
  | "completed"
  | "no_amount"
  | "deposit_not_required"
  | "deposit_paid"
  | "contract_unsigned"
  | "balance_not_due"
  | "balance_paid"
  | "balance_not_required";

export const STAGE_REQUEST_BLOCKER_LABEL: Record<StageRequestBlocker, string> = {
  cancelled: "This booking is cancelled.",
  completed: "This booking is completed.",
  no_amount: "Set the price first.",
  deposit_not_required: "No deposit is required for this booking.",
  deposit_paid: "The deposit is already paid.",
  contract_unsigned: "Blocked because the agreement has not been signed. The deposit is requested only after the agreement is signed.",
  balance_not_due: "Final balance is not due until delivery.",
  balance_paid: "The final balance is already paid.",
  balance_not_required: "There is no remaining balance for this booking.",
};

export type StageGateBooking = Pick<PhotoBookingRow, "booking_status" | "requires_contract" | "requires_guardian_release" | "contract_state" | "deposit_state" | "balance_state" | "amount_qr" | "subject_is_minor" | "deposit_qr" | "balance_qr">;

/**
 * Why a stage cannot be requested right now, or null when it can.
 *   deposit: only once the agreement is signed (or none is required), while
 *            the deposit is pending and the booking is live;
 *   balance: only once delivery made it due.
 */
export function stageRequestBlocker(b: StageGateBooking, stage: PaymentStage): StageRequestBlocker | null {
  if (b.booking_status === "cancelled") return "cancelled";
  if (b.booking_status === "completed") return "completed";
  if (stage === "deposit") {
    if (b.deposit_state === "paid") return "deposit_paid";
    if (b.deposit_state === "not_required" || b.deposit_state === "waived") return "deposit_not_required";
    if (!(stageAmount(b, "deposit") > 0)) return "no_amount";
    if (!contractSatisfied(b)) return "contract_unsigned";
    return null;
  }
  if (b.balance_state === "paid") return "balance_paid";
  if (b.balance_state === "waived") return "balance_not_required";
  if (b.balance_state === "not_due") return "balance_not_due";
  if (!(stageAmount(b, "balance") > 0)) return "no_amount";
  return null;
}

export function requestMetadata(r: Pick<PhotoBookingPaymentRequestRow, "metadata">): Record<string, unknown> {
  return r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata) ? (r.metadata as Record<string, unknown>) : {};
}

/** Provider invoice ids an earlier checkout attempt of this request used. */
export function requestSupersededInvoices(r: Pick<PhotoBookingPaymentRequestRow, "metadata">): string[] {
  const v = requestMetadata(r).superseded_invoices;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function listStageRequests(supabase: Client, bookingId: string): Promise<PhotoBookingPaymentRequestRow[]> {
  const { data } = await supabase.from("photo_booking_payment_requests").select("*").eq("booking_id", bookingId).order("created_at", { ascending: true }).limit(100);
  return [...(data ?? [])].sort((a, b) => a.generation - b.generation);
}

export function pendingRequestFor(rows: readonly PhotoBookingPaymentRequestRow[], stage: PaymentStage): PhotoBookingPaymentRequestRow | null {
  return rows.find((r) => r.stage === stage && r.status === "pending") ?? null;
}

/** The newest request of a stage (highest generation), whatever its status. */
export function latestRequestFor(rows: readonly PhotoBookingPaymentRequestRow[], stage: PaymentStage): PhotoBookingPaymentRequestRow | null {
  return rows.filter((r) => r.stage === stage).sort((a, b) => b.generation - a.generation)[0] ?? null;
}

export async function findRequestByInvoice(supabase: Client, invoiceId: string): Promise<PhotoBookingPaymentRequestRow | null> {
  const { data } = await supabase.from("photo_booking_payment_requests").select("*").eq("provider_invoice_id", invoiceId).maybeSingle();
  return data ?? null;
}

export async function findRequestByTokenHash(supabase: Client, hash: string): Promise<PhotoBookingPaymentRequestRow | null> {
  const { data } = await supabase.from("photo_booking_payment_requests").select("*").eq("pay_token_hash", hash).maybeSingle();
  return data ?? null;
}

export type RequestActor = { userId: string | null; kind: AuditActorKind };

export type CreateStageRequestInput = {
  booking: PhotoBookingRow;
  stage: PaymentStage;
  actor: RequestActor;
  idempotencyKey?: string | null;
  /** isPaymentsEnabled() at the time of the call; false means no WEBSITE link can be minted. */
  paymentsEnabled: boolean;
  /** Absolute site origin for the /pay page. */
  siteUrl: string;
  /** A link the owner pasted from the provider dashboard (https only). Used instead of our pay page. */
  manualUrl?: string | null;
  now?: Date;
};

export type CreateStageRequestResult =
  | { ok: true; request: PhotoBookingPaymentRequestRow; created: boolean; regenerated: boolean; payUrl: string }
  | { ok: false; code: StageRequestBlocker | "already_paid" | "payments_off" | "invalid_link" | "write_failed"; error: string };

const PG_UNIQUE_VIOLATION = "23505";
const MAX_LINK_LENGTH = 2048;

/** A pasted provider link: https, no credentials, sane length. */
export function isValidManualPaymentLink(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > MAX_LINK_LENGTH) return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && !u.username && !u.password && Boolean(u.hostname);
  } catch {
    return false;
  }
}

export async function createStagePaymentRequest(supabase: Client, input: CreateStageRequestInput): Promise<CreateStageRequestResult> {
  const { booking, stage } = input;
  const now = input.now ?? new Date();
  const blocker = stageRequestBlocker(booking, stage);
  if (blocker) return { ok: false, code: blocker, error: STAGE_REQUEST_BLOCKER_LABEL[blocker] };

  const rows = (await listStageRequests(supabase, booking.id)).filter((r) => r.stage === stage);
  const pending = pendingRequestFor(rows, stage);
  if (pending) return { ok: true, request: pending, created: false, regenerated: false, payUrl: pending.payment_url ?? "" };
  if (rows.some((r) => r.status === "paid")) return { ok: false, code: "already_paid", error: stage === "deposit" ? STAGE_REQUEST_BLOCKER_LABEL.deposit_paid : STAGE_REQUEST_BLOCKER_LABEL.balance_paid };

  const amount = stageAmount(booking, stage);
  if (!(amount > 0)) return { ok: false, code: "no_amount", error: STAGE_REQUEST_BLOCKER_LABEL.no_amount };

  let provider: string;
  let paymentUrl: string;
  let tokenHash: string | null = null;
  if (input.manualUrl) {
    if (!isValidManualPaymentLink(input.manualUrl)) return { ok: false, code: "invalid_link", error: "Paste a full https link from your payment provider dashboard." };
    provider = REQUEST_PROVIDER.MANUAL_LINK;
    paymentUrl = input.manualUrl.trim();
  } else if (!input.paymentsEnabled) {
    return { ok: false, code: "payments_off", error: PAYMENTS_NOT_CONFIGURED_MESSAGE };
  } else {
    const { token, hash } = createPayToken();
    provider = REQUEST_PROVIDER.WEBSITE;
    paymentUrl = payPageUrl(input.siteUrl, token);
    tokenHash = hash;
  }

  const generation = rows.reduce((max, r) => Math.max(max, r.generation), 0) + 1;
  const previous = latestRequestFor(rows, stage);
  const regenerated = generation > 1;
  const idempotencyKey = (input.idempotencyKey ?? "").trim() || `${booking.id}:${stage}:${generation}`;
  const { data: inserted, error } = await supabase
    .from("photo_booking_payment_requests")
    .insert({
      owner_id: booking.owner_id,
      booking_id: booking.id,
      stage,
      amount_qr: amount,
      currency: booking.currency || "QAR",
      provider,
      provider_invoice_id: null,
      provider_payment_id: null,
      provider_reference: null,
      payment_url: paymentUrl,
      status: "pending",
      idempotency_key: idempotencyKey,
      generation,
      pay_token_hash: tokenHash,
      error_code: null,
      error_message: null,
      sent_at: null,
      paid_at: null,
      failed_at: null,
      cancelled_at: null,
      expired_at: null,
      metadata: { created_by: input.actor.userId, previous_request_id: previous?.id ?? null, previous_status: previous?.status ?? null } as Json,
      created_at: now.toISOString(),
    })
    .select("*")
    .single();
  if (error || !inserted) {
    if (error?.code === PG_UNIQUE_VIOLATION) {
      // Lost a race with another owner click: the pending request that won is the link.
      const again = pendingRequestFor(await listStageRequests(supabase, booking.id), stage);
      if (again) return { ok: true, request: again, created: false, regenerated: false, payUrl: again.payment_url ?? "" };
    }
    return { ok: false, code: "write_failed", error: error?.message ?? "Could not create the payment request." };
  }

  const auditBase = { ownerId: booking.owner_id, actorId: input.actor.userId, actorKind: input.actor.kind, entity: "booking" as const, entityId: booking.id };
  await writeAudit(supabase, { ...auditBase, action: "payment_request.created", data: { request_id: inserted.id, stage, amount_qr: amount, currency: inserted.currency, provider, generation, token_hash_prefix: tokenHash ? tokenHash.slice(0, 8) : null } });
  if (regenerated) await writeAudit(supabase, { ...auditBase, action: "payment_request.regenerated", data: { request_id: inserted.id, stage, generation, previous_request_id: previous?.id ?? null, previous_status: previous?.status ?? null } });
  if (provider === REQUEST_PROVIDER.MANUAL_LINK) await writeAudit(supabase, { ...auditBase, action: "payment_request.manual_link", data: { request_id: inserted.id, stage, amount_qr: amount, host: safeHost(paymentUrl) } });
  return { ok: true, request: inserted, created: true, regenerated, payUrl: paymentUrl };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export type CancelStageRequestResult = { ok: true; changed: boolean } | { ok: false; error: string };

/** Cancels a pending request (the owner regenerates the link, or recorded the stage by hand). A paid request is never cancelled. */
export async function cancelStagePaymentRequest(supabase: Client, input: { request: PhotoBookingPaymentRequestRow; actor: RequestActor; reason: string; now?: Date }): Promise<CancelStageRequestResult> {
  const { request } = input;
  if (request.status === "paid") return { ok: false, error: "This payment request is already paid." };
  if (request.status !== "pending") return { ok: true, changed: false };
  const now = (input.now ?? new Date()).toISOString();
  const { data, error } = await supabase
    .from("photo_booking_payment_requests")
    .update({ status: "cancelled", cancelled_at: now, metadata: { ...requestMetadata(request), cancel_reason: input.reason } as Json })
    .eq("id", request.id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  const changed = (data ?? []).length > 0;
  if (changed) await writeAudit(supabase, { ownerId: request.owner_id, actorId: input.actor.userId, actorKind: input.actor.kind, entity: "booking", entityId: request.booking_id, action: "payment_request.cancelled", data: { request_id: request.id, stage: request.stage, generation: request.generation, reason: input.reason } });
  return { ok: true, changed };
}

export type ProviderResultInput = {
  request: PhotoBookingPaymentRequestRow;
  status: "paid" | "failed" | "cancelled";
  invoiceId: string | null;
  providerPaymentId: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  now: Date;
};

/**
 * Writes the provider's verdict on a request. Guarded by the status the
 * caller read: paid never regresses to failed or cancelled, a duplicate or
 * out-of-order delivery changes nothing. Returns whether the row changed.
 */
export async function applyProviderResultToRequest(supabase: Client, input: ProviderResultInput): Promise<{ changed: boolean }> {
  const { request, status } = input;
  const iso = input.now.toISOString();
  const allowedFrom: Record<ProviderResultInput["status"], readonly PhotoBookingPaymentRequestRow["status"][]> = { paid: ["pending", "failed"], failed: ["pending"], cancelled: ["pending", "failed"] };
  if (!allowedFrom[status].includes(request.status)) return { changed: false };
  const patch: Partial<PhotoBookingPaymentRequestRow> = { status, provider_invoice_id: input.invoiceId ?? request.provider_invoice_id, provider_payment_id: input.providerPaymentId ?? request.provider_payment_id };
  if (status === "paid") patch.paid_at = iso;
  if (status === "failed") {
    patch.failed_at = iso;
    patch.error_code = (input.errorCode ?? "").slice(0, 80) || null;
    patch.error_message = (input.errorMessage ?? "").slice(0, 300) || null;
  }
  if (status === "cancelled") patch.cancelled_at = iso;
  const { data, error } = await supabase.from("photo_booking_payment_requests").update(patch).eq("id", request.id).in("status", [...allowedFrom[status]]).select("id");
  if (error) return { changed: false };
  return { changed: (data ?? []).length > 0 };
}

export type SendStageLinkInput = {
  booking: PhotoBookingRow;
  request: PhotoBookingPaymentRequestRow;
  actor: RequestActor;
  businessName: string;
  portalUrl: string;
  /** Link to the owner's booking page for the Telegram notice. */
  ownerUrl: string;
  now?: Date;
};

export type SendStageLinkResult = { ok: true; emailQueued: boolean; reason?: string } | { ok: false; error: string };

/**
 * The explicit "Send payment link" action: queues the client's
 * PAYMENT_REQUESTED e-mail (stage in plain words, amount and currency, our
 * link only) and the owner's Telegram notice, and stamps sent_at. Each send
 * is a deliberate click, so a repeat send is allowed and keyed separately.
 */
export async function sendStagePaymentLink(supabase: Client, input: SendStageLinkInput): Promise<SendStageLinkResult> {
  const { booking, request } = input;
  const now = input.now ?? new Date();
  if (request.status !== "pending") return { ok: false, error: "Only a pending payment request can be sent." };
  if (!request.payment_url) return { ok: false, error: "This payment request has no link." };
  const sendCount = Number(requestMetadata(request).send_count) || 0;
  const words = stageWords(booking, request.stage);
  let emailQueued = false;
  let reason: string | undefined;
  if (!booking.customer_email) {
    reason = "No e-mail address on file for this client, so nothing was sent. Share the link yourself.";
  } else {
    const draft = bookingEmailDraft("PAYMENT_REQUESTED", booking, { businessName: input.businessName, portalUrl: input.portalUrl, request: { stage: request.stage, amountQr: Number(request.amount_qr), currency: request.currency, payUrl: request.payment_url } });
    if (draft) {
      const res = await enqueueClientEmail(supabase, { ownerId: booking.owner_id, kind: "PAYMENT_REQUESTED", alertKey: bookingEmailAlertKey("PAYMENT_REQUESTED", booking.id, `${request.id}:${sendCount + 1}`), draft, personId: booking.client_id, bookingId: booking.id, now });
      if (!res.ok) reason = `The e-mail could not be queued: ${res.error}`;
      else if (res.queued) emailQueued = true;
      else if (res.reason === "disabled_by_owner") reason = "Payment request e-mails are switched off under Notifications, so the client was not e-mailed.";
      else if (res.reason === "invalid_address") reason = "The client's e-mail address is not valid, so nothing was sent.";
      else reason = "This link was already queued for the client.";
    }
  }
  await enqueueOwnerTelegram(supabase, {
    ownerId: booking.owner_id,
    kind: "BOOKING_PAYMENT_REQUESTED",
    alertKey: `booking:${booking.id}:payment-link:${request.id}:${sendCount + 1}`,
    title: `Payment link sent: ${booking.customer_name}`,
    lines: [`${booking.public_ref ?? booking.id.slice(0, 8)} · ${booking.package_name}`, `${formatMoney(request.amount_qr, request.currency)} ${words}`, `Link: ${request.payment_url}`, emailQueued ? "Queued for the client by e-mail." : reason ?? "Not e-mailed."],
    url: input.ownerUrl,
    now,
  });
  await supabase
    .from("photo_booking_payment_requests")
    .update({ sent_at: now.toISOString(), metadata: { ...requestMetadata(request), send_count: sendCount + 1, last_sent_at: now.toISOString() } as Json })
    .eq("id", request.id);
  await writeAudit(supabase, { ownerId: booking.owner_id, actorId: input.actor.userId, actorKind: input.actor.kind, entity: "booking", entityId: booking.id, action: "payment_request.sent", data: { request_id: request.id, stage: request.stage, email_queued: emailQueued, send_count: sendCount + 1 } });
  return { ok: true, emailQueued, reason };
}

/** Customer-safe projection of a request for the pay page and the portal: no provider ids, no internal states. */
export type ClientRequestSummary = { stage: PaymentStage; amountQr: number; currency: string; status: PhotoBookingPaymentRequestRow["status"]; payUrl: string | null; open: boolean };

export function clientRequestSummary(booking: Pick<PhotoBookingRow, "deposit_state" | "balance_state">, r: Pick<PhotoBookingPaymentRequestRow, "stage" | "amount_qr" | "currency" | "status" | "payment_url">): ClientRequestSummary {
  return { stage: r.stage, amountQr: Number(r.amount_qr), currency: r.currency, status: r.status, payUrl: r.payment_url, open: r.status === "pending" && isStageOpen(booking, r.stage) };
}
