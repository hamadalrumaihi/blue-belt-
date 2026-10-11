import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InlineKeyboardMarkup } from "grammy/types";
import { createLogger, type Logger } from "@/lib/log";
import type { Database, Json, PhotoNotificationDeliveryRow, PhotoTelegramLinkRow } from "@/lib/supabase/database.types";
import { buildInlineKeyboard, callbackSecret, isCallbackAction, type CardButton, type InlineKeyboardRow } from "./telegram/callbacks";
import { backoffDelayMs, classifyTelegramError, formatTelegramMessage, TELEGRAM_CHANNEL, withCategory } from "./telegram/core";
import { categoryForKind, type MessageCategory } from "./telegram/kinds";

type Client = SupabaseClient<Database>;

/** Tries to record a delivered message as sent before giving up (see the send loop). */
const SENT_WRITE_ATTEMPTS = 3;
const SENT_WRITE_RETRY_MS = 250;

/** Legacy sender shape (tests, the notifier kick): text only, no buttons, no edits. */
export type SendMessage = (chatId: number, html: string) => Promise<void>;

/**
 * What the runner needs from Telegram. `send` returns the message id so a
 * later card can edit it or clear its buttons; the two edit calls are
 * optional and best effort (a card older than Telegram's edit window simply
 * gets a fresh message instead).
 */
export type TelegramTransport = {
  send(chatId: number, html: string, markup: InlineKeyboardRow[] | null): Promise<{ messageId: string | null }>;
  editText?(chatId: number, messageId: string, html: string, markup: InlineKeyboardRow[] | null): Promise<void>;
  clearButtons?(chatId: number, messageId: string): Promise<void>;
};

export type DeliveryBatchOptions = {
  supabase: Client;
  now?: Date;
  log?: Logger;
  sendMessage?: SendMessage;
  transport?: TelegramTransport;
  /** Secret for signing inline-button callbacks; defaults to one derived from TELEGRAM_BOT_TOKEN. Without either, action buttons are dropped. */
  callbackSigningSecret?: string | null;
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

/** The optional keys a producer may put in a Telegram delivery payload. */
export type TelegramPayloadExtras = {
  /** Inline buttons; actions are signed at send time for `order_id`. */
  buttons?: CardButton[][];
  order_id?: string;
  /** Edit the message sent for this alert key instead of sending a new one (falls back to a new message). */
  edit_of?: string;
  /** After sending, clear the buttons under the messages sent for these alert keys. */
  supersedes?: string[];
};

/**
 * One bounded pass of the delivery runner:
 *   1. atomically claim due rows (lease + attempt count, SKIP LOCKED)
 *   2. per owner, load the enabled Telegram link once
 *   3. send (or edit) with per-chat spacing; mark sent / pending-with-backoff / failed / skipped
 *   4. on a rate limit, stop and release the rest of the claim (attempt uncounted)
 * Never throws for a single row; a crashed runner's leases simply expire.
 */
export async function runDeliveryBatch(opts: DeliveryBatchOptions): Promise<DeliveryBatchSummary> {
  const { supabase } = opts;
  const now = opts.now ?? new Date();
  const log = (opts.log ?? createLogger({ route: "deliveries" })).child({ channel: TELEGRAM_CHANNEL });
  const transport = opts.transport ?? (opts.sendMessage ? legacyTransport(opts.sendMessage) : await defaultTransport(log));
  const signingSecret = opts.callbackSigningSecret === undefined ? envCallbackSecret() : opts.callbackSigningSecret;
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
    const extras = extrasOf(row);
    const markup = keyboardOf(extras, signingSecret, now, log);
    let messageId: string | null = null;
    try {
      messageId = await deliver(transport, supabase, row, chatId, text, markup, extras, log);
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
      continue;
    }

    // The message is out. Record it as sent. A failure to write the status here
    // must NOT be classified as a send error and rescheduled through backoff.
    // Retry the write briefly: if it never lands, the row's lease expires and a
    // later claim resends it (at-least-once), so these retries are what keeps a
    // one-off database hiccup from turning into a duplicate Telegram message.
    lastSentAt.set(chatId, Date.now());
    for (let attempt = 1; attempt <= SENT_WRITE_ATTEMPTS; attempt += 1) {
      try {
        await patch(supabase, row, { status: "sent", sent_at: now.toISOString(), last_error: null, next_attempt_at: null, leased_until: null, updated_at: now.toISOString(), ...(messageId ? { provider_message_id: messageId } : {}) });
        break;
      } catch (perr) {
        if (attempt === SENT_WRITE_ATTEMPTS) {
          log.warn("delivery.mark_sent_failed", { deliveryId: row.id, attempts: attempt, error: perr instanceof Error ? perr.message : String(perr) });
        } else {
          await sleep(SENT_WRITE_RETRY_MS * attempt);
        }
      }
    }
    summary.sent += 1;
    // Stale buttons on earlier cards for the same order go away (best effort; never fails the row).
    if (extras.supersedes?.length && transport.clearButtons) await clearSuperseded(transport, supabase, row, chatId, extras.supersedes, log);
  }
  if (summary.sent || summary.failed || summary.retried || summary.skipped) log.info("delivery.batch", { ...summary, worker });
  return summary;
}

/** Sends the row, or edits the message of `edit_of` when it is known; returns the Telegram message id. Throws on a send failure (classified by the caller). */
async function deliver(transport: TelegramTransport, supabase: Client, row: PhotoNotificationDeliveryRow, chatId: number, text: string, markup: InlineKeyboardRow[] | null, extras: TelegramPayloadExtras, log: Logger): Promise<string | null> {
  if (extras.edit_of && transport.editText) {
    const previous = await findMessageId(supabase, row.owner_id, extras.edit_of);
    if (previous) {
      try {
        await transport.editText(chatId, previous, text, markup);
        return previous;
      } catch (err) {
        // "message is not modified", too old to edit, deleted by the owner: send a fresh card instead.
        log.info("delivery.edit_fallback", { deliveryId: row.id, reason: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120) });
      }
    }
  }
  const out = await transport.send(chatId, text, markup);
  return out?.messageId ?? null;
}

async function clearSuperseded(transport: TelegramTransport, supabase: Client, row: PhotoNotificationDeliveryRow, chatId: number, keys: string[], log: Logger): Promise<void> {
  for (const key of keys.slice(0, 5)) {
    if (key === row.alert_key) continue;
    try {
      const id = await findMessageId(supabase, row.owner_id, key);
      if (id) await transport.clearButtons!(chatId, id);
    } catch (err) {
      log.info("delivery.supersede_failed", { deliveryId: row.id, reason: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120) });
    }
  }
}

async function findMessageId(supabase: Client, ownerId: string, alertKey: string): Promise<string | null> {
  const { data } = await supabase.from("photo_notification_deliveries").select("provider_message_id").eq("owner_id", ownerId).eq("channel", TELEGRAM_CHANNEL).eq("alert_key", alertKey).limit(1);
  const id = (data ?? [])[0]?.provider_message_id;
  return typeof id === "string" && id ? id : null;
}

/** Message text for a row: stored text (or title/body) with its category tag. */
export function textOf(row: Pick<PhotoNotificationDeliveryRow, "payload" | "kind" | "category">): string {
  const payload = (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {}) as { text?: unknown; title?: unknown; body?: unknown; category?: unknown };
  const base = typeof payload.text === "string" && payload.text ? payload.text : formatTelegramMessage({ title: String(payload.title ?? row.kind), body: String(payload.body ?? ""), mat: null });
  const category = (row.category as MessageCategory | null) ?? (typeof payload.category === "string" ? (payload.category as MessageCategory) : categoryForKind(row.kind));
  return withCategory(base, category);
}

/** The optional keyboard / edit / supersede instructions a producer stored on the row (validated, never trusted blindly). */
export function extrasOf(row: Pick<PhotoNotificationDeliveryRow, "payload">): TelegramPayloadExtras {
  const p = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {};
  const out: TelegramPayloadExtras = {};
  if (Array.isArray(p.buttons)) {
    const rows: CardButton[][] = [];
    for (const r of p.buttons.slice(0, 4)) {
      if (!Array.isArray(r)) continue;
      const row: CardButton[] = [];
      for (const b of r.slice(0, 3)) {
        if (!b || typeof b !== "object") continue;
        const { text, action, url } = b as Record<string, unknown>;
        if (typeof text !== "string" || !text.trim()) continue;
        if (typeof url === "string" && /^https:\/\//.test(url)) row.push({ text: text.slice(0, 40), url });
        else if (isCallbackAction(action)) row.push({ text: text.slice(0, 40), action });
      }
      if (row.length) rows.push(row);
    }
    if (rows.length) out.buttons = rows;
  }
  if (typeof p.order_id === "string") out.order_id = p.order_id;
  if (typeof p.edit_of === "string" && p.edit_of) out.edit_of = p.edit_of;
  if (Array.isArray(p.supersedes)) out.supersedes = p.supersedes.filter((k): k is string => typeof k === "string" && k.length > 0).slice(0, 5);
  return out;
}

/** Signs the action buttons for the row's order; without a secret or an order id only link buttons survive. */
export function keyboardOf(extras: TelegramPayloadExtras, secret: string | null, now: Date, log?: Logger): InlineKeyboardRow[] | null {
  if (!extras.buttons?.length) return null;
  const canSign = Boolean(secret && extras.order_id);
  const rows = extras.buttons.map((r) => r.filter((b) => b.url || canSign)).filter((r) => r.length);
  if (!rows.length) return null;
  try {
    return buildInlineKeyboard(rows, { orderId: extras.order_id ?? "", secret: secret ?? "", now });
  } catch (err) {
    log?.warn("delivery.keyboard_failed", { error: err instanceof Error ? err.message : String(err) });
    return rows.map((r) => r.filter((b) => b.url).map((b) => ({ text: b.text, url: b.url! }))).filter((r) => r.length);
  }
}

function envCallbackSecret(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return token ? callbackSecret(token) : null;
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

function legacyTransport(sendMessage: SendMessage): TelegramTransport {
  return {
    async send(chatId, html) {
      await sendMessage(chatId, html);
      return { messageId: null };
    },
  };
}

/**
 * The real transport. Refuses to talk to Telegram in tests or when
 * TELEGRAM_DRY_RUN=1: messages are logged (text length only) and counted as
 * sent, so no production chat ever receives test traffic.
 */
async function defaultTransport(log: Logger): Promise<TelegramTransport> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST || process.env.TELEGRAM_DRY_RUN === "1") {
    return {
      async send(chatId, html, markup) {
        log.info("delivery.dry_run", { chatId: String(chatId).slice(-3).padStart(String(chatId).length, "*"), bytes: html.length, buttons: markup?.flat().length ?? 0 });
        return { messageId: null };
      },
    };
  }
  const { getBot } = await import("./telegram/bot");
  const api = getBot().api;
  const replyMarkup = (markup: InlineKeyboardRow[] | null): InlineKeyboardMarkup | undefined => (markup && markup.length ? { inline_keyboard: markup as InlineKeyboardMarkup["inline_keyboard"] } : undefined);
  return {
    async send(chatId, html, markup) {
      const msg = await api.sendMessage(chatId, html, { parse_mode: "HTML", reply_markup: replyMarkup(markup), link_preview_options: { is_disabled: true } });
      return { messageId: String(msg.message_id) };
    },
    async editText(chatId, messageId, html, markup) {
      await api.editMessageText(chatId, Number(messageId), html, { parse_mode: "HTML", reply_markup: replyMarkup(markup) ?? { inline_keyboard: [] }, link_preview_options: { is_disabled: true } });
    },
    async clearButtons(chatId, messageId) {
      await api.editMessageReplyMarkup(chatId, Number(messageId), { reply_markup: { inline_keyboard: [] } });
    },
  };
}

/** Insert shape for producers (notifier, incidents, reminders, orders). */
export function deliveryInsert(input: {
  ownerId: string;
  alertKey: string;
  kind: string;
  text: string;
  category: MessageCategory;
  athleteId?: string | null;
  matchId?: string | null;
  extra?: Record<string, Json>;
  /** Inline buttons (actions signed at send time for `orderId`). */
  buttons?: CardButton[][];
  orderId?: string | null;
  editOf?: string | null;
  supersedes?: string[];
  now: Date;
}): Database["public"]["Tables"]["photo_notification_deliveries"]["Insert"] {
  const payload: Record<string, Json> = { ...(input.extra ?? {}), text: input.text, category: input.category };
  if (input.buttons?.length) payload.buttons = input.buttons as unknown as Json;
  if (input.orderId) payload.order_id = input.orderId;
  if (input.editOf) payload.edit_of = input.editOf;
  if (input.supersedes?.length) payload.supersedes = input.supersedes;
  return {
    owner_id: input.ownerId,
    channel: TELEGRAM_CHANNEL,
    alert_key: input.alertKey,
    kind: input.kind,
    category: input.category,
    athlete_id: input.athleteId ?? null,
    match_id: input.matchId ?? null,
    payload: payload as Json,
    status: "pending",
    attempts: 0,
    next_attempt_at: input.now.toISOString(),
  };
}
