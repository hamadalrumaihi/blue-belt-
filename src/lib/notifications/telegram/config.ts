import "server-only";

/**
 * Telegram feature flag and environment. Everything here is server-only:
 * the bot token and webhook secret must never be prefixed NEXT_PUBLIC_.
 *
 *   TELEGRAM_ENABLED=1            turns the channel on (off by default)
 *   TELEGRAM_BOT_TOKEN            from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET       random string; Telegram echoes it in
 *                                 X-Telegram-Bot-Api-Secret-Token
 *   TELEGRAM_BOT_USERNAME         optional, shown in the linking instructions
 */
export function isTelegramEnabled(): boolean {
  return process.env.TELEGRAM_ENABLED === "1" && Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function telegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  return token;
}

export function telegramWebhookSecret(): string | null {
  return normalizeWebhookSecret(process.env.TELEGRAM_WEBHOOK_SECRET);
}

/**
 * Tolerates the common paste mistakes seen in dashboard env editors:
 * surrounding whitespace or quotes, and the entire setWebhook URL pasted in
 * place of the secret (the value is then the `secret_token` query parameter).
 */
export function normalizeWebhookSecret(raw: string | null | undefined): string | null {
  let secret = (raw ?? "").trim().replace(/^["']+|["']+$/g, "");
  if (/^https?:\/\//i.test(secret)) {
    try {
      secret = new URL(secret).searchParams.get("secret_token")?.trim() ?? "";
    } catch {
      secret = "";
    }
  }
  return secret.length >= 8 ? secret : null;
}

export function telegramBotUsername(): string | null {
  const name = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  return name || null;
}
