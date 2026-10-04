import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger, type Logger } from "@/lib/log";
import type { Database, Json, PhotoNotificationDeliveryRow, PhotoTelegramLinkRow } from "@/lib/supabase/database.types";
import { backoffDelayMs, classifyTelegramError, formatTelegramMessage, TELEGRAM_CHANNEL, withCategory } from "./telegram/core";
import { categoryForKind, type MessageCategory } from "./telegram/kinds";

type Client = SupabaseClient<Database>;
export type SendMessage = (chatId: number, html: string) => Promise<void>;

export type DeliveryBatchOptions = {
  supabase: Client;
  now?: Date;
  log?: Logger;
  sendMessage?: SendMessage;
  /** Rows per claim (<= 100). */
  limit?: number;
  /** Drain one owner only (the post-refresh kick). */
  ownerId?: string | null;
  worker?: string;
  leaseSeconds?: number;
  /** Minimum spacing between messages to the same chat (Telegram: ~1/s per chat). */
  perChatSpacingMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type DeliveryBatchSummary = { claimed: number; sent: number; retried: number; failed: number; skipped: number; released: number; stoppedEarly: boolean };

/**
 * One bounded pass of the delivery runner:
 *   1. atomically claim due rows (lease + attempt count, SKIP LOCKED)
 *   2. per owner, load the enabled Telegram link once
 *   3. send with per-chat spacing; mark sent / pending-with-backoff / failed / skipped
 *   4. on a rate limit, stop and release the rest of the claim (attempt uncounted)
 * Never throws for a single row; a crashed runner's leases simply expire.
 */
export async function runDeliveryBatch(opts: DeliveryBatchOptions): Promise<DeliveryBatchSummary> {
  const { supabase } = opts;
  const now = opts.now ?? new Date();
  const log = (opts.log ?? createLogger({ route: "deliveries" })).child({ channel: TELEGRAM_CHANNEL });
  const sendMessage = opts.sendMessage ?? (await defaultSender(log));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const spacing = opts.perChatSpacingMs ?? 1_100;
  const worker = opts.worker ?? `runner:${process.pid}`;
  const summary: DeliveryBatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, released: 0, stoppedEarly: false };

  const { data: claimed, error } = await supabase.rpc("photo_claim_notification_deliveries", {
    p_channel: TELEGRAM_CHANNEL,
    p_limit: Math.min(Math.max(opts.limit ?? 20, 1), 100),
    p_lease_seconds: opts.leaseSeconds ?? 60,
    p_worker: worker,
    p_owner_id: opts.ownerId ?? null,
  });
  if (error) throw new Error(`claim deliveries: ${error.message}`);
  const rows = (claimed ?? []) as PhotoNotificationDeliveryRow[];
  summary.claimed = rows.length;
  if (!rows.length) return summary;

  const links = new Map<string, PhotoTelegramLinkRow | null>();
  const lastSentAt = new Map<number, number>();
  let stop = false;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (stop) {
      await release(supabase, row, now, "rate limited; released");
      summary.released += 1;
      continue;
    }
    let link = links.get(row.owner_id);
    if (link === undefined) {
      link = await loadLink(supabase, row.owner_id);
      links.set(row.owner_id, link);
    }
    if (!link || link.chat_id === null) {
      await patch(supabase, row, { status: "skipped", last_error: "no enabled Telegram link", next_attempt_at: null, leased_until: null, updated_at: now.toISOString() });
      summary.skipped += 1;
      continue;
    }

    const chatId = Number(link.chat_id);
    const since = Date.now() - (lastSentAt.get(chatId) ?? 0);
    if (since < spacing) await sleep(spacing - since);

    const text = textOf(row);
    try {
      await sendMessage(chatId, text);
      lastSentAt.set(chatId, Date.now());
      await patch(supabase, row, { status: "sent", sent_at: now.toISOString(), last_error: null, next_attempt_at: null, leased_until: null, updated_at: now.toISOString() });
      summary.sent += 1;
    } catch (err) {
      const klass = classifyTelegramError(err);
      if (klass.transient) {
        const delay = backoffDelayMs(row.attempts);
        const wait = delay === null ? null : Math.max(delay, klass.retryAfterMs ?? 0);
        await patch(supabase, row, {
          status: wait === null ? "failed" : "pending",
          last_error: klass.reason,
          next_attempt_at: wait === null ? null : new Date(now.getTime() + wait).toISOString(),
          leased_until: null,
          updated_at: now.toISOString(),
        });
        if (wait === null) summary.failed += 1;
        else summary.retried += 1;
        log.warn("delivery.retry", { deliveryId: row.id, attempts: row.attempts, waitMs: wait, reason: klass.reason });
        if (klass.retryAfterMs !== null) {
          // Telegram asked us to slow down: the rest of this claim would fail the same way.
          stop = true;
          summary.stoppedEarly = true;
        }
        continue;
      }
      await patch(supabase, row, { status: "failed", last_error: klass.reason, next_attempt_at: null, leased_until: null, updated_at: now.toISOString() });
      summary.failed += 1;
      log.warn("delivery.failed", { deliveryId: row.id, attempts: row.attempts, reason: klass.reason, disableLink: klass.disableLink });
      if (klass.disableLink) {
        const { error: linkError } = await supabase.from("photo_telegram_links").update({ enabled: false, updated_at: now.toISOString() }).eq("id", link.id).eq("owner_id", row.owner_id);
        if (linkError) log.warn("delivery.disable_link_failed", { error: linkError.message });
        links.set(row.owner_id, null);
      }
    }
  }
  if (summary.sent || summary.failed || summary.retried || summary.skipped) log.info("delivery.batch", { ...summary, worker });
  return summary;
}

/** Message text for a row: stored text (or title/body) with its category tag. */
export function textOf(row: Pick<PhotoNotificationDeliveryRow, "payload" | "kind" | "category">): string {
  const payload = (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {}) as { text?: unknown; title?: unknown; body?: unknown; category?: unknown };
  const base = typeof payload.text === "string" && payload.text ? payload.text : formatTelegramMessage({ title: String(payload.title ?? row.kind), body: String(payload.body ?? ""), mat: null });
  const category = (row.category as MessageCategory | null) ?? (typeof payload.category === "string" ? (payload.category as MessageCategory) : categoryForKind(row.kind));
  return withCategory(base, category);
}

async function loadLink(supabase: Client, ownerId: string): Promise<PhotoTelegramLinkRow | null> {
  const { data } = await supabase.from("photo_telegram_links").select("*").eq("owner_id", ownerId).eq("enabled", true).not("chat_id", "is", null).limit(1);
  return (data ?? [])[0] ?? null;
}

async function patch(supabase: Client, row: PhotoNotificationDeliveryRow, update: Partial<PhotoNotificationDeliveryRow>): Promise<void> {
  const { error } = await supabase.from("photo_notification_deliveries").update(update).eq("id", row.id).eq("owner_id", row.owner_id);
  if (error) throw new Error(error.message);
}

/** Gives a claimed-but-unsent row back: attempt uncounted, due again shortly. */
async function release(supabase: Client, row: PhotoNotificationDeliveryRow, now: Date, reason: string): Promise<void> {
  await patch(supabase, row, { status: "pending", attempts: Math.max(0, row.attempts - 1), last_error: reason, next_attempt_at: new Date(now.getTime() + 30_000).toISOString(), leased_until: null, updated_at: now.toISOString() });
}

/**
 * The real sender. Refuses to talk to Telegram in tests or when
 * TELEGRAM_DRY_RUN=1: messages are logged (text length only) and counted as
 * sent, so no production chat ever receives test traffic.
 */
async function defaultSender(log: Logger): Promise<SendMessage> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST || process.env.TELEGRAM_DRY_RUN === "1") {
    return async (chatId, html) => {
      log.info("delivery.dry_run", { chatId: String(chatId).slice(-3).padStart(String(chatId).length, "*"), bytes: html.length });
    };
  }
  const { getBot } = await import("./telegram/bot");
  const bot = getBot();
  return async (chatId, html) => {
    await bot.api.sendMessage(chatId, html, { parse_mode: "HTML" });
  };
}

/** Insert shape for producers (notifier, incidents, reminders, orders). */
export function deliveryInsert(input: { ownerId: string; alertKey: string; kind: string; text: string; category: MessageCategory; athleteId?: string | null; matchId?: string | null; extra?: Record<string, Json>; now: Date }): Database["public"]["Tables"]["photo_notification_deliveries"]["Insert"] {
  return {
    owner_id: input.ownerId,
    channel: TELEGRAM_CHANNEL,
    alert_key: input.alertKey,
    kind: input.kind,
    category: input.category,
    athlete_id: input.athleteId ?? null,
    match_id: input.matchId ?? null,
    payload: { ...(input.extra ?? {}), text: input.text, category: input.category } as Json,
    status: "pending",
    attempts: 0,
    next_attempt_at: input.now.toISOString(),
  };
}
