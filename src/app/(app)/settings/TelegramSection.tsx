import { isTelegramEnabled, telegramBotUsername } from "@/lib/notifications/telegram/config";
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
  return <TelegramSettings configured botUsername={telegramBotUsername()} state={state} />;
}
