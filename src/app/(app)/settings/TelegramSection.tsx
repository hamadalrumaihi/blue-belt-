import { isTelegramEnabled, telegramBotUsername } from "@/lib/notifications/telegram/config";
import { summarizeDeliveries, type DeliveryHealth } from "@/lib/notifications/telegram/health";
import { EMPTY_TELEGRAM_STATE, loadTelegramSettings } from "@/lib/notifications/telegram/settings";
import { createClient } from "@/lib/supabase/server";
import { TelegramSettings } from "./TelegramSettings";

/**
 * Server half of the Telegram card: reads the feature flag and the owner's
 * link / subscription rows (user client, RLS) and hands them to the client UI.
 */
export async function TelegramSection() {
  const configured = isTelegramEnabled();
  if (!configured) return <TelegramSettings configured={false} botUsername={null} state={EMPTY_TELEGRAM_STATE} />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const state = user ? await loadTelegramSettings(supabase, user.id) : EMPTY_TELEGRAM_STATE;
  let health: DeliveryHealth | null = null;
  if (user && state.linked) {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const [recent, last] = await Promise.all([
      supabase.from("photo_notification_deliveries").select("status,created_at,sent_at,last_error,next_attempt_at,updated_at").eq("owner_id", user.id).gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      supabase.from("photo_notification_deliveries").select("sent_at").eq("owner_id", user.id).eq("status", "sent").order("sent_at", { ascending: false }).limit(1),
    ]);
    if (!recent.error) health = summarizeDeliveries(recent.data ?? [], { now, linkEnabled: state.enabled, lastSentAt: last.data?.[0]?.sent_at ?? null });
  }
  return <TelegramSettings configured botUsername={telegramBotUsername()} state={state} health={health} />;
}
