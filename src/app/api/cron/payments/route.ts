import { verifyCronSecret } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { JOB_NAMES, recordJobHeartbeat } from "@/lib/jobs/heartbeat";
import { requestLogger } from "@/lib/log";
import { orderInvoiceQueueStats, runOrderInvoiceJobs, type InvoiceJobsSummary, type QueueStats } from "@/lib/orders/payment-link";
import { getPaymentsConfig, isPaymentsEnabled } from "@/lib/payments/config";
import { createMyFatoorahClient } from "@/lib/payments/myfatoorah/client";
import { reconcilePendingBookings, reconcilePendingOrders, replayUnmatchedEvents } from "@/lib/payments/myfatoorah/webhook";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/studio/queries";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/cron/payments   (Authorization: Bearer <CRON_SECRET>)
 *
 * The payment job. Dark (404) unless PAYMENTS_MYFATOORAH_ENABLED and both
 * secrets are set. Bounded steps, in order:
 *   1. order invoice jobs: every order whose invoice was requested (automatic
 *      mode at intake, or an owner's Send invoice) and not finished yet gets
 *      its private pay link, provider invoice and customer e-mail (retries
 *      with backoff; exceptions go to Telegram). This is the durable path;
 *      the intake route only kicks the same runner for its own order.
 *   2. replay verified webhook events that arrived before their booking or
 *      order existed (no provider call);
 *   3. only with PAYMENTS_RECONCILE_ENABLED=1: ask the provider about
 *      bookings and orders still unpaid after 10+ minutes (missed webhooks).
 * Provider credentials live here (Vercel), never on the Railway ticker.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/cron/payments");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!isPaymentsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  if (!verifyCronSecret(request)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });
  if (!isServiceClientConfigured()) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  const limit = rateLimit("cron-payments", RULES.cron);
  if (!limit.ok) return NextResponse.json({ error: "Too many runs.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } });

  const supabase = createServiceClient();
  const deps = { supabase, now: () => new Date(), log };
  const started = Date.now();
  const config = getPaymentsConfig();
  const provider = createMyFatoorahClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  let invoiceJobs: InvoiceJobsSummary = { scanned: 0, queued: 0, exceptions: 0, retried: 0, skipped: 0, budgetHit: false };
  let jobsError: string | null = null;
  try {
    invoiceJobs = await runOrderInvoiceJobs({ supabase, provider, now: () => new Date(), log, siteUrl: siteUrl() }, { limit: 10, budgetMs: 20_000 });
  } catch (err) {
    jobsError = err instanceof Error ? err.message : String(err);
    log.error("orders.invoice_jobs_failed", { error: jobsError });
  }

  const replay = await replayUnmatchedEvents(deps);
  let reconcile: { enabled: boolean; scanned: number; changed: number } = { enabled: false, scanned: 0, changed: 0 };
  let ordersReconcile: { enabled: boolean; scanned: number; changed: number } = { enabled: false, scanned: 0, changed: 0 };
  if (process.env.PAYMENTS_RECONCILE_ENABLED === "1" && Date.now() - started < 40_000) {
    const r = await reconcilePendingBookings(provider, deps, { olderThanMinutes: 10, limit: 25 });
    reconcile = { enabled: true, scanned: r.scanned, changed: r.changed };
    const o = await reconcilePendingOrders(provider, deps, { olderThanMinutes: 10, limit: 25 });
    ordersReconcile = { enabled: true, scanned: o.scanned, changed: o.changed };
  }

  let queue: QueueStats | null = null;
  try {
    queue = await orderInvoiceQueueStats(supabase);
  } catch (err) {
    log.warn("orders.queue_stats_failed", { error: err instanceof Error ? err.message : String(err) });
  }
  const durationMs = Date.now() - started;
  const body = { ok: !jobsError, invoiceJobs, jobsError, replay, reconcile, ordersReconcile, queue, durationMs, checkedAt: new Date().toISOString() };
  log.info("payments.confirmation_job", { ...body, queue: queue ?? undefined });
  try {
    await recordJobHeartbeat(supabase, JOB_NAMES.payments, !jobsError, { invoiceJobs: invoiceJobs as unknown as Record<string, number | boolean>, replay, reconcile, ordersReconcile, queue: queue as unknown as Record<string, number | string | null>, durationMs });
  } catch (err) {
    log.warn("payments.heartbeat_failed", { error: err instanceof Error ? err.message : String(err) });
  }
  return NextResponse.json(body, { headers });
}
