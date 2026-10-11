import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import type { Logger } from "@/lib/log";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { createInvoiceForOrder, invoiceExpiryDate, type CreateInvoiceForOrderResult } from "@/lib/payments/invoicing";
import type { PaymentProvider } from "@/lib/payments/myfatoorah/client";
import { reconcileOrder, type OrderReconcileResult } from "@/lib/payments/myfatoorah/webhook";
import { createOrderPayToken, orderPayPageUrl } from "@/lib/payments/pay-token";
import type { Database, Json, PhotoNotificationDeliveryRow, PhotoOrderRow } from "@/lib/supabase/database.types";
import { exceptionCard, invoiceCard, orderCardKeys, type CardOrder } from "./cards";

export { orderCardKeys };
import { DEFAULT_ORDER_INVOICING, emailProblem, EXCEPTION_LABEL, invoiceBlocker, readOrderInvoicing, SKIP_LABEL, type InvoiceExceptionReason, type OrderInvoicingSettings, type SkipReason } from "./eligibility";
import { orderEmailAlertKey, orderPaymentLinkEmail } from "./emails";

type Client = SupabaseClient<Database>;

/**
 * The photo-order payment workflow, shared by the intake route (automatic
 * mode), the payments cron (durable retries), the dashboard buttons and the
 * Telegram inline buttons. One code path, one set of guards:
 *
 *   request  -> invoice_requested_at is stamped once (the durable queue)
 *   process  -> lease the job, mint the private pay link once, create the
 *               provider invoice once (claim + relink inside
 *               createInvoiceForOrder), queue ONE customer e-mail per send
 *               count, write the owner's [Orders] card, complete the job
 *   resend   -> a new e-mail for the SAME link and invoice, never a new invoice
 *   check    -> ask the provider about the invoice and apply the webhook's rules
 *   fulfil   -> record that the purchased photos were released (by hand)
 *
 * Amounts come from the order row; e-mail addresses from the order row; the
 * owner from the order row. Nothing is read from a button or a browser.
 */
export type OrderActor = { kind: "auto" | "owner" | "telegram" | "cron" | "pay_page"; userId?: string | null; telegramUserId?: number | null };

export function actorLabel(a: OrderActor): string {
  if (a.kind === "owner") return `owner:${a.userId ?? "unknown"}`;
  if (a.kind === "telegram") return `telegram:${a.telegramUserId ?? "unknown"}`;
  return a.kind;
}

export type OrderServiceDeps = {
  supabase: Client;
  /** Null while online payments are not configured: no invoice can be created. */
  provider: PaymentProvider | null;
  now: () => Date;
  log: Logger;
  siteUrl: string;
};

export type StudioContext = { businessName: string; invoicing: OrderInvoicingSettings };

/** The owner's business name and invoicing mode, read once per operation (service client, no session). */
export async function loadStudioContext(supabase: Client, ownerId: string): Promise<StudioContext> {
  const { data } = await supabase.from("photo_studio").select("business_name,settings").eq("owner_id", ownerId).maybeSingle();
  return { businessName: data?.business_name ?? "Blue Belt Media", invoicing: data ? readOrderInvoicing(data.settings) : DEFAULT_ORDER_INVOICING };
}

/** How long one runner owns an order's invoice job before another may take over. */
export const INVOICE_JOB_LEASE_MS = 90_000;
/** Provider failures per job before the order lands in the exception queue (the owner's buttons still work). */
export const INVOICE_JOB_MAX_ATTEMPTS = 4;
/** Retry schedule for provider failures, by attempt number. */
const JOB_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
/** The hosted invoice at the provider lives as long as our link. */
export const ORDER_INVOICE_DAYS = 30;

function metadataOf(order: Pick<PhotoOrderRow, "metadata">): Record<string, unknown> {
  return order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata) ? (order.metadata as Record<string, unknown>) : {};
}

async function loadOrder(supabase: Client, orderId: string): Promise<PhotoOrderRow | null> {
  const { data } = await supabase.from("photo_orders").select("*").eq("id", orderId).maybeSingle();
  return data ?? null;
}

async function audit(deps: OrderServiceDeps, order: PhotoOrderRow, actor: OrderActor, action: string, data: Record<string, Json | undefined> = {}): Promise<void> {
  try {
    await writeAudit(deps.supabase, {
      ownerId: order.owner_id,
      actorId: actor.kind === "owner" ? actor.userId ?? null : null,
      actorKind: actor.kind === "owner" || actor.kind === "telegram" ? "owner" : actor.kind === "pay_page" ? "client" : "system",
      entity: "order",
      entityId: order.id,
      action,
      data: { ...data, via: actor.kind, telegram_user_id: actor.telegramUserId ?? undefined },
    });
  } catch (err) {
    deps.log.warn("orders.audit_failed", { orderId: order.id, action, error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// Request (queue)
// ---------------------------------------------------------------------------

export type RequestInvoiceResult = { ok: true; queued: boolean; retried: boolean } | { ok: false; code: SkipReason; error: string };

/**
 * Stamps the durable request. Idempotent: a second request for the same
 * order queues nothing (unless the previous job ended in an exception, which
 * an owner / Telegram request re-opens with a fresh attempt budget).
 */
export async function requestOrderInvoice(deps: OrderServiceDeps, order: PhotoOrderRow, actor: OrderActor): Promise<RequestInvoiceResult> {
  const blocker = invoiceBlocker(order);
  if (blocker) return { ok: false, code: blocker, error: SKIP_LABEL[blocker] };
  const now = deps.now().toISOString();
  const by = actorLabel(actor);
  const { data: fresh } = await deps.supabase
    .from("photo_orders")
    .update({ invoice_requested_at: now, invoice_requested_by: by })
    .eq("id", order.id)
    .eq("owner_id", order.owner_id)
    .is("invoice_requested_at", null)
    .select("id");
  if (fresh?.length) {
    await audit(deps, order, actor, "order.invoice_requested", {});
    return { ok: true, queued: true, retried: false };
  }
  // Already requested. Only a manual request after an EXCEPTION re-opens the
  // job (a finished, successful job is never re-run: that is what Resend is
  // for; a stuck job is reclaimed by the lease, not by a new request).
  if (actor.kind === "auto" || actor.kind === "cron") return { ok: true, queued: false, retried: false };
  if (!order.invoice_exception) return { ok: true, queued: false, retried: false };
  const { data: reopened } = await deps.supabase
    .from("photo_orders")
    .update({ invoice_completed_at: null, invoice_exception: null, invoice_job_attempts: 0, invoice_next_attempt_at: null, invoice_job_error: null, invoice_job_leased_until: null, invoice_requested_by: by, invoice_email_state: order.invoice_email_state === "exception" ? "none" : order.invoice_email_state })
    .eq("id", order.id)
    .eq("owner_id", order.owner_id)
    .not("invoice_requested_at", "is", null)
    .select("id");
  if (!reopened?.length) return { ok: true, queued: false, retried: false };
  await audit(deps, order, actor, "order.invoice_retried", { previous_exception: order.invoice_exception ?? undefined });
  return { ok: true, queued: true, retried: true };
}

// ---------------------------------------------------------------------------
// Process (the job)
// ---------------------------------------------------------------------------

export type ProcessOutcome =
  | { kind: "queued"; order: PhotoOrderRow; emailQueued: boolean }
  | { kind: "exception"; order: PhotoOrderRow; reason: InvoiceExceptionReason }
  | { kind: "retry_later"; order: PhotoOrderRow; detail: string }
  | { kind: "skipped"; order: PhotoOrderRow; reason: SkipReason | "not_requested" | "in_progress" | "done" }
  | { kind: "not_found" };

/** Runs the invoice job for one order to a terminal state (or a scheduled retry). Safe to call repeatedly and concurrently. */
export async function processOrderInvoice(deps: OrderServiceDeps, orderId: string, ctx?: StudioContext): Promise<ProcessOutcome> {
  const start = await loadOrder(deps.supabase, orderId);
  if (!start) return { kind: "not_found" };
  if (!start.invoice_requested_at) return { kind: "skipped", order: start, reason: "not_requested" };
  if (start.invoice_completed_at) return { kind: "skipped", order: start, reason: "done" };
  const now = deps.now();

  const blocker = invoiceBlocker(start);
  if (blocker) {
    await deps.supabase.from("photo_orders").update({ invoice_completed_at: now.toISOString(), invoice_job_error: `skipped:${blocker}`, invoice_job_leased_until: null }).eq("id", start.id).eq("owner_id", start.owner_id).is("invoice_completed_at", null);
    return { kind: "skipped", order: start, reason: blocker };
  }

  // Lease the job so overlapping runners (cron + intake kick + a button) never work the same order twice.
  const { data: leased } = await deps.supabase
    .from("photo_orders")
    .update({ invoice_job_leased_until: new Date(now.getTime() + INVOICE_JOB_LEASE_MS).toISOString() })
    .eq("id", start.id)
    .eq("owner_id", start.owner_id)
    .is("invoice_completed_at", null)
    .or(`invoice_job_leased_until.is.null,invoice_job_leased_until.lt.${now.toISOString()}`)
    .select("*");
  const order = (leased ?? [])[0] as PhotoOrderRow | undefined;
  if (!order) return { kind: "skipped", order: start, reason: "in_progress" };

  const studio = ctx ?? (await loadStudioContext(deps.supabase, order.owner_id));
  try {
    // 1. The private link, minted once. payment_url becomes our page; an older provider URL moves to metadata.
    let current = order;
    if (!current.pay_token_hash) {
      const { token, hash } = createOrderPayToken();
      const url = orderPayPageUrl(deps.siteUrl, token);
      const metadata = metadataOf(current);
      const legacyProviderUrl = current.payment_url && !isRecordWithUrl(metadata.invoice) ? current.payment_url : null;
      const invoiceMeta = isRecord(metadata.invoice) ? metadata.invoice : null;
      const patch: Partial<PhotoOrderRow> = { pay_token_hash: hash, pay_token_created_at: now.toISOString(), payment_url: url };
      if (legacyProviderUrl) patch.metadata = { ...metadata, invoice: { ...(invoiceMeta ?? {}), provider_payment_url: legacyProviderUrl } } as Json;
      const { data: minted, error } = await deps.supabase.from("photo_orders").update(patch).eq("id", current.id).eq("owner_id", current.owner_id).is("pay_token_hash", null).select("*");
      if (error) throw new Error(`mint link: ${error.message}`);
      if (minted?.length) {
        current = minted[0] as PhotoOrderRow;
        deps.log.info("orders.pay_link_minted", { orderId: current.id });
        await audit(deps, current, { kind: "cron" }, "order.pay_link_created", { token_hash_prefix: hash.slice(0, 8) });
      } else {
        current = (await loadOrder(deps.supabase, current.id)) ?? current;
      }
    }

    // 2. The provider invoice, created once (claim + stale-claim relink inside).
    if (!current.provider_invoice_id) {
      if (!deps.provider) return finishException(deps, current, studio, "payments_off");
      const created: CreateInvoiceForOrderResult = await createInvoiceForOrder(current, deps.provider, deps, {
        callbackUrl: `${current.payment_url}?result=callback`,
        errorUrl: `${current.payment_url}?result=error`,
        expiryDate: invoiceExpiryDate(now, ORDER_INVOICE_DAYS),
      });
      if (!created.ok) {
        if (created.reason === "in_progress") {
          await releaseLease(deps, current);
          return { kind: "retry_later", order: current, detail: "invoice in progress elsewhere" };
        }
        if (created.reason === "already_paid" || created.reason === "cancelled" || created.reason === "no_amount") {
          const reason: SkipReason = created.reason === "already_paid" ? "paid" : created.reason === "cancelled" ? "cancelled" : "free";
          await deps.supabase.from("photo_orders").update({ invoice_completed_at: now.toISOString(), invoice_job_error: `skipped:${reason}`, invoice_job_leased_until: null }).eq("id", current.id);
          return { kind: "skipped", order: current, reason };
        }
        return scheduleRetry(deps, current, studio, `provider:${created.detail ?? "error"}`);
      }
      current = (await loadOrder(deps.supabase, current.id)) ?? current;
      await audit(deps, current, { kind: "cron" }, "order.invoice_created", { invoice_id: created.invoiceId, amount_qr: current.amount_qr, currency: current.currency, relinked: created.relinked ?? false });
    }

    // 3. One customer e-mail per send count.
    const outcome = await queuePaymentLinkEmail(deps, current, studio, { kind: "cron" });
    if (!outcome.ok) return finishException(deps, current, studio, outcome.reason);
    return { kind: "queued", order: outcome.order, emailQueued: outcome.queued };
  } catch (err) {
    return scheduleRetry(deps, order, studio, err instanceof Error ? err.message.slice(0, 160) : "unknown error");
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isRecordWithUrl(v: unknown): boolean {
  return isRecord(v) && typeof v.provider_payment_url === "string";
}

async function releaseLease(deps: OrderServiceDeps, order: PhotoOrderRow): Promise<void> {
  await deps.supabase.from("photo_orders").update({ invoice_job_leased_until: null }).eq("id", order.id).eq("owner_id", order.owner_id);
}

async function scheduleRetry(deps: OrderServiceDeps, order: PhotoOrderRow, studio: StudioContext, detail: string): Promise<ProcessOutcome> {
  const attempts = (order.invoice_job_attempts ?? 0) + 1;
  deps.log.warn("orders.invoice_job_failed", { orderId: order.id, attempts, detail });
  if (attempts >= INVOICE_JOB_MAX_ATTEMPTS) {
    await deps.supabase.from("photo_orders").update({ invoice_job_attempts: attempts, invoice_job_error: detail }).eq("id", order.id).eq("owner_id", order.owner_id);
    return finishException(deps, { ...order, invoice_job_attempts: attempts }, studio, "provider_failed");
  }
  const wait = JOB_BACKOFF_MS[Math.min(attempts, JOB_BACKOFF_MS.length) - 1];
  await deps.supabase
    .from("photo_orders")
    .update({ invoice_job_attempts: attempts, invoice_job_error: detail, invoice_next_attempt_at: new Date(deps.now().getTime() + wait).toISOString(), invoice_job_leased_until: null })
    .eq("id", order.id)
    .eq("owner_id", order.owner_id);
  return { kind: "retry_later", order: { ...order, invoice_job_attempts: attempts }, detail };
}

/** Parks the order in the exception queue and tells the owner once per (reason, occurrence). */
async function finishException(deps: OrderServiceDeps, order: PhotoOrderRow, studio: StudioContext, reason: InvoiceExceptionReason): Promise<ProcessOutcome> {
  const now = deps.now();
  // Occurrence number for the owner's card key: the attempt that failed, or 1 for a first-pass exception (no e-mail, payments off).
  const n = order.invoice_job_attempts || 1;
  const { data } = await deps.supabase
    .from("photo_orders")
    .update({ invoice_exception: reason, invoice_email_state: "exception", invoice_email_updated_at: now.toISOString(), invoice_completed_at: now.toISOString(), invoice_job_leased_until: null, invoice_job_error: reason })
    .eq("id", order.id)
    .eq("owner_id", order.owner_id)
    .select("*");
  const updated = ((data ?? [])[0] as PhotoOrderRow | undefined) ?? { ...order, invoice_exception: reason, invoice_email_state: "exception" as const };
  deps.log.warn("orders.invoice_exception", { orderId: order.id, reason });
  await audit(deps, updated, { kind: "cron" }, "order.invoice_exception", { reason });
  const card = exceptionCard(updated, deps.siteUrl, `Invoice needs attention: ${EXCEPTION_LABEL[reason]}. ${reason === "no_email" || reason === "invalid_email" ? "Add the buyer's e-mail in the gallery and tap Send invoice, or share the payment link yourself from the order page." : reason === "provider_failed" ? "Tap Send invoice to try again." : "Fix the setting, then tap Send invoice."}`);
  await enqueueOwnerTelegram(deps.supabase, { ownerId: updated.owner_id, kind: "ORDER_EXCEPTION", alertKey: orderCardKeys.exception(updated, reason, n), html: card.text, buttons: card.buttons, orderId: updated.id, supersedes: [orderCardKeys.placed(updated)], now });
  void studio;
  return { kind: "exception", order: updated, reason };
}

type QueueEmailOutcome = { ok: true; order: PhotoOrderRow; queued: boolean } | { ok: false; reason: InvoiceExceptionReason };

/** Queues the payment-link e-mail for the current send count and records the state on the order. */
async function queuePaymentLinkEmail(deps: OrderServiceDeps, order: PhotoOrderRow, studio: StudioContext, actor: OrderActor): Promise<QueueEmailOutcome> {
  const now = deps.now();
  const problem = emailProblem(order.customer_email);
  if (problem) return { ok: false, reason: problem };
  if (!order.payment_url) return { ok: false, reason: "provider_failed" };
  const count = (order.invoice_email_count ?? 0) + 1;
  const draft = orderPaymentLinkEmail(order, { businessName: studio.businessName, payUrl: order.payment_url });
  if (!draft) return { ok: false, reason: "no_email" };
  const res = await enqueueClientEmail(deps.supabase, { ownerId: order.owner_id, kind: "ORDER_PAYMENT_LINK", alertKey: orderEmailAlertKey("ORDER_PAYMENT_LINK", order.id, count), draft: { ...draft }, personId: order.client_id, now, extra: { orderId: order.id, sendCount: count } });
  if (!res.ok) throw new Error(`queue e-mail: ${res.error}`);
  if (!res.queued && res.reason === "disabled_by_owner") return { ok: false, reason: "email_disabled" };
  if (!res.queued && res.reason === "invalid_address") return { ok: false, reason: "invalid_email" };
  // queued, or a duplicate of this exact send count (an earlier run got this far): either way the state is "queued".
  const { data } = await deps.supabase
    .from("photo_orders")
    .update({ invoice_email_state: "queued", invoice_email_updated_at: now.toISOString(), invoice_email_count: count, invoice_exception: null, invoice_completed_at: now.toISOString(), invoice_job_leased_until: null, invoice_job_error: null })
    .eq("id", order.id)
    .eq("owner_id", order.owner_id)
    .select("*");
  const updated = ((data ?? [])[0] as PhotoOrderRow | undefined) ?? { ...order, invoice_email_state: "queued" as const, invoice_email_count: count };
  deps.log.info("orders.invoice_email_queued", { orderId: order.id, count, duplicate: !res.queued });
  await audit(deps, updated, actor, "order.invoice_email_queued", { send_count: count, invoice_id: updated.provider_invoice_id ?? undefined });
  const card = invoiceCard(updated, deps.siteUrl);
  await enqueueOwnerTelegram(deps.supabase, {
    ownerId: updated.owner_id,
    kind: "ORDER_INVOICE",
    alertKey: orderCardKeys.invoice(updated, count),
    html: card.text,
    buttons: card.buttons,
    orderId: updated.id,
    // A resend edits the previous invoice card instead of adding a new one.
    editOf: count > 1 ? orderCardKeys.invoice(updated, count - 1) : null,
    supersedes: [orderCardKeys.placed(updated), ...(count > 1 ? [orderCardKeys.invoiceSent(updated, count - 1)] : [])],
    now,
  });
  return { ok: true, order: updated, queued: res.queued };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type InvoiceJobsSummary = { scanned: number; queued: number; exceptions: number; retried: number; skipped: number; budgetHit: boolean };

/** Bounded pass over the durable queue. Safe to run from several places at once. */
export async function runOrderInvoiceJobs(deps: OrderServiceDeps, opts: { limit?: number; budgetMs?: number; orderId?: string | null } = {}): Promise<InvoiceJobsSummary> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 25_000;
  const nowIso = deps.now().toISOString();
  let q = deps.supabase
    .from("photo_orders")
    .select("id,owner_id")
    .not("invoice_requested_at", "is", null)
    .is("invoice_completed_at", null)
    .lt("invoice_job_attempts", INVOICE_JOB_MAX_ATTEMPTS)
    .or(`invoice_next_attempt_at.is.null,invoice_next_attempt_at.lte.${nowIso}`)
    .order("invoice_requested_at", { ascending: true })
    .limit(Math.min(Math.max(opts.limit ?? 10, 1), 50));
  if (opts.orderId) q = q.eq("id", opts.orderId);
  const { data: rows, error } = await q;
  if (error) throw new Error(`invoice jobs: ${error.message}`);
  const summary: InvoiceJobsSummary = { scanned: 0, queued: 0, exceptions: 0, retried: 0, skipped: 0, budgetHit: false };
  const studios = new Map<string, StudioContext>();
  for (const row of rows ?? []) {
    if (Date.now() - started >= budgetMs) {
      summary.budgetHit = true;
      break;
    }
    summary.scanned += 1;
    let studio = studios.get(row.owner_id);
    if (!studio) {
      studio = await loadStudioContext(deps.supabase, row.owner_id);
      studios.set(row.owner_id, studio);
    }
    const out = await processOrderInvoice(deps, row.id, studio);
    if (out.kind === "queued") summary.queued += 1;
    else if (out.kind === "exception") summary.exceptions += 1;
    else if (out.kind === "retry_later") summary.retried += 1;
    else summary.skipped += 1;
  }
  return summary;
}

export type QueueStats = { waiting: number; oldestWaitingAt: string | null; exceptions: number; emailFailed: number };

/** Backlog for the dashboard and the cron response (counts only, never customer data). */
export async function orderInvoiceQueueStats(supabase: Client): Promise<QueueStats> {
  const [waiting, exceptions, failed] = await Promise.all([
    supabase.from("photo_orders").select("invoice_requested_at").not("invoice_requested_at", "is", null).is("invoice_completed_at", null).order("invoice_requested_at", { ascending: true }).limit(500),
    supabase.from("photo_orders").select("id", { count: "exact", head: true }).not("invoice_exception", "is", null).neq("status", "cancelled").neq("payment_state", "paid"),
    supabase.from("photo_orders").select("id", { count: "exact", head: true }).eq("invoice_email_state", "failed").neq("status", "cancelled").neq("payment_state", "paid"),
  ]);
  const rows = waiting.data ?? [];
  return { waiting: rows.length, oldestWaitingAt: rows[0]?.invoice_requested_at ?? null, exceptions: exceptions.count ?? 0, emailFailed: failed.count ?? 0 };
}

// ---------------------------------------------------------------------------
// Owner / Telegram actions on one order
// ---------------------------------------------------------------------------

export type ActionResult = { ok: true; message: string; order: PhotoOrderRow } | { ok: false; error: string; order?: PhotoOrderRow };

/**
 * "Send invoice": queue the job (idempotent) and run it right away so the
 * caller can report the result; a repeat click finds the job done and does
 * nothing new. In automatic mode this is the same path the intake used.
 */
export async function sendOrderInvoiceNow(deps: OrderServiceDeps, orderId: string, actor: OrderActor): Promise<ActionResult> {
  const order = await loadOrder(deps.supabase, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  const requested = await requestOrderInvoice(deps, order, actor);
  if (!requested.ok) return { ok: false, error: requested.error, order };
  if (!requested.queued && order.invoice_completed_at && !order.invoice_exception) {
    // Already done: the link exists and the e-mail went (or is queued). Resend is the right button.
    if (order.invoice_email_state === "queued") return { ok: true, message: "The payment link is already created and its e-mail is queued.", order };
    if (order.invoice_email_state === "sent") return { ok: true, message: "The payment link was already e-mailed. Use Resend e-mail to send it again.", order };
  }
  const out = await processOrderInvoice(deps, order.id);
  return describeOutcome(out, order);
}

export function describeOutcome(out: ProcessOutcome, fallback: PhotoOrderRow): ActionResult {
  switch (out.kind) {
    case "queued":
      return { ok: true, message: out.emailQueued ? "Invoice created. The payment link e-mail is queued and will show as sent once delivered." : "Invoice already created; its e-mail is queued.", order: out.order };
    case "exception":
      return { ok: false, error: `Needs attention: ${EXCEPTION_LABEL[out.reason]}.`, order: out.order };
    case "retry_later":
      return { ok: false, error: `The payment service did not answer (${out.detail}). The job will retry automatically; you can also tap again in a minute.`, order: out.order };
    case "skipped":
      if (out.reason === "in_progress") return { ok: true, message: "The invoice is being created right now. Check again in a moment.", order: out.order };
      if (out.reason === "done") return { ok: true, message: "The invoice job already finished for this order.", order: out.order };
      if (out.reason === "not_requested") return { ok: false, error: "No invoice was requested for this order.", order: out.order };
      return { ok: false, error: SKIP_LABEL[out.reason], order: out.order };
    case "not_found":
      return { ok: false, error: "Order not found.", order: fallback };
  }
}

/** "Resend / Retry e-mail": another e-mail with the SAME link and invoice; never a second invoice. */
export async function resendOrderInvoiceEmail(deps: OrderServiceDeps, orderId: string, actor: OrderActor): Promise<ActionResult> {
  const order = await loadOrder(deps.supabase, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  const blocker = invoiceBlocker(order);
  if (blocker) return { ok: false, error: SKIP_LABEL[blocker], order };
  if (!order.pay_token_hash || !order.payment_url || !order.provider_invoice_id) return sendOrderInvoiceNow(deps, orderId, actor);
  const studio = await loadStudioContext(deps.supabase, order.owner_id);
  const out = await queuePaymentLinkEmail(deps, order, studio, actor);
  if (!out.ok) {
    await deps.supabase.from("photo_orders").update({ invoice_exception: out.reason, invoice_email_state: "exception", invoice_email_updated_at: deps.now().toISOString() }).eq("id", order.id).eq("owner_id", order.owner_id);
    return { ok: false, error: `Could not e-mail the link: ${EXCEPTION_LABEL[out.reason]}.`, order };
  }
  return { ok: true, message: out.queued ? `E-mail ${out.order.invoice_email_count} queued. It shows as sent once delivered.` : "That e-mail was already queued.", order: out.order };
}

/** "Check payment": the provider's verdict on the order's invoice, applied with the webhook's own rules. */
export async function checkOrderPaymentNow(deps: OrderServiceDeps, orderId: string, actor: OrderActor): Promise<ActionResult & { reconcile?: OrderReconcileResult }> {
  const order = await loadOrder(deps.supabase, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.payment_state === "paid") return { ok: true, message: "This order is already paid.", order };
  if (!order.provider_invoice_id) return { ok: false, error: "No invoice exists for this order yet.", order };
  if (!deps.provider) return { ok: false, error: "Online payments are not configured on the server.", order };
  const r = await reconcileOrder(order, deps.provider, deps);
  await audit(deps, order, actor, "order.payment_checked", { result: r.result, detail: r.detail, state: r.state });
  const fresh = (await loadOrder(deps.supabase, orderId)) ?? order;
  if (r.result === "provider_error") return { ok: false, error: "The payment service did not answer. Try again in a moment.", order: fresh, reconcile: r };
  if (r.result === "processed" && r.state === "paid") return { ok: true, message: "Payment confirmed by the payment service.", order: fresh, reconcile: r };
  if (r.result === "amount_mismatch") return { ok: false, error: `The provider reports a payment that does not match this order (${r.detail}). Not marked paid; check the order page.`, order: fresh, reconcile: r };
  if (fresh.payment_state === "paid") return { ok: true, message: "Payment confirmed.", order: fresh, reconcile: r };
  return { ok: true, message: r.state === "failed" ? "The last payment attempt failed. The buyer can try again with the same link." : "Not paid yet.", order: fresh, reconcile: r };
}

/** "Done": records that the purchased photos were released in the gallery, by hand. Never touches the gallery itself. */
export async function fulfillOrder(deps: OrderServiceDeps, orderId: string, actor: OrderActor): Promise<ActionResult> {
  const order = await loadOrder(deps.supabase, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status === "cancelled") return { ok: false, error: "This order is cancelled.", order };
  if (order.status === "fulfilled") return { ok: true, message: "Already marked done.", order };
  const now = deps.now();
  const { data } = await deps.supabase.from("photo_orders").update({ status: "fulfilled", fulfilled_at: now.toISOString() }).eq("id", order.id).eq("owner_id", order.owner_id).neq("status", "cancelled").is("fulfilled_at", null).select("*");
  const updated = ((data ?? [])[0] as PhotoOrderRow | undefined) ?? { ...order, status: "fulfilled", fulfilled_at: now.toISOString() };
  await audit(deps, updated, actor, "order.fulfilled", {});
  const card = invoiceCard(updated, deps.siteUrl, "Fulfilment: done. Purchased photos released (recorded by you).");
  await enqueueOwnerTelegram(deps.supabase, { ownerId: updated.owner_id, kind: "ORDER_FULFILLED", alertKey: orderCardKeys.fulfilled(updated), html: card.text, buttons: card.buttons, orderId: updated.id, editOf: orderCardKeys.paid(updated), supersedes: [orderCardKeys.paid(updated)], now });
  return { ok: true, message: "Marked done.", order: updated };
}

// ---------------------------------------------------------------------------
// E-mail outcome hooks (called by the e-mail runner)
// ---------------------------------------------------------------------------

function orderIdOf(row: Pick<PhotoNotificationDeliveryRow, "payload" | "kind">): string | null {
  if (row.kind !== "ORDER_PAYMENT_LINK") return null;
  const p = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {};
  return typeof p.orderId === "string" ? p.orderId : null;
}

/** The payment-link e-mail left the server: the order (and its Telegram card) say "sent". */
export async function onOrderEmailSent(supabase: Client, row: PhotoNotificationDeliveryRow, now: Date, siteUrl: string): Promise<void> {
  const orderId = orderIdOf(row);
  if (!orderId) return;
  const { data } = await supabase.from("photo_orders").update({ invoice_email_state: "sent", invoice_email_updated_at: now.toISOString(), invoice_exception: null }).eq("id", orderId).in("invoice_email_state", ["queued", "failed", "exception", "none"]).select("*");
  const order = (data ?? [])[0] as PhotoOrderRow | undefined;
  if (!order) return;
  const count = order.invoice_email_count || 1;
  const card = invoiceCard(order, siteUrl);
  await enqueueOwnerTelegram(supabase, { ownerId: order.owner_id, kind: "ORDER_INVOICE", alertKey: orderCardKeys.invoiceSent(order, count), html: card.text, buttons: card.buttons, orderId: order.id, editOf: orderCardKeys.invoice(order, count), now });
  await writeAudit(supabase, { ownerId: order.owner_id, actorKind: "system", entity: "order", entityId: order.id, action: "order.invoice_email_sent", data: { send_count: count, delivery_id: row.id } }).catch(() => ({ ok: false }));
}

/** Every attempt failed: the order needs the owner (Retry e-mail), and Telegram says so once per send count. */
export async function onOrderEmailFailed(supabase: Client, row: PhotoNotificationDeliveryRow, now: Date, siteUrl: string): Promise<void> {
  const orderId = orderIdOf(row);
  if (!orderId) return;
  const { data } = await supabase.from("photo_orders").update({ invoice_email_state: "failed", invoice_email_updated_at: now.toISOString() }).eq("id", orderId).eq("invoice_email_state", "queued").select("*");
  const order = (data ?? [])[0] as PhotoOrderRow | undefined;
  if (!order) return;
  const count = order.invoice_email_count || 1;
  const card = exceptionCard(order, siteUrl, `The payment-link e-mail could not be delivered${row.last_error ? ` (${row.last_error.slice(0, 120)})` : ""}. Tap Retry e-mail, or share the link from the order page.`);
  await enqueueOwnerTelegram(supabase, { ownerId: order.owner_id, kind: "ORDER_EXCEPTION", alertKey: orderCardKeys.invoiceFailed(order, count), html: card.text, buttons: card.buttons, orderId: order.id, editOf: orderCardKeys.invoice(order, count), now });
}

export type { CardOrder };
