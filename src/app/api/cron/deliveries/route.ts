import { verifyCronSecret } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { requestLogger } from "@/lib/log";
import { runDeliveryBatch, type DeliveryBatchSummary } from "@/lib/notifications/delivery-runner";
import { isEmailEnabled } from "@/lib/notifications/email/config";
import { runEmailBatch, type EmailBatchSummary } from "@/lib/notifications/email/outbox";
import { enqueueReminders } from "@/lib/notifications/reminders-run";
import { isTelegramEnabled } from "@/lib/notifications/telegram/config";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Headroom under maxDuration so the response is always written. */
const TIME_BUDGET_MS = 45_000;
const BATCH = 25;
const MAX_BATCHES = 8;

/**
 * POST /api/cron/deliveries   (Authorization: Bearer <CRON_SECRET>)
 *
 * The independent notification runner: plans clock-driven pre-match
 * reminders, then drains due Telegram deliveries (owner) and e-mail
 * deliveries (clients) in bounded, lease-claimed batches until nothing is
 * due or the time budget is spent. Each channel runs only when its own
 * flag is on; queued rows for an off channel wait. Ticked by the
 * Railway process every DELIVERY_SECONDS (see worker/src/scheduler.mjs); safe
 * to run from any cron, and safe to run twice at once (SKIP LOCKED claims).
 * No setInterval lives in any request module.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/cron/deliveries");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!verifyCronSecret(request)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });
  if (!isServiceClientConfigured()) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  const limit = rateLimit("cron-deliveries", RULES.cron);
  if (!limit.ok) return NextResponse.json({ error: "Too many runs.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } });
  const telegram = isTelegramEnabled();
  const email = isEmailEnabled();
  if (!telegram && !email) return NextResponse.json({ ok: true, enabled: false, reason: "telegram and email disabled", checkedAt: new Date().toISOString() }, { headers });

  const supabase = createServiceClient();
  const started = Date.now();
  const now = new Date();
  let reminders = { owners: 0, planned: 0 };
  if (telegram) {
    try {
      reminders = await enqueueReminders({ supabase, now, log });
    } catch (err) {
      log.warn("reminders.failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const totals: DeliveryBatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, released: 0, stoppedEarly: false };
  let batches = 0;
  while (telegram && batches < MAX_BATCHES && Date.now() - started < TIME_BUDGET_MS) {
    const s = await runDeliveryBatch({ supabase, now: new Date(), log, limit: BATCH, worker: `cron:${requestId.slice(0, 8)}` });
    batches += 1;
    for (const k of ["claimed", "sent", "retried", "failed", "skipped", "released"] as const) totals[k] += s[k];
    if (s.stoppedEarly || s.claimed < BATCH) break;
  }

  const emails: EmailBatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0 };
  let emailBatches = 0;
  while (email && emailBatches < MAX_BATCHES && Date.now() - started < TIME_BUDGET_MS) {
    try {
      const s = await runEmailBatch({ supabase, now: new Date(), log, limit: BATCH, worker: `cron:${requestId.slice(0, 8)}` });
      emailBatches += 1;
      for (const k of ["claimed", "sent", "retried", "failed"] as const) emails[k] += s[k];
      if (s.claimed < BATCH) break;
    } catch (err) {
      log.warn("email.batch_failed", { error: err instanceof Error ? err.message : String(err) });
      break;
    }
  }
  log.info("deliveries.run", { ...totals, batches, reminders, emails, emailBatches, durationMs: Date.now() - started });
  return NextResponse.json({ ok: true, enabled: true, telegram, email, ...totals, batches, reminders, emails, durationMs: Date.now() - started, checkedAt: now.toISOString() }, { headers });
}

