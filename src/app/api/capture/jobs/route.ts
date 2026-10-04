import { NextResponse } from "next/server";
import { inCredentialScope } from "@/lib/capture/credentials";
import { authenticateIntake } from "@/lib/capture/intake";
import { sourceKey } from "@/lib/capture/source-identity";
import { isEventDay } from "@/lib/cron";
import { requestLogger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Agents refresh each source at most this often (the server's view; the agent may be slower). */
const AGENT_INTERVAL_SECONDS = 60;
const MAX_JOBS = 40;

/**
 * GET /api/capture/jobs  (Authorization: Bearer bbmc_…)
 *
 * The distinct sources this credential's owner needs captured right now:
 * active clients of active events happening today (±1 day in the event's
 * timezone), narrowed by the credential's event / source scope. Returns one
 * job per source identity with the URL to open and the client count, so the
 * agent needs no local configuration beyond the app URL and its token.
 */
export async function GET(request: Request) {
  const { log, requestId } = requestLogger(request, "api/capture/jobs");
  const auth = await authenticateIntake(request, "api/capture/jobs", requestId, log);
  if (!auth.ok) return auth.response;
  const { supabase, credential, headers, now } = auth.ctx;

  let eventsQuery = supabase.from("photo_events").select("*").eq("owner_id", credential.owner_id).eq("active", true);
  if (credential.scope_event_id) eventsQuery = eventsQuery.eq("id", credential.scope_event_id);
  const { data: events, error: eventsError } = await eventsQuery;
  if (eventsError) return NextResponse.json({ error: "Could not load events.", code: "QUERY_FAILED" }, { status: 500, headers });
  const due = (events ?? []).filter((e) => isEventDay(e, now));
  if (!due.length) return NextResponse.json({ jobs: [], intervalSeconds: AGENT_INTERVAL_SECONDS, reason: "no events today", checkedAt: now.toISOString() }, { headers });

  const { data: athletes, error } = await supabase
    .from("photo_athletes")
    .select("id,event_id,source_url,name")
    .eq("owner_id", credential.owner_id)
    .eq("active", true)
    .not("source_url", "is", null)
    .in("event_id", due.map((e) => e.id))
    .limit(500);
  if (error) return NextResponse.json({ error: "Could not load clients.", code: "QUERY_FAILED" }, { status: 500, headers });

  const jobs = new Map<string, { sourceKey: string; url: string; eventId: string | null; eventName: string | null; clients: number }>();
  for (const a of athletes ?? []) {
    const key = sourceKey(a.source_url);
    if (!key || !inCredentialScope(credential, key)) continue;
    const existing = jobs.get(key);
    if (existing) {
      existing.clients += 1;
      continue;
    }
    const event = due.find((e) => e.id === a.event_id);
    jobs.set(key, { sourceKey: key, url: a.source_url as string, eventId: a.event_id, eventName: event?.name ?? null, clients: 1 });
  }
  const list = [...jobs.values()].slice(0, MAX_JOBS);
  auth.ctx.log.info("capture.jobs", { jobs: list.length, events: due.length });
  return NextResponse.json({ jobs: list, intervalSeconds: AGENT_INTERVAL_SECONDS, truncated: jobs.size > MAX_JOBS, checkedAt: now.toISOString() }, { headers });
}
