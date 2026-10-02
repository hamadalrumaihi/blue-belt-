import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAlerts } from "@/lib/alerts";
import { rankAthletes } from "@/lib/eta";
import type { Logger } from "@/lib/log";
import type { RefreshNotificationContext } from "@/lib/notifications/server";
import type { AppAlert } from "@/lib/notifications/types";
import type { Database, Json, PhotoNotificationDeliveryRow, PhotoTelegramLinkRow } from "@/lib/supabase/database.types";
import { DEFAULT_TIMEZONE, formatTime } from "@/lib/time";
import type { AthleteWithMatches, HistoryEntry } from "@/lib/types";
import {
  backoffDelayMs,
  classifyTelegramError,
  deliveryKeyFor,
  formatTelegramMessage,
  kindAllowed,
  MAX_ATTEMPTS,
  resolveSubscription,
  TELEGRAM_CHANNEL,
  type HistoryChange,
  type SubscriptionLike,
} from "./core";
import { isTelegramAlertKind } from "./kinds";

type Client = SupabaseClient<Database>;

export type SendMessage = (chatId: number, html: string) => Promise<void>;

export type NotifierDeps = {
  /** Defaults to the grammY bot's `api.sendMessage` with HTML parse mode. */
  sendMessage?: SendMessage;
};

const ALL_PREFS = { m30: true, m15: true, m5: true, matChange: true, timeChange: true };

type PlannedDelivery = { alert: AppAlert; key: string; text: string; eventId: string | null };

/**
 * Turns one persisted refresh into Telegram messages:
 *   results → alerts (same pure logic as the in-app banners)
 *   → per owner: enabled link + subscription + kinds filter
 *   → delivery rows (unique per owner/channel/alert key = dedupe)
 *   → send the due rows, with bounded retries for transient failures.
 */
export async function runTelegramNotifier(ctx: RefreshNotificationContext, deps: NotifierDeps = {}): Promise<void> {
  const sendMessage = deps.sendMessage ?? (await defaultSender());
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
      await processOwner(supabase, ownerId, planned.get(ownerId) ?? [], now, sendMessage, log.child({ ownerId }));
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
    withMatches.push({ ...athlete, matches: r.matches, event: event ? { id: event.id, name: event.name, timezone: event.timezone, platform: event.platform } : null });
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

async function processOwner(supabase: Client, ownerId: string, planned: PlannedDelivery[], now: Date, sendMessage: SendMessage, log: Logger): Promise<void> {
  const { data: links, error: linkError } = await supabase.from("photo_telegram_links").select("*").eq("owner_id", ownerId).eq("enabled", true).not("chat_id", "is", null);
  if (linkError) throw new Error(linkError.message);
  const link = (links ?? [])[0] as PhotoTelegramLinkRow | undefined;
  if (!link || link.chat_id === null) return;

  const { data: subRows, error: subError } = await supabase.from("photo_notification_subscriptions").select("event_id,kinds,enabled").eq("owner_id", ownerId).eq("channel", TELEGRAM_CHANNEL);
  if (subError) throw new Error(subError.message);
  const subs: SubscriptionLike[] = subRows ?? [];

  const inserts = planned
    .filter((d) => kindAllowed(resolveSubscription(subs, d.eventId), d.alert.kind))
    .map((d) => ({
      owner_id: ownerId,
      channel: TELEGRAM_CHANNEL,
      alert_key: d.key,
      kind: d.alert.kind,
      athlete_id: d.alert.athleteId || null,
      match_id: matchIdOf(d.key),
      payload: { title: d.alert.title, body: d.alert.body, mat: d.alert.mat, athleteName: d.alert.athleteName, text: d.text } as Json,
      status: "pending" as const,
      attempts: 0,
      next_attempt_at: now.toISOString(),
    }));
  if (inserts.length) {
    const { error } = await supabase.from("photo_notification_deliveries").upsert(inserts, { onConflict: "owner_id,channel,alert_key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  // New rows plus earlier transient failures that are due again.
  const { data: due, error: dueError } = await supabase
    .from("photo_notification_deliveries")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("channel", TELEGRAM_CHANNEL)
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .lte("next_attempt_at", now.toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  if (dueError) throw new Error(dueError.message);
  if (!due?.length) return;

  let sent = 0;
  for (const row of due) {
    const outcome = await deliver(supabase, link, row, now, sendMessage, log);
    if (outcome === "sent") sent += 1;
    if (outcome === "stop") break;
  }
  if (sent) log.info("telegram.sent", { count: sent, due: due.length });
}

type Outcome = "sent" | "retry" | "failed" | "stop" | "skipped";

async function deliver(supabase: Client, link: PhotoTelegramLinkRow, row: PhotoNotificationDeliveryRow, now: Date, sendMessage: SendMessage, log: Logger): Promise<Outcome> {
  const attempts = row.attempts + 1;
  // Optimistic claim: a concurrent refresh that already bumped `attempts` wins.
  const lease = new Date(now.getTime() + 60_000).toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("photo_notification_deliveries")
    .update({ attempts, next_attempt_at: lease, updated_at: now.toISOString() })
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed?.length) return "skipped";

  const payload = (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {}) as { text?: unknown; title?: unknown; body?: unknown };
  const text = typeof payload.text === "string" && payload.text ? payload.text : formatTelegramMessage({ title: String(payload.title ?? row.kind), body: String(payload.body ?? ""), mat: null });

  try {
    await sendMessage(link.chat_id as number, text);
    await patch(supabase, row.id, { status: "sent", sent_at: now.toISOString(), last_error: null, next_attempt_at: null, updated_at: now.toISOString() });
    return "sent";
  } catch (err) {
    const klass = classifyTelegramError(err);
    if (klass.transient) {
      const delay = backoffDelayMs(attempts);
      const wait = delay === null ? null : Math.max(delay, klass.retryAfterMs ?? 0);
      await patch(supabase, row.id, {
        status: wait === null ? "failed" : "pending",
        last_error: klass.reason,
        next_attempt_at: wait === null ? null : new Date(now.getTime() + wait).toISOString(),
        updated_at: now.toISOString(),
      });
      log.warn("telegram.send_retry", { deliveryId: row.id, attempts, waitMs: wait, reason: klass.reason });
      // Rate limited or unreachable: later rows would fail the same way right now.
      return klass.retryAfterMs !== null ? "stop" : "retry";
    }
    await patch(supabase, row.id, { status: "failed", last_error: klass.reason, next_attempt_at: null, updated_at: now.toISOString() });
    log.warn("telegram.send_failed", { deliveryId: row.id, attempts, reason: klass.reason, disableLink: klass.disableLink });
    if (klass.disableLink) {
      const { error } = await supabase.from("photo_telegram_links").update({ enabled: false, updated_at: now.toISOString() }).eq("id", link.id);
      if (error) log.warn("telegram.disable_failed", { error: error.message });
      return "stop";
    }
    return "failed";
  }
}

async function patch(supabase: Client, id: number, update: Partial<PhotoNotificationDeliveryRow>): Promise<void> {
  const { error } = await supabase.from("photo_notification_deliveries").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

async function defaultSender(): Promise<SendMessage> {
  const { getBot } = await import("./bot");
  const bot = getBot();
  return async (chatId, html) => {
    await bot.api.sendMessage(chatId, html, { parse_mode: "HTML" });
  };
}
