import { NextResponse } from "next/server";
import { requestLogger } from "@/lib/log";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/lib/types";
import { parseWatchRequest } from "@/lib/validation";
import { refreshAthletes } from "@/lib/watch-service";
import { watchUrl } from "@/lib/watchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Athletes attempted this recently are returned from the database instead of re-fetched. */
const USER_COOLDOWN_SECONDS = 8;

/**
 * POST /api/watch
 *
 * Mode A — preview a URL (no persistence):
 *   { url, athleteName?, timezone?, eventDate? }  -> WatchResult
 *
 * Mode B — refresh & persist tracked athletes:
 *   { athleteIds: [...] } or { eventId }           -> { results: RefreshResult[] }
 *
 * Always requires a signed-in user; RLS scopes every read/write to the owner.
 * Malformed bodies get a 400 with a `code`; abusive volume gets a 429.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/watch");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }
  const parsed = parseWatchRequest(raw);
  if (!parsed.ok) {
    log.info("watch.rejected", { code: parsed.code });
    return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400, headers });
  }

  const limit = rateLimit(`${parsed.mode === "preview" ? "preview" : "watch"}:${user.id}`, parsed.mode === "preview" ? RULES.previewPerUser : RULES.watchPerUser);
  if (!limit.ok) {
    log.warn("watch.rate_limited", { mode: parsed.mode, retryAfter: limit.retryAfterSeconds });
    return NextResponse.json(
      { error: `Too many refreshes. Try again in ${limit.retryAfterSeconds}s.`, code: "RATE_LIMITED", retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } },
    );
  }

  if (parsed.mode === "preview") {
    const result = await watchUrl(parsed.url, { athleteName: parsed.athleteName, timezone: parsed.timezone, eventDate: parsed.eventDate, log });
    return NextResponse.json(result, { headers: { ...headers, ...rateLimitHeaders(limit) } });
  }

  let query = supabase.from("photo_athletes").select("*").eq("active", true);
  query = parsed.mode === "athletes" ? query.in("id", parsed.athleteIds) : query.eq("event_id", parsed.eventId).limit(60);

  const { data: athletes, error } = await query;
  if (error) {
    log.error("watch.query_failed", { error: error.message });
    return NextResponse.json({ error: "Could not load clients.", code: "QUERY_FAILED" }, { status: 500, headers });
  }
  if (!athletes?.length) return NextResponse.json({ results: [], checkedAt: new Date().toISOString() }, { headers });

  const eventIds = [...new Set(athletes.map((a) => a.event_id).filter((v): v is string => Boolean(v)))];
  const events = new Map<string, EventRow>();
  if (eventIds.length) {
    const { data: eventRows } = await supabase.from("photo_events").select("*").in("id", eventIds);
    for (const e of eventRows ?? []) events.set(e.id, e);
  }

  const started = Date.now();
  const results = await refreshAthletes(supabase, athletes, events, { cooldownSeconds: USER_COOLDOWN_SECONDS, log });
  log.info("watch.batch", {
    mode: parsed.mode,
    athletes: athletes.length,
    durationMs: Date.now() - started,
    statuses: results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {}),
    skipped: results.filter((r) => r.skipped).length,
    changes: results.reduce((n, r) => n + r.changes.length, 0),
  });
  return NextResponse.json({ results, checkedAt: new Date().toISOString() }, { headers: { ...headers, ...rateLimitHeaders(limit) } });
}

/** GET /api/watch?url=... — convenience preview for manual testing. */
export async function GET(request: Request) {
  const { log, requestId } = requestLogger(request, "api/watch");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });

  const { searchParams } = new URL(request.url);
  const parsed = parseWatchRequest({
    url: searchParams.get("url") ?? "",
    athleteName: searchParams.get("athleteName") ?? undefined,
    timezone: searchParams.get("timezone") ?? undefined,
    eventDate: searchParams.get("eventDate") ?? undefined,
  });
  if (!parsed.ok || parsed.mode !== "preview") {
    return NextResponse.json({ error: parsed.ok ? "url is required" : parsed.error, code: parsed.ok ? "INVALID_URL" : parsed.code }, { status: 400, headers });
  }
  const limit = rateLimit(`preview:${user.id}`, RULES.previewPerUser);
  if (!limit.ok) return NextResponse.json({ error: "Too many previews.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } });
  const result = await watchUrl(parsed.url, { athleteName: parsed.athleteName, timezone: parsed.timezone, eventDate: parsed.eventDate, log });
  return NextResponse.json(result, { headers });
}
