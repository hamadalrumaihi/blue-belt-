import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { requestLogger } from "@/lib/log";
import { cleanupAbandonedUploads } from "@/lib/media/cleanup";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/media/cleanup   (Authorization: Bearer <CRON_SECRET>)
 *
 * Removes abandoned uploads: `draft` rows (and their private-bucket objects)
 * older than `hours` (query string, default 24). Nothing that ever reached
 * `processing` or beyond is touched. Scheduled from the same worker that
 * ticks the other cron routes; safe to run often.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/media/cleanup");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!verifyCronSecret(request)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });
  if (!isServiceClientConfigured()) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  const hoursParam = Number(new URL(request.url).searchParams.get("hours"));
  const hours = Number.isFinite(hoursParam) && hoursParam >= 1 ? Math.min(hoursParam, 24 * 30) : 24;
  const result = await cleanupAbandonedUploads(createServiceClient(), hours);
  log.info("media.cleanup", { ...result, hours });
  return NextResponse.json({ ok: result.errors.length === 0, hours, ...result }, { headers });
}
