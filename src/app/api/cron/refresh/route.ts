import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import { dateInZone } from "@/lib/time";
import type { EventRow } from "@/lib/types";
import { refreshAthletes } from "@/lib/watch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ATHLETES = 80;

/**
 * POST /api/cron/refresh
 *
 * Scheduled refresh with no user session: refreshes every active athlete of
 * every active event happening today (±1 day in the event's timezone), for
 * all owners. Called by the worker's scheduler (or any cron) with
 * `Authorization: Bearer <CRON_SECRET>`. Requires SUPABASE_SERVICE_ROLE_KEY.
 *
 * Body (optional): { "all": true } refreshes every active event regardless of date.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isServiceClientConfigured()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured; scheduled refresh is disabled." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { all?: boolean };
  const supabase = createServiceClient();

  const { data: events, error: eventsError } = await supabase.from("photo_events").select("*").eq("active", true);
  if (eventsError) return NextResponse.json({ error: eventsError.message }, { status: 500 });

  const now = new Date();
  const dueEvents = (events ?? []).filter((e) => body.all || isEventDay(e, now));
  if (!dueEvents.length) return NextResponse.json({ refreshed: 0, events: 0, skipped: "no events today" });

  const eventMap = new Map<string, EventRow>(dueEvents.map((e) => [e.id, e]));
  const { data: athletes, error: athletesError } = await supabase
    .from("photo_athletes")
    .select("*")
    .eq("active", true)
    .not("source_url", "is", null)
    .in("event_id", [...eventMap.keys()])
    .limit(MAX_ATHLETES);
  if (athletesError) return NextResponse.json({ error: athletesError.message }, { status: 500 });
  if (!athletes?.length) return NextResponse.json({ refreshed: 0, events: dueEvents.length });

  const results = await refreshAthletes(supabase, athletes, eventMap);
  const summary = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const changes = results.reduce((n, r) => n + r.changes.length, 0);
  return NextResponse.json({ refreshed: results.length, events: dueEvents.length, changes, statuses: summary, checkedAt: now.toISOString() });
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

/** True when `now` falls on the event date ±1 day in the event's timezone. */
function isEventDay(event: EventRow, now: Date): boolean {
  if (!event.event_date) return false;
  const [y, m, d] = event.event_date.split("-").map(Number);
  const eventUtc = Date.UTC(y, m - 1, d);
  const { year, month, day } = dateInZone(now, event.timezone || "Asia/Qatar");
  const todayUtc = Date.UTC(year, month - 1, day);
  return Math.abs(todayUtc - eventUtc) <= 24 * 60 * 60 * 1000;
}
