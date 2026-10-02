import { timingSafeEqual } from "node:crypto";
import { webhookCallback } from "grammy";
import { requestLogger } from "@/lib/log";
import { isTelegramEnabled, telegramWebhookSecret } from "@/lib/notifications/telegram/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/telegram/webhook
 *
 * Receives Telegram updates for the linking bot (/start CODE, /stop, /status).
 * Registered once with setWebhook (see docs/telegram.md) using a secret token
 * that Telegram echoes in `X-Telegram-Bot-Api-Secret-Token`; anything without
 * the exact secret is rejected before the body is read. When the feature is
 * off the route does not exist (404).
 */
type Handler = (request: Request) => Promise<Response>;
let handler: Handler | null = null;

async function getHandler(): Promise<Handler> {
  if (!handler) {
    const { getBot } = await import("@/lib/notifications/telegram/bot");
    handler = webhookCallback(getBot(), "std/http", { timeoutMilliseconds: 20_000, onTimeout: "return" });
  }
  return handler;
}

export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/telegram/webhook");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };

  if (!isTelegramEnabled()) return new Response(null, { status: 404, headers });
  const secret = telegramWebhookSecret();
  if (!secret) {
    log.error("telegram.webhook.no_secret");
    return new Response(null, { status: 404, headers });
  }
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    log.warn("telegram.webhook.unauthorized");
    return new Response(null, { status: 401, headers });
  }

  try {
    const res = await (await getHandler())(request);
    // Telegram only needs a 2xx; keep our correlation headers on the way out.
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  } catch (err) {
    // Update bodies are never logged: they carry chat ids and names.
    log.error("telegram.webhook.failed", { error: err instanceof Error ? err.message : String(err) });
    return new Response(null, { status: 500, headers });
  }
}

function secretMatches(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
