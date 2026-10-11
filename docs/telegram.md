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

4. Register the webhook once, from **Settings → Telegram → Register webhook
   (messages + buttons)** (owner only; calls `setWebhook` with the secret and
   `allowed_updates = ["message","callback_query"]`), or by hand (replace the
   placeholders; the secret must match the env var exactly):

   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<app>/api/telegram/webhook&secret_token=<SECRET>&allowed_updates=["message","callback_query"]
   ```

   `callback_query` is required for the inline buttons under [Orders] cards;
   Telegram keeps the last `allowed_updates` it was given, so an older
   registration with `["message"]` only silently drops every button press.
   **Check webhook** in Settings (`getWebhookInfo`, shown without secrets)
   reports the registered host, missing update types, the pending count and
   the last error.

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
   and stores `chat_id`, `chat_title`, `chat_type`, the Telegram **`user_id`**
   of the person who sent the command, `linked_at`, clearing the code so it
   is single-use. The user id is what authorises the order buttons later: in
   a group, only that account may press them.
4. `/status` reports the link state and whether the order buttons are enabled
   for the sender; `/stop` (or `/unsubscribe`) sets `enabled = false`.
   "Resume alerts" in Settings re-enables it; "Link a different chat" issues
   a new code and the next `/start` moves the link.

### Order buttons (inline keyboards)

[Orders] cards carry buttons (Send invoice, Check payment, Resend / Retry
e-mail, Done, View order). The full workflow is in
[orders-invoicing.md](orders-invoicing.md); the Telegram side in short:

- `callback_data` is signed and compact (`o|<action>|<22-char order id>|<expiry>|<HMAC>`,
  ≤ 64 bytes, key derived from the bot token, 30-day expiry). It names *what*
  to do to *which* order; amount, e-mail address and owner are resolved
  server-side from the order row, never from the button.
- `bot.on("callback_query:data")` → `authorizeOrderCallback` (signature,
  expiry, per-user rate limit, linked chat, presser = linked `user_id` or the
  private chat's own user, order owned by the link's owner) →
  `answerCallbackQuery` at once → the same service the dashboard uses →
  `editMessageText` with the order's current card and a fresh signed keyboard.
  Forged, expired, foreign-order or unauthorised presses get a toast and
  nothing else; stale presses (order paid or cancelled meanwhile) are refused
  and the card refreshed; repeats are idempotent.
- The delivery runner signs buttons at send time, stores the message id
  (`provider_message_id`), edits earlier cards (`edit_of`) and clears the
  buttons of superseded ones (`supersedes`), so a paid order never keeps a
  live "Send invoice". Tests: `tests/telegram-callbacks.test.ts`,
  `tests/telegram-order-callbacks.test.ts`, `tests/notifications/delivery-runner-cards.test.ts`.

The bot replies with short plain-text messages and never logs update bodies.

## Delivery: producers and the independent runner

Producing and sending are separate.

**Producers** only write rows to `photo_notification_deliveries` (one per
owner / channel / alert key — the `ON CONFLICT DO NOTHING` dedupe):

- *Match alerts* — `runTelegramNotifier` (`src/lib/notifications/telegram/notifier.ts`)
  runs after every persisted refresh, rebuilds the alert list with the same
  pure `buildAlerts` the in-app banners use, filters by the owner's enabled
  link and subscription kinds, and enqueues `GO_TO_MAT`, `ON_MAT`,
  `MAT_CHANGE`, `MOVED_EARLIER`, `MOVED_LATER`. Keys: `go:<matchId>`,
  `on-mat:<matchId>`, `hist:<change_type>:<match_id>:<old>><new>`.
- *Pre-match reminders* — `enqueueReminders` (`src/lib/notifications/reminders-run.ts`)
  runs on the runner's clock tick, not on captures: from the matches already
  stored it plans `REMIND_15` / `REMIND_5` (leads configurable with
  `TELEGRAM_REMINDER_MINUTES`, default `15,5`; each kind can be switched off
  per owner in Settings). Key: `remind:<lead>:<matchId>:<target rounded to 5 min>`,
  so a one-minute shuffle does not repeat a reminder and a real move produces
  one for the new time (honest at-least-once). Owner manual corrections count.
- *Operational incidents and recoveries* — `runIncidentNotifier` (grouped by
  owner / kind / event / source host, see "Operational alerts").
- *Orders* use the same table with the `orders` category: the intake's
  placed card, the invoice / sent / failed / exception cards written by the
  payment-link job and the e-mail runner's hooks, the paid card written by
  the payment webhook, and the fulfilled card ([orders-invoicing.md](orders-invoicing.md)).
  None of them blocks the operation that produced it: a Telegram outage
  delays cards, never order recording, payment verification or customer e-mail.

Every message carries a category prefix in its bold title: **[Match]**,
**[Orders]** or **[System]**.

**The runner** (`src/lib/notifications/delivery-runner.ts`) is the only thing
that calls `sendMessage`:

1. `photo_claim_notification_deliveries` atomically claims up to N due rows
   (`FOR UPDATE SKIP LOCKED`), marks them `sending`, counts the attempt and
   sets a 60 s lease. Due = `pending`/`failed` with `next_attempt_at <= now()`
   (null = terminal), or `sending` with an expired lease (a runner died).
2. Per owner it loads the enabled link once; rows whose owner has no enabled
   link are marked `skipped` (shown as **No linked chat** on /notifications,
   distinct from queued / delivered / failed).
3. Sends with >= 1.1 s spacing per chat. Outcomes: `sent`; transient
   (429 / 5xx / network) -> `pending` with backoff 30 s, 2 min, then `failed`
   after the third attempt (respecting `retry_after`); permanent 403 / "chat not
   found" -> `failed` and the link disabled; other 4xx -> `failed`.
4. On a 429 the batch stops and the rest of the claim is **released**
   (attempt uncounted, due again in 30 s).

It runs from two places, both bounded, neither a `setInterval` in a request
module:

- **`POST /api/cron/deliveries`** (`Authorization: Bearer <CRON_SECRET>`):
  plans reminders, then drains batches of 25 until nothing is due, a batch
  was rate limited, or 45 s passed. The Railway worker process ticks it every
  `DELIVERY_SECONDS` (default 30 when `SCHEDULE_SECONDS` is set; see
  `worker/src/scheduler.mjs`). Any other cron can call it; two overlapping
  runs are safe.
- **A per-owner kick** right after a user's own refresh enqueued rows
  (`limit 10`, same claim RPC), so a GO TO MAT leaves immediately instead of
  waiting for the next tick.

In tests (`NODE_ENV=test` / Vitest) and with `TELEGRAM_DRY_RUN=1` the default
sender never contacts Telegram: messages are logged by size and counted as
sent, so no production chat receives test traffic. There are no hard-coded
chat ids, topics or group ids anywhere; the only destination is the owner's
linked `chat_id`.

Tests: `tests/notifications/delivery-runner.test.ts` (claim, lease expiry,
backoff, release on 429, link disable, dry run), `tests/notifications/reminders.test.ts`,
`tests/api-cron-deliveries.test.ts`, `supabase/tests/deliveries_claim.test.sql`,
`worker/test/scheduler.test.mjs`.

A notifier error is logged (`notify.failed`) and never fails the refresh.

## Limitations

- Delivery needs the runner to tick: the Railway worker with `SCHEDULE_SECONDS`
  (and so `DELIVERY_SECONDS`) set, or another cron calling
  `/api/cron/deliveries`. Without it, only the per-owner kick after a user's
  own refresh sends anything, and retries / reminders wait.
- Reminders cover matches whose target time is known; a match with no time
  cannot be reminded.
- One linked chat per owner (the first link row). Group chats work as long as
  the bot is a member; privacy mode is irrelevant because only commands and
  button presses are read. In a group only the account that ran `/start CODE`
  may use the order buttons; a chat linked before user ids were recorded must
  be re-linked once (Settings says so).
- Per-event subscription rows are supported by the notifier and the
  `saveTelegramSubscription` action, but Settings exposes the global row only.
- Webhook mode requires a public HTTPS URL; long polling is not supported.
