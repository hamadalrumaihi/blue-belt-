"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { TELEGRAM_CHANNEL } from "@/lib/notifications/telegram/core";
import { normalizeKinds, TELEGRAM_ALERT_KINDS } from "@/lib/notifications/telegram/kinds";
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
