# Telegram alerts

Optional channel that sends match alerts (GO TO MAT, ON MAT, mat change, moved
earlier / later) to a Telegram chat. It is off unless the server is configured,
and nothing in the watcher depends on it: when disabled, the grammY module is
never loaded and `/api/telegram/webhook` answers 404.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the token.
2. Pick a random webhook secret (for example `openssl rand -hex 24`).
3. Set the environment variables (Vercel → Project → Settings → Environment Variables, or `.env.local`):

   | Variable                  | Required | Notes                                                                 |
   | ------------------------- | -------- | --------------------------------------------------------------------- |
   | `TELEGRAM_ENABLED`        | yes      | `"1"` turns the channel on. Anything else keeps it off.               |
   | `TELEGRAM_BOT_TOKEN`      | yes      | BotFather token. Server-side only, never `NEXT_PUBLIC_`.              |
   | `TELEGRAM_WEBHOOK_SECRET` | yes      | At least 8 characters. Telegram echoes it on every webhook call.      |
   | `TELEGRAM_BOT_USERNAME`   | no       | Without `@`; shown as a link in the Settings instructions.            |

   The notifier runs inside refreshes, so the scheduled refresh
   (`CRON_SECRET` + `SUPABASE_SERVICE_ROLE_KEY`, see `.env.example`) is what
   delivers alerts while phones are locked.

4. Register the webhook once (replace the placeholders; the secret must match the env var exactly):

   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<app>/api/telegram/webhook&secret_token=<SECRET>&allowed_updates=["message"]
   ```

   `getWebhookInfo` on the same base URL shows the registered URL and the last error, if any.

5. Deploy. Settings now shows a **Telegram** card instead of "Not configured on the server".

## How linking works

The bot token never reaches the browser and chats are linked without sharing
phone numbers:

1. In **Settings → Telegram** the user taps **Generate link code**. A server
   action (`src/lib/actions/telegram.ts`, user client, RLS) stores an 8-character
   code on the owner's `photo_telegram_links` row with a 15-minute expiry and
   creates a default global subscription (`photo_notification_subscriptions`,
   `event_id` null, all five kinds).
2. The user opens the bot and sends `/start CODE`. Telegram POSTs the update to
   `/api/telegram/webhook`; the route checks `X-Telegram-Bot-Api-Secret-Token`
   (timing-safe) and hands the request to grammY's `webhookCallback(bot, "std/http")`.
3. The bot (`src/lib/notifications/telegram/bot.ts`, service-role client because
   there is no user session) looks the code up, rejects expired or unknown codes,
   and stores `chat_id`, `chat_title`, `linked_at`, clearing the code so it is
   single-use.
4. `/status` reports the link state; `/stop` (or `/unsubscribe`) sets
   `enabled = false`. "Resume alerts" in Settings re-enables it; "Link a
   different chat" issues a new code and the next `/start` moves the link.

The bot replies with short plain-text messages and never logs update bodies.

## Delivery and retries

`notifyAfterRefresh` (`src/lib/notifications/server.ts`) runs after every
persisted batch refresh, both from `POST /api/watch` (user client) and
`POST /api/cron/refresh` (service client). When Telegram is enabled it lazily
imports the notifier (`src/lib/notifications/telegram/notifier.ts`), which:

1. Rebuilds the alert list with the same pure `buildAlerts` the in-app banners
   use (ranked ETAs + the history rows produced by this refresh). Only
   `GO_TO_MAT`, `ON_MAT`, `MAT_CHANGE`, `MOVED_EARLIER` and `MOVED_LATER`
   (15+ minutes) are eligible; 30/15/5-minute thresholds stay in-app.
2. Groups alerts by owner, loads the owner's enabled link (`chat_id` set) and
   subscriptions. A per-event row wins over the global row for that event;
   kinds not in the row's `kinds` are dropped.
3. Inserts one `photo_notification_deliveries` row per alert with
   `ON CONFLICT DO NOTHING` on `(owner_id, channel, alert_key)`. The key is the
   alert id for ranked alerts (`go:<matchId>`, `on-mat:<matchId>`) and
   `hist:<change_type>:<match_id>:<old>><new>` for history-derived ones, so
   the same alert is never sent twice even across retries and concurrent
   refreshes. A status flip to `on_mat` shares the `on-mat:<matchId>` key.
4. Selects the due rows for that owner (`status in (pending, failed)`,
   `attempts < 3`, `next_attempt_at <= now`), claims each one by bumping
   `attempts` (a concurrent refresh that already bumped it skips the row) and
   sends it with `bot.api.sendMessage` (HTML: bold title, body, mat · time).
5. Marks the row `sent`, or on failure:
   - transient (429, 5xx, network): stays `pending` with `next_attempt_at`
     = now + 30 s, then 2 min (respecting `retry_after` on 429); after the
     third failed attempt it becomes `failed`. Due rows are picked up by the
     next refresh for that owner.
   - permanent (403 bot blocked, 400 chat not found): `failed` immediately and
     the link is disabled so no further messages are attempted; other 4xx
     (for example a malformed message) are `failed` without touching the link.

A notifier error is logged (`notify.failed`) and never fails the refresh.

## Limitations

- Alerts fire only when a refresh runs: a browser with the app open, or the
  cron route. There is no independent scheduler for notifications.
- Retries also piggyback on refreshes; with nothing refreshing, a transiently
  failed message waits until the next refresh for that owner.
- One linked chat per owner (the first link row). Group chats work as long as
  the bot is a member; privacy mode is irrelevant because only commands are read.
- Per-event subscription rows are supported by the notifier and the
  `saveTelegramSubscription` action, but Settings exposes the global row only.
- Webhook mode requires a public HTTPS URL; long polling is not supported.
