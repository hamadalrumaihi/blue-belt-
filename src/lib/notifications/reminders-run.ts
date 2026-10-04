import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isEventDay } from "@/lib/cron";
import type { Logger } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";
import { deliveryInsert } from "./delivery-runner";
import { planReminders, reminderLeads, type ReminderCandidate } from "./reminders";
import { kindAllowed, resolveSubscription, TELEGRAM_CHANNEL, type SubscriptionLike } from "./telegram/core";

type Client = SupabaseClient<Database>;

/**
 * Clock-driven producer: enqueues 15/5-minute pre-match reminders for every
 * owner with an enabled Telegram link, from the matches already stored (no
 * capture needed). Dedupe is the (owner, channel, alert_key) unique index; the
 * key is per lead + match + 5-minute bucket of the target time. Bounded: one
 * query per table, at most 2 000 matches per pass.
 */
export async function enqueueReminders(input: { supabase: Client; now: Date; log: Logger; leads?: number[] }): Promise<{ owners: number; planned: number }> {
  const { supabase, now, log } = input;
  const leads = input.leads ?? reminderLeads(process.env.TELEGRAM_REMINDER_MINUTES);
  const { data: links } = await supabase.from("photo_telegram_links").select("owner_id").eq("enabled", true).not("chat_id", "is", null);
  const owners = [...new Set((links ?? []).map((l) => l.owner_id))];
  if (!owners.length) return { owners: 0, planned: 0 };

  const [{ data: subs }, { data: events }] = await Promise.all([
    supabase.from("photo_notification_subscriptions").select("owner_id,event_id,kinds,enabled").eq("channel", TELEGRAM_CHANNEL).in("owner_id", owners),
    supabase.from("photo_events").select("id,owner_id,event_date,timezone,active").eq("active", true).in("owner_id", owners),
  ]);
  const dueEvents = (events ?? []).filter((e) => isEventDay(e, now));
  if (!dueEvents.length) return { owners: owners.length, planned: 0 };
  const eventById = new Map(dueEvents.map((e) => [e.id, e]));

  const { data: athletes } = await supabase.from("photo_athletes").select("id,name,owner_id,event_id,active").eq("active", true).in("event_id", [...eventById.keys()]).limit(2000);
  const athleteById = new Map((athletes ?? []).map((a) => [a.id, a]));
  if (!athleteById.size) return { owners: owners.length, planned: 0 };

  const horizon = new Date(now.getTime() + (Math.max(...leads) + 5) * 60_000).toISOString();
  const { data: matches } = await supabase
    .from("photo_matches")
    .select("*")
    .in("athlete_id", [...athleteById.keys()])
    .in("status", ["scheduled", "delayed", "unknown"])
    .or(`scheduled_at.lte.${horizon},estimated_at.lte.${horizon},override_scheduled_at.lte.${horizon}`)
    .limit(2000);

  const candidates: ReminderCandidate[] = [];
  for (const m of matches ?? []) {
    const a = athleteById.get(m.athlete_id);
    if (!a) continue;
    const e = a.event_id ? eventById.get(a.event_id) : undefined;
    candidates.push({ match: m, athlete: { id: a.id, name: a.name, owner_id: a.owner_id, event_id: a.event_id }, timezone: e?.timezone ?? null });
  }
  const planned = planReminders(candidates, now, leads);
  const subsByOwner = new Map<string, SubscriptionLike[]>();
  for (const s of subs ?? []) {
    const list = subsByOwner.get(s.owner_id) ?? [];
    list.push(s);
    subsByOwner.set(s.owner_id, list);
  }
  const inserts = planned
    .filter((r) => kindAllowed(resolveSubscription(subsByOwner.get(r.ownerId) ?? [], r.eventId), r.kind))
    .map((r) => deliveryInsert({ ownerId: r.ownerId, alertKey: r.alertKey, kind: r.kind, text: r.text, category: "match", athleteId: r.athleteId, matchId: r.matchId, now }));
  if (inserts.length) {
    const { error } = await supabase.from("photo_notification_deliveries").upsert(inserts, { onConflict: "owner_id,channel,alert_key", ignoreDuplicates: true });
    if (error) log.warn("reminders.enqueue_failed", { error: error.message });
  }
  return { owners: owners.length, planned: inserts.length };
}
