/**
 * Telegram webhook registration helpers. Pure functions here are used by the
 * owner actions (src/lib/actions/telegram.ts) and by tests; the Bot API calls
 * themselves live in the action so this module stays free of the token.
 *
 * The webhook must be registered with `allowed_updates` covering BOTH
 * "message" (linking commands, /status) and "callback_query" (the order
 * buttons). Telegram keeps the last allowed_updates list it was given, so a
 * registration made before the buttons shipped silently drops every click.
 */
export const TELEGRAM_WEBHOOK_PATH = "/api/telegram/webhook";
export const TELEGRAM_ALLOWED_UPDATES = ["message", "callback_query"] as const;

export function telegramWebhookUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, "")}${TELEGRAM_WEBHOOK_PATH}`;
}

/** The subset of getWebhookInfo that is safe to show in the dashboard (no token, no secret). */
export type WebhookInfoLike = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
  max_connections?: number;
  ip_address?: string;
};

export type WebhookSummary = {
  /** Telegram points at this deployment's /api/telegram/webhook. */
  registered: boolean;
  /** Telegram points somewhere, but not at this deployment (another host, or nothing). */
  urlMatches: boolean;
  /** Host of the registered URL, for display; never the full URL when it is foreign. */
  registeredHost: string | null;
  /** Both "message" and "callback_query" are delivered. */
  buttonsEnabled: boolean;
  missingUpdates: string[];
  pendingUpdates: number;
  lastErrorAt: string | null;
  lastError: string | null;
  verdict: "ok" | "buttons_off" | "wrong_url" | "not_registered";
};

export function summarizeWebhookInfo(info: WebhookInfoLike, siteUrl: string): WebhookSummary {
  const expected = telegramWebhookUrl(siteUrl);
  const url = (info.url ?? "").trim();
  const registered = url.length > 0;
  const urlMatches = registered && url === expected;
  let registeredHost: string | null = null;
  if (registered) {
    try {
      registeredHost = new URL(url).host;
    } catch {
      registeredHost = "unknown";
    }
  }
  // An empty allowed_updates means Telegram's default set, which includes
  // both message and callback_query (but not chat_member etc.).
  const allowed = Array.isArray(info.allowed_updates) ? info.allowed_updates : [];
  const missingUpdates = allowed.length === 0 ? [] : TELEGRAM_ALLOWED_UPDATES.filter((u) => !allowed.includes(u));
  const buttonsEnabled = registered && missingUpdates.length === 0;
  const lastError = typeof info.last_error_message === "string" && info.last_error_message ? info.last_error_message.slice(0, 200) : null;
  const lastErrorAt = typeof info.last_error_date === "number" && info.last_error_date > 0 ? new Date(info.last_error_date * 1000).toISOString() : null;
  const verdict: WebhookSummary["verdict"] = !registered ? "not_registered" : !urlMatches ? "wrong_url" : !buttonsEnabled ? "buttons_off" : "ok";
  return { registered, urlMatches, registeredHost, buttonsEnabled, missingUpdates, pendingUpdates: Math.max(0, Number(info.pending_update_count ?? 0) || 0), lastErrorAt, lastError, verdict };
}

export const WEBHOOK_VERDICT_LABEL: Record<WebhookSummary["verdict"], string> = {
  ok: "Registered, buttons enabled",
  buttons_off: "Registered, but button clicks are not delivered",
  wrong_url: "Registered to a different address",
  not_registered: "Not registered",
};
