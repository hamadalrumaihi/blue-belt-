import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requestLogger } from "@/lib/log";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import { isEventDay } from "@/lib/cron";
import type { AthleteRow, EventRow } from "@/lib/types";
import { parseCronRequest } from "@/lib/validation";
import { refreshAthletes } from "@/lib/watch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Leave headroom under maxDuration so the response is always written. */
const TIME_BUDGET_MS = 240_000;

/**
 * POST /api/cron/refresh
 *
 * Scheduled refresh with no user session: refreshes active athletes of every
 * active event happening today (±1 day in the event's timezone), for all
 * owners, one page at a time. Called by the worker's scheduler (or any cron)
 * with `Authorization: Bearer <CRON_SECRET>`. Requires SUPABASE_SERVICE_ROLE_KEY.
 *
 * Body (optional):
 *   { all?: boolean, limit?: number, cursor?: athleteId, cooldownSeconds?: number }
 *
 * Athletes are ordered by (last_attempt_at nulls first, id) so each call
 * takes the stalest page; the response reports eligible / processed /
 * failed / skipped / remaining counts and the cursor for the next page.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/cron/refresh");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };

  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });
  if (!isServiceClientConfigured()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured; scheduled refresh is disabled.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  }
  const limit = rateLimit("cron", RULES.cron);
  if (!limit.ok) return NextResponse.json({ error: "Too many scheduled refreshes.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } });

  let raw: unknown = null;
  const text = await request.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON.", code: "INVALID_JSON" }, { status: 400, headers });
    }
  }
  const parsed = parseCronRequest(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400, headers });

  const supabase = createServiceClient();
  const now = new Date();
  const started = Date.now();

  const { data: events, error: eventsError } = await supabase.from("photo_events").select("*").eq("active", true);
  if (eventsError) {
    log.error("cron.events_failed", { error: eventsError.message });
    return NextResponse.json({ error: "Could not load events.", code: "QUERY_FAILED" }, { status: 500, headers });
  }
  const dueEvents = (events ?? []).filter((e) => parsed.all || isEventDay(e, now));
  const empty = { eligible: 0, processed: 0, failed: 0, skipped: 0, remaining: 0, changes: 0, cursor: null as string | null, events: dueEvents.length, checkedAt: now.toISOString() };
  if (!dueEvents.length) return NextResponse.json({ ...empty, reason: "no events today" }, { headers });

  const eventMap = new Map<string, EventRow>(dueEvents.map((e) => [e.id, e]));
  const eventIds = [...eventMap.keys()];

  // Eligible population and the page to process.
  const { count: eligible, error: countError } = await supabase
    .from("photo_athletes")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .not("source_url", "is", null)
    .in("event_id", eventIds);
  if (countError) {
    log.error("cron.count_failed", { error: countError.message });
    return NextResponse.json({ error: "Could not count clients.", code: "QUERY_FAILED" }, { status: 500, headers });
  }

  const page = await loadPage(supabase, eventIds, parsed.limit, parsed.cursor);
  if (!page.ok) {
    log.error("cron.page_failed", { error: page.error });
    return NextResponse.json({ error: "Could not load clients.", code: "QUERY_FAILED" }, { status: 500, headers });
  }
  if (!page.athletes.length) return NextResponse.json({ ...empty, eligible: eligible ?? 0 }, { headers });

  // Process in sub-batches so the time budget is respected even when the
  // browser worker is slow; whatever is left is reported as remaining.
  const processedResults = [];
  let index = 0;
  const SUB_BATCH = 6;
  while (index < page.athletes.length && Date.now() - started < TIME_BUDGET_MS) {
    const slice = page.athletes.slice(index, index + SUB_BATCH);
    processedResults.push(...(await refreshAthletes(supabase, slice, eventMap, { cooldownSeconds: parsed.cooldownSeconds, log, now })));
    index += slice.length;
  }

  const processed = processedResults.filter((r) => !r.skipped).length;
  const skipped = processedResults.filter((r) => r.skipped).length;
  const failed = processedResults.filter((r) => !r.skipped && (r.status === "ERROR" || r.status === "FETCH_ERROR" || r.status === "PARSE_ERROR" || r.status === "REQUIRES_BROWSER_WATCHER")).length;
  const changes = processedResults.reduce((n, r) => n + r.changes.length, 0);
  const statuses = processedResults.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const lastProcessed = page.athletes[index - 1]?.id ?? parsed.cursor;
  const unprocessedInPage = page.athletes.length - index;
  const remaining = Math.max(0, (eligible ?? 0) - page.offset - index);
  const cursor = remaining > 0 ? lastProcessed : null;

  log.info("cron.batch", { events: dueEvents.length, eligible, processed, failed, skipped, remaining, unprocessedInPage, changes, durationMs: Date.now() - started, statuses });
  return NextResponse.json(
    { eligible: eligible ?? 0, processed, failed, skipped, remaining, unprocessedInPage, changes, statuses, cursor, events: dueEvents.length, durationMs: Date.now() - started, checkedAt: now.toISOString() },
    { headers },
  );
}

type Page = { ok: true; athletes: AthleteRow[]; offset: number } | { ok: false; error: string };

/**
 * Keyset page over eligible athletes ordered by (last_attempt_at nulls first,
 * id). `cursor` is the last athlete id of the previous page; the page starts
 * after it in that order.
 */
async function loadPage(supabase: ReturnType<typeof createServiceClient>, eventIds: string[], limit: number, cursor: string | null): Promise<Page> {
  const base = () => supabase.from("photo_athletes").select("*").eq("active", true).not("source_url", "is", null).in("event_id", eventIds);
  let offset = 0;
  if (cursor) {
    // Resolve the cursor's position in the ordering (rank-based keyset: tolerant of
    // last_attempt_at moving between calls because rows are ordered by attempt time).
    const { data: anchor } = await base().eq("id", cursor).maybeSingle();
    if (anchor) {
      const anchorTime = anchor.last_attempt_at;
      const { count } = anchorTime
        ? await supabase
            .from("photo_athletes")
            .select("id", { count: "exact", head: true })
            .eq("active", true)
            .not("source_url", "is", null)
            .in("event_id", eventIds)
            .or(`last_attempt_at.is.null,last_attempt_at.lt.${anchorTime},and(last_attempt_at.eq.${anchorTime},id.lte.${cursor})`)
        : await supabase
            .from("photo_athletes")
            .select("id", { count: "exact", head: true })
            .eq("active", true)
            .not("source_url", "is", null)
            .in("event_id", eventIds)
            .is("last_attempt_at", null)
            .lte("id", cursor);
      offset = count ?? 0;
    }
  }
  const { data, error } = await base()
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return { ok: false, error: error.message };
  return { ok: true, athletes: data ?? [], offset };
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}
