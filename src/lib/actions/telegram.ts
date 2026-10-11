"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Api } from "grammy";
import { writeAudit } from "@/lib/audit";
import { createLogger } from "@/lib/log";
import { isTelegramEnabled, telegramBotToken, telegramWebhookSecret } from "@/lib/notifications/telegram/config";
import { TELEGRAM_CHANNEL } from "@/lib/notifications/telegram/core";
import { normalizeKinds, TELEGRAM_ALERT_KINDS } from "@/lib/notifications/telegram/kinds";
import { summarizeWebhookInfo, TELEGRAM_ALLOWED_UPDATES, telegramWebhookUrl, type WebhookSummary } from "@/lib/notifications/telegram/webhook-admin";
import { rateLimit, RULES } from "@/lib/rate-limit";
import { requireOwner } from "@/lib/roles";
import { siteUrl } from "@/lib/studio/queries";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

/**
 * Telegram linking and subscription actions. Everything runs through the
 * user's Supabase client so RLS scopes rows to the signed-in owner. The bot
 * token is never touched here; linking only produces a short-lived code that
 * the user sends to the bot (see docs/telegram.md).
 */
export type TelegramActionResult = { ok: true } | { ok: false; error: string };
export type LinkCodeResult = { ok: true; code: string; expiresAt: string } | { ok: false; error: string };

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 8;
const CODE_TTL_MS = 15 * 60_000;

function generateLinkCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Creates (or refreshes) the owner's link code; valid for 15 minutes. */
export async function createLinkCode(): Promise<LinkCodeResult> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const now = new Date();
  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  const { data: existing, error: readError } = await supabase.from("photo_telegram_links").select("id").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  const { error } = existing
    ? await supabase.from("photo_telegram_links").update({ link_code: code, link_code_expires_at: expiresAt, enabled: true, updated_at: now.toISOString() }).eq("id", existing.id)
    : await supabase.from("photo_telegram_links").insert({ owner_id: user.id, link_code: code, link_code_expires_at: expiresAt, enabled: true });
  if (error) return { ok: false, error: error.message };

  // A default global subscription so linking alone is enough to receive alerts.
  const { data: sub } = await supabase.from("photo_notification_subscriptions").select("id").eq("owner_id", user.id).eq("channel", TELEGRAM_CHANNEL).is("event_id", null).maybeSingle();
  if (!sub) await supabase.from("photo_notification_subscriptions").insert({ owner_id: user.id, channel: TELEGRAM_CHANNEL, kinds: [...TELEGRAM_ALERT_KINDS], enabled: true });

  revalidatePath("/settings");
  return { ok: true, code, expiresAt };
}

async function setLinkEnabled(enabled: boolean): Promise<TelegramActionResult> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { error } = await supabase.from("photo_telegram_links").update({ enabled, updated_at: new Date().toISOString() }).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

/** Pauses delivery; the chat stays linked so it can be resumed without a new code. */
export async function disableTelegram(): Promise<TelegramActionResult> {
  return setLinkEnabled(false);
}

export async function enableTelegram(): Promise<TelegramActionResult> {
  return setLinkEnabled(true);
}

/** Global (eventId null) or per-event kinds; the per-event row wins for that event. */
export async function saveTelegramSubscription(input: { eventId: string | null; kinds: unknown; enabled: boolean }): Promise<TelegramActionResult> {
  const eventId = input.eventId ?? null;
  if (eventId !== null && !isUuid(eventId)) return { ok: false, error: "Invalid event." };
  const kinds = normalizeKinds(input.kinds);
  if (!kinds) return { ok: false, error: "Unknown alert kind." };
  if (typeof input.enabled !== "boolean") return { ok: false, error: "enabled must be a boolean." };

  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "You are signed out." };

  let query = supabase.from("photo_notification_subscriptions").select("id").eq("owner_id", user.id).eq("channel", TELEGRAM_CHANNEL);
  query = eventId === null ? query.is("event_id", null) : query.eq("event_id", eventId);
  const { data: existing, error: readError } = await query.maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  const { error } = existing
    ? await supabase.from("photo_notification_subscriptions").update({ kinds, enabled: input.enabled, updated_at: new Date().toISOString() }).eq("id", existing.id)
    : await supabase.from("photo_notification_subscriptions").insert({ owner_id: user.id, channel: TELEGRAM_CHANNEL, event_id: eventId, kinds, enabled: input.enabled });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Webhook registration (owner only; the token never leaves the server)
// ---------------------------------------------------------------------------

export type WebhookActionResult = { ok: true; summary: WebhookSummary; message?: string } | { ok: false; error: string };

async function webhookGate(): Promise<{ ok: true; api: Api; userId: string; secret: string } | { ok: false; error: string }> {
  const who = await requireOwner();
  if (!who.ok) return { ok: false, error: "Only the studio owner can manage the Telegram webhook." };
  if (!isTelegramEnabled()) return { ok: false, error: "Telegram is off on this server (TELEGRAM_ENABLED / TELEGRAM_BOT_TOKEN)." };
  const secret = telegramWebhookSecret();
  if (!secret) return { ok: false, error: "TELEGRAM_WEBHOOK_SECRET is missing or shorter than 8 characters on the server." };
  const limit = rateLimit(`tg-webhook:${who.viewer.userId}`, RULES.providerActionPerUser);
  if (!limit.ok) return { ok: false, error: `Too many webhook checks. Wait ${limit.retryAfterSeconds}s.` };
  return { ok: true, api: new Api(telegramBotToken()), userId: who.viewer.userId, secret };
}

function describeApiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // grammY error text is "Call to 'setWebhook' failed! (401: Unauthorized)"; keep it, strip anything token-like.
  return msg.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<token>").slice(0, 200);
}

/** Reads getWebhookInfo and reports it without secrets: URL match, allowed updates, pending count, last error. */
export async function inspectTelegramWebhook(): Promise<WebhookActionResult> {
  const gate = await webhookGate();
  if (!gate.ok) return gate;
  try {
    const info = await gate.api.getWebhookInfo();
    return { ok: true, summary: summarizeWebhookInfo(info, siteUrl()) };
  } catch (err) {
    return { ok: false, error: `Telegram did not answer: ${describeApiError(err)}` };
  }
}

/**
 * Registers (or re-registers) this deployment's webhook with the secret token
 * and allowed_updates = ["message", "callback_query"]. Idempotent: Telegram
 * replaces the previous registration. Audited; nothing about the secret is
 * returned or logged.
 */
export async function registerTelegramWebhook(): Promise<WebhookActionResult> {
  const gate = await webhookGate();
  if (!gate.ok) return gate;
  const url = telegramWebhookUrl(siteUrl());
  if (!/^https:\/\//.test(url)) return { ok: false, error: `The site URL must be https for Telegram webhooks (got ${url}).` };
  const log = createLogger({ scope: "telegram.webhook.register" });
  try {
    await gate.api.setWebhook(url, { secret_token: gate.secret, allowed_updates: [...TELEGRAM_ALLOWED_UPDATES], drop_pending_updates: false });
    const info = await gate.api.getWebhookInfo();
    const summary = summarizeWebhookInfo(info, siteUrl());
    const supabase = await createClient();
    await writeAudit(supabase, { ownerId: gate.userId, actorId: gate.userId, entity: "studio", entityId: gate.userId, action: "telegram.webhook_registered", data: { url, allowed_updates: [...TELEGRAM_ALLOWED_UPDATES], verdict: summary.verdict } });
    log.info("telegram.webhook.registered", { verdict: summary.verdict });
    revalidatePath("/settings");
    return { ok: true, summary, message: summary.verdict === "ok" ? "Webhook registered. Messages and button clicks reach this app." : "Webhook call succeeded, but Telegram reports a problem; see below." };
  } catch (err) {
    log.warn("telegram.webhook.register_failed", { error: describeApiError(err) });
    return { ok: false, error: `Telegram rejected the registration: ${describeApiError(err)}` };
  }
}
