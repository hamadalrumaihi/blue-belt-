import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { TELEGRAM_CHANNEL } from "./core";
import { TELEGRAM_ALERT_KINDS, normalizeKinds, type TelegramAlertKind } from "./kinds";

/** What the Settings page shows; serialisable so it can be passed to the client component. */
export type TelegramSettingsState = {
  linked: boolean;
  enabled: boolean;
  chatTitle: string | null;
  /** Pending (unexpired) link code, if the user generated one. */
  code: string | null;
  codeExpiresAt: string | null;
  kinds: TelegramAlertKind[];
  subscriptionEnabled: boolean;
};

export const EMPTY_TELEGRAM_STATE: TelegramSettingsState = {
  linked: false,
  enabled: true,
  chatTitle: null,
  code: null,
  codeExpiresAt: null,
  kinds: [...TELEGRAM_ALERT_KINDS],
  subscriptionEnabled: true,
};

/** Loads the owner's link and global subscription through the user client (RLS applies). */
export async function loadTelegramSettings(supabase: SupabaseClient<Database>, ownerId: string, now: Date = new Date()): Promise<TelegramSettingsState> {
  const [{ data: link }, { data: sub }] = await Promise.all([
    supabase.from("photo_telegram_links").select("*").eq("owner_id", ownerId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("photo_notification_subscriptions").select("*").eq("owner_id", ownerId).eq("channel", TELEGRAM_CHANNEL).is("event_id", null).maybeSingle(),
  ]);
  const codeValid = Boolean(link?.link_code && link.link_code_expires_at && new Date(link.link_code_expires_at).getTime() > now.getTime());
  return {
    linked: Boolean(link?.chat_id),
    enabled: link?.enabled ?? true,
    chatTitle: link?.chat_title ?? null,
    code: codeValid ? link!.link_code : null,
    codeExpiresAt: codeValid ? link!.link_code_expires_at : null,
    kinds: normalizeKinds(sub?.kinds) ?? [...TELEGRAM_ALERT_KINDS],
    subscriptionEnabled: sub?.enabled ?? true,
  };
}
