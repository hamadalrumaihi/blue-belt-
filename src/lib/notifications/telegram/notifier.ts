import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAlerts } from "@/lib/alerts";
import { rankAthletes } from "@/lib/eta";
import type { RefreshNotificationContext } from "@/lib/notifications/server";
import type { AppAlert } from "@/lib/notifications/types";
import type { Database, PhotoTelegramLinkRow } from "@/lib/supabase/database.types";
import { DEFAULT_TIMEZONE, formatTime } from "@/lib/time";
import type { AthleteWithMatches, HistoryEntry } from "@/lib/types";
import { deliveryInsert, runDeliveryBatch, type SendMessage } from "../delivery-runner";
import { deliveryKeyFor, formatTelegramMessage, kindAllowed, resolveSubscription, TELEGRAM_CHANNEL, type HistoryChange, type SubscriptionLike } from "./core";
import { isTelegramAlertKind } from "./kinds";

type Client = SupabaseClient<Database>;

export type { SendMessage };

export type NotifierDeps = {
  /** Defaults to the grammY bot's `api.sendMessage` with HTML parse mode (dry-run in tests). */
  sendMessage?: SendMessage;
  /** Skip the immediate per-owner drain (the independent runner will send). */
  noKick?: boolean;
};

const ALL_PREFS = { m30: true, m15: true, m5: true, matChange: true, timeChange: true };

type PlannedDelivery = { alert: AppAlert; key: string; text: string; eventId: string | null };

/**
 * PRODUCER for match alerts. Turns one persisted refresh into delivery rows:
 *   results → alerts (same pure logic as the in-app banners)
 *   → per owner: enabled link + subscription + kinds filter
 *   → delivery rows (unique per owner/channel/alert key = dedupe)
 * then kicks a small, bounded, lease-based drain for that owner so urgent
 * alerts (GO TO MAT) leave immediately. Everything else — retries, backoff,
 * reminders, incidents — is sent by the independent delivery runner
 * (/api/cron/deliveries, ticked by the Railway process).
 */
export async function runTelegramNotifier(ctx: RefreshNotificationContext, deps: NotifierDeps = {}): Promise<void> {
  const { supabase, now } = ctx;
  const log = ctx.log.child({ channel: TELEGRAM_CHANNEL });

  const planned = planDeliveries(ctx);
  const owners = new Set<string>([...planned.keys()]);
  for (const r of ctx.results) {
    const a = ctx.athletes.find((x) => x.id === r.athleteId);
    if (a) owners.add(a.owner_id);
  }

  for (const ownerId of owners) {
    try {
      const enqueued = await enqueueOwner(supabase, ownerId, planned.get(ownerId) ?? [], now);
      if (enqueued === "no-link") continue;
      if (!deps.noKick) await runDeliveryBatch({ supabase, now, log, sendMessage: deps.sendMessage, ownerId, limit: 10, worker: "kick", perChatSpacingMs: 0 });
    } catch (err) {
      log.warn("telegram.owner_failed", { ownerId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** Alerts per owner, computed from the refreshed rows. Exported for tests. */
export function planDeliveries(ctx: Pick<RefreshNotificationContext, "athletes" | "events" | "results" | "now">): Map<string, PlannedDelivery[]> {
  const { athletes, events, results, now } = ctx;
  const byId = new Map(athletes.map((a) => [a.id, a]));
  const withMatches: AthleteWithMatches[] = [];
  const history: HistoryEntry[] = [];
  const changes = new Map<number | string, HistoryChange>();

  for (const r of results) {
    const athlete = byId.get(r.athleteId);
    if (!athlete || !athlete.active) continue;
    const event = athlete.event_id ? events.get(athlete.event_id) ?? null : null;
    withMatches.push({ ...athlete, matches: r.matches, event: event ? { id: event.id, name: event.name, timezone: event.timezone, platform: event.platform, tracking_mode: event.tracking_mode } : null });
    for (const c of r.changes) {
      const id = -(changes.size + 1);
      changes.set(id, c);
      history.push({ id, owner_id: athlete.owner_id, match_id: c.match_id, change_type: c.change_type, old_value: c.old_value, new_value: c.new_value, detected_at: r.checkedAt, athlete_id: athlete.id, athlete_name: athlete.name, event_id: athlete.event_id });
    }
  }

  const ranked = rankAthletes(withMatches, now);
  const matchById = new Map<string, { mat: string | null; time: string | null }>();
  for (const { athlete, match, eta } of ranked) {
    if (!match) continue;
    matchById.set(match.id, { mat: match.mat, time: eta.targetAt ? formatTime(eta.targetAt, athlete.event?.timezone ?? DEFAULT_TIMEZONE) : null });
  }

  const out = new Map<string, PlannedDelivery[]>();
  for (const alert of buildAlerts(ranked, history, ALL_PREFS, now)) {
    if (!isTelegramAlertKind(alert.kind)) continue;
    const athlete = byId.get(alert.athleteId);
    if (!athlete) continue;
    const key = deliveryKeyFor(alert, changes);
    const matchId = matchIdOf(key);
    const details = matchId ? matchById.get(matchId) : undefined;
    const text = formatTelegramMessage(alert, alert.id.startsWith("hist:") ? {} : details);
    const list = out.get(athlete.owner_id) ?? [];
    if (!list.some((d) => d.key === key)) list.push({ alert, key, text, eventId: athlete.event_id });
    out.set(athlete.owner_id, list);
  }
  return out;
}

function matchIdOf(key: string): string | null {
  const m = /^(?:go|on-mat):(.+)$/.exec(key);
  return m ? m[1] : null;
}

/** Writes the owner's delivery rows (dedupe by key). Returns "no-link" when nothing can be delivered. */
async function enqueueOwner(supabase: Client, ownerId: string, planned: PlannedDelivery[], now: Date): Promise<"enqueued" | "no-link"> {
  const { data: links, error: linkError } = await supabase.from("photo_telegram_links").select("*").eq("owner_id", ownerId).eq("enabled", true).not("chat_id", "is", null);
  if (linkError) throw new Error(linkError.message);
  const link = (links ?? [])[0] as PhotoTelegramLinkRow | undefined;
  if (!link || link.chat_id === null) return "no-link";
  if (!planned.length) return "enqueued";

  const { data: subRows, error: subError } = await supabase.from("photo_notification_subscriptions").select("event_id,kinds,enabled").eq("owner_id", ownerId).eq("channel", TELEGRAM_CHANNEL);
  if (subError) throw new Error(subError.message);
  const subs: SubscriptionLike[] = subRows ?? [];

  const inserts = planned
    .filter((d) => kindAllowed(resolveSubscription(subs, d.eventId), d.alert.kind))
    .map((d) =>
      deliveryInsert({
        ownerId,
        alertKey: d.key,
        kind: d.alert.kind,
        text: d.text,
        category: "match",
        athleteId: d.alert.athleteId || null,
        matchId: matchIdOf(d.key),
        extra: { title: d.alert.title, body: d.alert.body, mat: d.alert.mat, athleteName: d.alert.athleteName },
        now,
      }),
    );
  if (inserts.length) {
    const { error } = await supabase.from("photo_notification_deliveries").upsert(inserts, { onConflict: "owner_id,channel,alert_key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return "enqueued";
}
