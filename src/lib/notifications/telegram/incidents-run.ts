import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RefreshNotificationContext } from "@/lib/notifications/server";
import { buildIncidentDrafts, incidentRef, recoveryText, type IncidentDraft } from "@/lib/notifications/incidents";
import type { Database } from "@/lib/supabase/database.types";
import { deliveryInsert } from "../delivery-runner";

type Client = SupabaseClient<Database>;

/**
 * Enqueues operational-incident and recovery messages into the Telegram
 * delivery table (the shared sender in notifier.ts flushes them). Dedup is by
 * the delivery alert_key, which carries the incident's cycle start
 * (first_seen_at): an open incident notifies once, and the same problem coming
 * back after a recovery opens a new cycle and notifies again. A recovery is
 * sent when a previously-open incident clears. State lives in photo_incidents
 * (one row per owner + key, reopened in place).
 *
 * This never sends directly and never throws into the refresh: notifyAfterRefresh
 * wraps it, and runTelegramNotifier (called right after) does the sending.
 */
export async function runIncidentNotifier(ctx: RefreshNotificationContext): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? "";
  const drafts = buildIncidentDrafts(
    { athletes: ctx.athletes.map((a) => ({ id: a.id, owner_id: a.owner_id, event_id: a.event_id, name: a.name, last_success_at: a.last_success_at })), events: ctx.events, results: ctx.results },
    appUrl,
  );
  const now = ctx.now.toISOString();

  const okByOwner = new Map<string, Set<string>>(); // owner -> set of event_id with an OK result this run
  for (const r of ctx.results) {
    if (r.status !== "OK") continue;
    const a = ctx.athletes.find((x) => x.id === r.athleteId);
    if (!a) continue;
    const set = okByOwner.get(a.owner_id) ?? new Set<string>();
    set.add(a.event_id ?? "none");
    okByOwner.set(a.owner_id, set);
  }

  const draftsByOwner = new Map<string, IncidentDraft[]>();
  for (const d of drafts) {
    const list = draftsByOwner.get(d.ownerId) ?? [];
    list.push(d);
    draftsByOwner.set(d.ownerId, list);
  }

  const owners = new Set<string>([...draftsByOwner.keys(), ...okByOwner.keys()]);
  for (const ownerId of owners) {
    try {
      await processOwnerIncidents(ctx.supabase, ownerId, draftsByOwner.get(ownerId) ?? [], okByOwner.get(ownerId) ?? new Set(), now, ctx.events);
    } catch (err) {
      ctx.log.warn("incident.owner_failed", { ownerId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

async function processOwnerIncidents(
  supabase: Client,
  ownerId: string,
  drafts: IncidentDraft[],
  okEvents: Set<string>,
  now: string,
  events: RefreshNotificationContext["events"],
): Promise<void> {
  const { data: open } = await supabase.from("photo_incidents").select("*").eq("owner_id", ownerId).eq("status", "open");
  const openRows = open ?? [];
  const draftKeys = new Set(drafts.map((d) => d.key));
  // A key is unique per owner, so a problem that comes back after a recovery
  // must reopen its resolved row rather than insert a second one.
  const { data: known } = draftKeys.size
    ? await supabase.from("photo_incidents").select("*").eq("owner_id", ownerId).in("incident_key", [...draftKeys])
    : { data: [] };
  const knownRows = known ?? [];

  const deliveries: Database["public"]["Tables"]["photo_notification_deliveries"]["Insert"][] = [];

  // Open, reopen or refresh each current incident, and notify once per cycle.
  for (const d of drafts) {
    const existing = knownRows.find((r) => r.incident_key === d.key) ?? openRows.find((r) => r.incident_key === d.key);
    let cycleStart = now;
    if (existing?.status === "open") {
      cycleStart = existing.first_seen_at;
      await supabase.from("photo_incidents").update({ last_seen_at: now, occurrences: (existing.occurrences ?? 1) + 1, athlete_count: d.athleteIds.length, updated_at: now }).eq("id", existing.id);
    } else if (existing) {
      await supabase.from("photo_incidents").update({ status: "open", resolved_at: null, first_seen_at: now, last_seen_at: now, occurrences: 1, athlete_count: d.athleteIds.length, updated_at: now }).eq("id", existing.id);
    } else {
      await supabase.from("photo_incidents").insert({ owner_id: ownerId, incident_key: d.key, kind: d.kind, event_id: d.eventId, source_host: d.sourceHost, athlete_count: d.athleteIds.length, status: "open", first_seen_at: now, last_seen_at: now, occurrences: 1 });
    }
    deliveries.push(deliveryInsert({ ownerId, alertKey: incidentAlertKey(d.key, cycleStart), kind: `INCIDENT_${d.kind}`, text: d.text, category: "system", now: new Date(now) }));
  }

  // Resolve open incidents that are no longer failing and whose event saw an OK read.
  for (const r of openRows) {
    if (draftKeys.has(r.incident_key)) continue;
    const scopeKey = r.event_id ?? "none";
    if (!okEvents.has(scopeKey)) continue;
    await supabase.from("photo_incidents").update({ status: "resolved", resolved_at: now, updated_at: now }).eq("id", r.id);
    const kind = r.kind as IncidentDraft["kind"];
    const eventName = r.event_id ? events.get(r.event_id)?.name ?? null : null;
    const text = recoveryText({ kind, eventName, count: r.athlete_count ?? 1, ref: incidentRef(r.incident_key) });
    deliveries.push(deliveryInsert({ ownerId, alertKey: `recovery:${r.incident_key}:${r.last_seen_at}`, kind: `RECOVERY_${kind}`, text, category: "system", now: new Date(now) }));
  }

  if (deliveries.length) {
    await supabase.from("photo_notification_deliveries").upsert(deliveries, { onConflict: "owner_id,channel,alert_key", ignoreDuplicates: true });
  }
}

/** One alert per incident cycle; the timestamp is normalised so DB round-trips match. */
export function incidentAlertKey(incidentKey: string, cycleStart: string): string {
  const t = new Date(cycleStart);
  return `incident:${incidentKey}:${Number.isNaN(t.getTime()) ? cycleStart : t.toISOString()}`;
}
