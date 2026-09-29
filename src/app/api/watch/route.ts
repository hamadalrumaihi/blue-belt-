import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/lib/types";
import { refreshAthletes } from "@/lib/watch-service";
import { watchUrl } from "@/lib/watchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 60;

type Body =
  | { url: string; athleteName?: string; timezone?: string; eventDate?: string }
  | { athleteIds: string[] }
  | { eventId: string };

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
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if ("url" in body) {
    const result = await watchUrl(body.url, {
      athleteName: body.athleteName ?? null,
      timezone: body.timezone ?? null,
      eventDate: body.eventDate ?? null,
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  }

  let query = supabase.from("photo_athletes").select("*").eq("active", true);
  if ("athleteIds" in body) {
    if (!Array.isArray(body.athleteIds) || !body.athleteIds.length) {
      return NextResponse.json({ error: "athleteIds must be a non-empty array" }, { status: 400 });
    }
    query = query.in("id", body.athleteIds.slice(0, MAX_BATCH));
  } else if ("eventId" in body && typeof body.eventId === "string") {
    query = query.eq("event_id", body.eventId).limit(MAX_BATCH);
  } else {
    return NextResponse.json({ error: "Provide url, athleteIds or eventId" }, { status: 400 });
  }

  const { data: athletes, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!athletes?.length) return NextResponse.json({ results: [] });

  const eventIds = [...new Set(athletes.map((a) => a.event_id).filter((v): v is string => Boolean(v)))];
  const events = new Map<string, EventRow>();
  if (eventIds.length) {
    const { data: eventRows } = await supabase.from("photo_events").select("*").in("id", eventIds);
    for (const e of eventRows ?? []) events.set(e.id, e);
  }

  const results = await refreshAthletes(supabase, athletes, events);
  return NextResponse.json({ results, checkedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}

/** GET /api/watch?url=... — convenience preview for manual testing. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const result = await watchUrl(searchParams.get("url"), {
    athleteName: searchParams.get("athleteName"),
    timezone: searchParams.get("timezone"),
    eventDate: searchParams.get("eventDate"),
  });
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
