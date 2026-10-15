import { verifyCronSecret } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { JOB_NAMES, recordJobHeartbeat } from "@/lib/jobs/heartbeat";
import { requestLogger } from "@/lib/log";
import { computeAssessmentRow, loadAssessmentSource, requestFor } from "@/lib/pricing/compute";
import { pricingRequestFromJson } from "@/lib/pricing/engine/extract";
import { researchStatus, summariseStaleReferences } from "@/lib/pricing/research";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 30_000;
const BATCH = 10;

/**
 * POST /api/cron/pricing   (Authorization: Bearer <CRON_SECRET>)
 *
 * The pricing job. Processes assessments still `queued` (a submission whose
 * synchronous compute failed, or one queued by the owner) with the service
 * client, one bounded batch per call. Market research runs only when
 * PRICING_RESEARCH_ENABLED=1 AND a research provider is configured; nothing
 * is configured in production, so the response says `research.status:
 * "not_configured"` (or "disabled") honestly and only COUNTS the evidence
 * that needs re-verification by hand. Owner-only data never leaves this
 * route: the response carries counts, never prices.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/cron/pricing");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!verifyCronSecret(request)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });
  if (!isServiceClientConfigured()) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  const limit = rateLimit("cron-pricing", RULES.cron);
  if (!limit.ok) return NextResponse.json({ error: "Too many runs.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } });

  const supabase = createServiceClient();
  const started = Date.now();
  const now = new Date();
  const processed = { scanned: 0, ready: 0, needs_detail: 0, failed: 0, skipped: 0 };

  const { data: queued, error: queueError } = await supabase.from("photo_pricing_assessments").select("id,owner_id,booking_id,lead_id,request_snapshot").eq("status", "queued").order("created_at", { ascending: true }).limit(BATCH);
  if (queueError) log.warn("pricing.queue_read_failed", { error: queueError.message });
  for (const row of queued ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      processed.skipped += 1;
      continue;
    }
    processed.scanned += 1;
    try {
      const loaded = await loadAssessmentSource(supabase, { ownerId: row.owner_id, bookingId: row.booking_id, leadId: row.lead_id });
      if (!loaded) throw new Error("Booking or lead no longer exists.");
      const req = pricingRequestFromJson(row.request_snapshot) ?? requestFor(loaded, now);
      const { status } = await computeAssessmentRow(supabase, row, req, now);
      processed[status] += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      processed.failed += 1;
      await supabase.from("photo_pricing_assessments").update({ status: "failed", error: message }).eq("id", row.id);
      log.warn("pricing.assessment_failed", { assessmentId: row.id, error: message });
    }
  }

  const research = researchStatus();
  let stale: Awaited<ReturnType<typeof summariseStaleReferences>> | null = null;
  try {
    stale = await summariseStaleReferences(supabase, now);
  } catch (err) {
    log.warn("pricing.stale_summary_failed", { error: err instanceof Error ? err.message : String(err) });
  }
  // A configured provider would refresh stale references here. None is registered in this build.
  const refreshed = 0;

  const durationMs = Date.now() - started;
  log.info("pricing.run", { ...processed, research: research.status, stale: stale?.needsReverification ?? null, refreshed, durationMs });
  try {
    // Counts and statuses only: never a price.
    await recordJobHeartbeat(supabase, JOB_NAMES.pricing, processed.failed === 0, { scanned: processed.scanned, ready: processed.ready, needs_detail: processed.needs_detail, failed: processed.failed, research: research.status, durationMs }, now);
  } catch (err) {
    log.warn("pricing.heartbeat_failed", { error: err instanceof Error ? err.message : String(err) });
  }
  return NextResponse.json({ ok: true, processed, research: { status: research.status, reason: research.reason, provider: research.provider, refreshed }, stale, durationMs, checkedAt: now.toISOString() }, { headers });
}
