import { verifyCronSecret } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { requestLogger } from "@/lib/log";
import { getPaymentsConfig, isPaymentsEnabled } from "@/lib/payments/config";
import { createMyFatoorahClient } from "@/lib/payments/myfatoorah/client";
import { reconcilePendingBookings, replayUnmatchedEvents } from "@/lib/payments/myfatoorah/webhook";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/cron/payments   (Authorization: Bearer <CRON_SECRET>)
 *
 * The payment confirmation job. Dark (404) unless PAYMENTS_MYFATOORAH_ENABLED
 * and both secrets are set. Two bounded steps:
 *   1. replay verified webhook events that arrived before their booking
 *      existed (no provider call);
 *   2. only with PAYMENTS_RECONCILE_ENABLED=1: ask MyFatoorah
 *      (GetPaymentStatus) about bookings still pending / failed 10+ minutes
 *      after creation — the "rely on both the webhook and GetPaymentStatus"
 *      check. Off by default so no production calls happen before activation.
 * Paid transitions enqueue the owner's [Orders] confirmation atomically; the
 * independent delivery runner sends it.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/cron/payments");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!isPaymentsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  if (!verifyCronSecret(request)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });
  if (!isServiceClientConfigured()) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  const limit = rateLimit("cron-payments", RULES.cron);
  if (!limit.ok) return NextResponse.json({ error: "Too many runs.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } });

  const deps = { supabase: createServiceClient(), now: () => new Date(), log };
  const started = Date.now();
  const replay = await replayUnmatchedEvents(deps);
  let reconcile: { enabled: boolean; scanned: number; changed: number } = { enabled: false, scanned: 0, changed: 0 };
  if (process.env.PAYMENTS_RECONCILE_ENABLED === "1") {
    const config = getPaymentsConfig();
    const provider = createMyFatoorahClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    const r = await reconcilePendingBookings(provider, deps, { olderThanMinutes: 10, limit: 25 });
    reconcile = { enabled: true, scanned: r.scanned, changed: r.changed };
  }
  log.info("payments.confirmation_job", { replay, reconcile, durationMs: Date.now() - started });
  return NextResponse.json({ ok: true, replay, reconcile, durationMs: Date.now() - started, checkedAt: new Date().toISOString() }, { headers });
}

