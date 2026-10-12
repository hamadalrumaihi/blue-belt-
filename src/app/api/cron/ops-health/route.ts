import { verifyCronSecret } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { JOB_NAMES, recordJobHeartbeat } from "@/lib/jobs/heartbeat";
import { requestLogger } from "@/lib/log";
import { runIntakeSilenceCheck, silenceThresholdHours } from "@/lib/ops/intake-silence";
import { isOrdersIntakeEnabled } from "@/lib/orders/config";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/studio/queries";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/cron/ops-health   (Authorization: Bearer <CRON_SECRET>)
 *
 * Operational self-checks that only queue [System] Telegram alerts (deduped
 * per condition, delivered by the independent runner). Today: is the Pic-Time
 * order intake silent (src/lib/ops/intake-silence.ts, docs/ops.md)? A no-op
 * while ORDERS_INTAKE_ENABLED is off. Ticked by the Railway worker every
 * OPS_HEALTH_SECONDS (default 900 when its scheduler is on).
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/cron/ops-health");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!verifyCronSecret(request)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });
  if (!isServiceClientConfigured()) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  const limit = rateLimit("cron-ops-health", RULES.cron);
  if (!limit.ok) return NextResponse.json({ error: "Too many runs.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } });
  const now = new Date();
  if (!isOrdersIntakeEnabled()) return NextResponse.json({ ok: true, intake: { enabled: false }, checkedAt: now.toISOString() }, { headers });

  const supabase = createServiceClient();
  const thresholdHours = silenceThresholdHours();
  try {
    const intake = await runIntakeSilenceCheck({ supabase, now, site: siteUrl(), thresholdHours });
    log.info("ops.intake_checked", { ...intake, thresholdHours });
    try {
      await recordJobHeartbeat(supabase, JOB_NAMES.ops, true, { intake, thresholdHours }, now);
    } catch (err) {
      log.warn("ops.heartbeat_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    return NextResponse.json({ ok: true, intake: { enabled: true, thresholdHours, ...intake }, checkedAt: now.toISOString() }, { headers });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("ops.intake_failed", { error });
    return NextResponse.json({ ok: false, code: "CHECK_FAILED", checkedAt: now.toISOString() }, { status: 500, headers });
  }
}
