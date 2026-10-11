# Photo-order payment links (orders → invoice → e-mail → Telegram)

How a gallery order that is paid to the photographer directly turns into a
private payment page, a provider payment request and one e-mail to the buyer,
with Telegram as the owner's control panel. Everything here is server-side;
amounts, e-mail addresses and ownership are always read from the order row,
never from a button, a browser or a redirect.

```
Pic-Time order ──Zapier──▶ POST /api/orders/intake ──▶ photo_orders row + [Orders] card
                                                   │
                        plan (eligibility.ts)  ────┤── skip (paid / card / free / cancelled / refunded)
                                                   ├── exception (no e-mail, unknown method, payments off)
                                                   ├── review  → card with [Send invoice]
                                                   └── auto    → invoice_requested_at stamped ("auto")
                                                                      │
   durable queue ─ /api/cron/payments ─ Send invoice (web / Telegram) ─┤  processOrderInvoice
                                                                      ▼
                1. mint private link  /pay/order/<bbo_token>  (once; token hash on the row)
                2. provider invoice   SendPayment, CustomerReference = order id (claimed; relinked if an earlier run died)
                3. ONE e-mail per send count  ORDER_PAYMENT_LINK  → outbox (channel email)
                4. owner card  [Orders] "Payment link queued"  (edits / supersedes earlier cards)
                                                                      │
   buyer pays on the hosted page ─▶ signed webhook / Check payment / return visit ─▶ verified paid
                                   ─▶ ledger row, receipt e-mail, "Paid" card with [Done]
```

## Modes

Chosen by the owner in **Settings → Photo-order payment links** and stored on
`photo_studio.settings.orderInvoicing = { mode, autoSince, changedAt }`:

| Mode | What happens to a new order |
| --- | --- |
| **Review** (default) | Recorded and shown in Telegram and under Orders with **Send invoice**. Nothing is e-mailed until the owner presses it. |
| **Automatic** | An *eligible* order received **after `autoSince`** gets its payment link, invoice and e-mail without anyone pressing anything. Everything else behaves like Review. |

Switching to Automatic stamps `autoSince = now`. **Orders received before that
moment are never billed by the switch** (they show "not sent automatically,
older than the activation time" with a Send invoice button). Switching to
Review and back resets the activation time to now.

Three server switches gate the automatic path and are shown as on/off in the
same card (never their values):

| Variable | Effect |
| --- | --- |
| `PAYMENTS_MYFATOORAH_ENABLED=1` + `MYFATOORAH_API_KEY` + `MYFATOORAH_WEBHOOK_SECRET` | Online payments exist at all. Off → no link can be created; Automatic mode records orders as exceptions (`payments_off`). |
| `PAYMENTS_AUTO_INVOICE_ENABLED=1` | Master switch for Automatic mode. Off → Automatic behaves like Review (`auto_off`). |
| `EMAIL_ENABLED=1` + `RESEND_API_KEY` + `EMAIL_FROM` | The payment-link e-mail is actually sent. Off → the queued row waits; nothing is lost and nothing is invented. |

## Eligibility (`src/lib/orders/eligibility.ts`, pure, pinned by `tests/orders-eligibility.test.ts`)

`planInvoice(order, ctx)` runs at intake and again inside the job before
anything is billed. In order:

1. **Hard blockers** (`invoiceBlocker`, apply to the owner's buttons too):
   cancelled → `cancelled`; `payment_state` refunded → `refunded`; paid →
   `paid`; amount ≤ 0 → `free`; `payment_method = card` → `card` (settled in
   the gallery; a link would ask the buyer to pay twice).
2. Already requested → `already_requested`.
3. Method not collected by the photographer (`photographer`, `fawran`,
   `bank_transfer`, `cash` are) → exception `unknown_method`.
4. Missing or invalid buyer e-mail → exception `no_email` / `invalid_email`
   (the link and invoice are still created so the owner can share the link
   by hand; the exception is on the card and the order page).
5. Mode review → review; `PAYMENTS_AUTO_INVOICE_ENABLED` off → review
   (`auto_off`); payments off → exception `payments_off`; no `autoSince` →
   review (`not_activated`); `received_at` (else `created_at`) before
   `autoSince` → review (`historical`); otherwise **auto**.

Existing clients are eligible like anyone else: the only question is whether
money is outstanding. The historical **240 QAR order is `paid` and is refused
by rule 1 in every mode**; the three zero-amount sample orders are `free`.
"approved" from Pic-Time is a *reported* state and never counts as a receipt.

## The durable queue and the job (`src/lib/orders/payment-link.ts`)

The queue is the order row itself:

| Column | Meaning |
| --- | --- |
| `invoice_requested_at` / `_by` | The request, stamped once (`auto`, `owner:<uid>`, `telegram:<user id>`). The runner only ever looks at requested rows. |
| `invoice_job_leased_until` | 90 s lease so overlapping runners (cron tick, intake kick, a button) never work the same order twice. |
| `invoice_job_attempts`, `invoice_next_attempt_at`, `invoice_job_error` | Provider failures back off 1 min → 5 min → 30 min → 2 h; after 4 the order lands in the exception queue (`provider_failed`). |
| `invoice_completed_at` | Terminal: queued e-mail, exception, or skipped (a blocker appeared meanwhile, e.g. paid by hand). |
| `pay_token_hash`, `pay_token_created_at`, `payment_url` | The private page. Minted once; `payment_url` is **our** page, the provider's hosted URL lives in `metadata.invoice.provider_payment_url`. |
| `invoice_email_state` (`none` / `queued` / `sent` / `failed` / `exception`), `invoice_email_count`, `invoice_email_updated_at` | E-mail lifecycle; one e-mail per count, so a resend is count 2. |
| `invoice_exception` | Why the owner must look (`no_email`, `invalid_email`, `unknown_method`, `payments_off`, `email_disabled`, `provider_failed`). |

`processOrderInvoice(orderId)` is safe to call repeatedly and concurrently:
re-checks the blockers, takes the lease, mints the token only if
`pay_token_hash` is null (conditional update), creates the provider invoice
through `createInvoiceForOrder` (claim + stale-claim relink by
CustomerReference = order id, see `docs/payments.md`), queues the e-mail with
alert key `email:order:<id>:payment-link:<count>` (the outbox's unique key
makes a second attempt a no-op) and writes the owner card. The intake route
runs it once right after recording an automatic order (8 s provider timeout,
inside the request's budget) and `POST /api/cron/payments` runs the backlog
every tick (limit 10, 20 s budget). **Nothing runs after the HTTP response**;
anything the kick did not finish is picked up by the cron.

Owner actions, shared by the order page and the Telegram buttons:

- **Send invoice** `sendOrderInvoiceNow`: stamp the request (idempotent) and
  run the job now. A repeat press finds the job done and says so; after an
  exception it re-opens the job with a fresh attempt budget.
- **Resend / Retry e-mail** `resendOrderInvoiceEmail`: another e-mail with
  the **same** link and invoice, count + 1. Never a second invoice.
- **Check payment** `checkOrderPaymentNow`: `GetPaymentStatus` on the order's
  invoice, applied with the webhook's rules (below).
- **Done** `fulfillOrder`: records `status = fulfilled`, `fulfilled_at`.
  There is no Pic-Time API or Zapier action to release purchased photos or to
  mark an order paid (checked against Pic-Time's Zapier listing and help
  centre), so photo delivery is **not** automatic: the owner releases the
  photos in the gallery and presses Done.

Every action is audited (`photo_audit_log`, entity `order`, actions
`order.invoice_requested`, `order.pay_link_created`, `order.invoice_created`,
`order.invoice_email_queued`, `order.invoice_email_sent`, `order.invoice_exception`,
`order.invoice_retried`, `order.payment_checked`, `order.paid`, `order.fulfilled`,
`order.test_created`, `orders.invoicing_mode`) with the actor (`via`,
Telegram user id) but never the token, the e-mail body or the provider secrets.

## The private payment page (`/pay/order/<token>`)

- Token: `bbo_` + 40 random alphanumerics; only its SHA-256 is stored
  (`pay_token_hash`, unique). Unguessable; expires with the invoice (30 days)
  unless the order is paid.
- Shows: the order reference, the gallery name, the items (name and
  quantity), the amount and currency from the row, the verified state, and
  **Pay online** (opens the provider's hosted page). Copy says "Online
  payment" / "Private gallery"; no provider name, database id or e-mail.
- Disabled when paid, refunded, cancelled, expired or payments off.
- Pay online (`startOrderHostedPayment`): asks the provider about the current
  invoice first. Already paid → the order is marked paid (same rules as the
  webhook) and the page shows it; cancelled / expired at the provider → the
  invoice is superseded (`metadata.superseded_invoices`) and a fresh one
  created; otherwise the existing hosted URL is reused. Never two live
  invoices for one order.
- The return visit (`verifyReturnedOrderPayment`) asks the provider about the
  returned payment id; the answer must name **this order's** invoice (or one
  it superseded) and the exact amount and currency, then the same atomic
  transition is applied. The redirect itself proves nothing.

## Verification (webhook, Check payment, return visit)

`applyStatusToOrder` in `src/lib/payments/myfatoorah/webhook.ts` is the single
place an order becomes paid:

- The webhook signature must verify (unverified events are stored, never applied).
- The event must map to the order: by `provider_invoice_id`, or (paid events
  only) by `ExternalIdentifier = order id` **and** the invoice in the order's
  superseded list.
- Amount must equal the order's total within 0.01 and the currency must
  match, otherwise `amount_mismatch`: recorded in `metadata.payment_mismatch`,
  an `[System]` alert to the owner, the order stays unpaid (`tests/payments/webhook-order.test.ts`).
- Transitions: `pending|unknown → paid|failed`, `failed → paid`, `paid →
  refunded`; paid never regresses; the update is conditional on the state the
  row was read in; duplicates (`provider_event_id`) and out-of-order deliveries
  are no-ops; an unmatched event is replayed by the payments cron.
- First transition to paid: `photo_payment_records` row (provider, payment id
  unique), customer receipt e-mail `ORDER_PAYMENT_RECEIVED`
  (`email:order:<id>:paid`), owner **Paid** card
  (`order-payment:<id>:paid`) that supersedes the earlier cards, audit `order.paid`.
  Each exactly once.
- Reconciliation (`PAYMENTS_RECONCILE_ENABLED=1`): unpaid invoiced orders are
  re-checked at most every 30 minutes for 31 days.

## Telegram cards and buttons (`src/lib/orders/cards.ts`, `src/lib/notifications/telegram/order-callbacks.ts`)

```
[Orders] New photo order — <buyer>
Order <reference>
Buyer: <name>
Gallery: <gallery>
Amount: 240.00 QAR
Payment: Not yet paid (paid to you directly, Fawran)
Invoice: waiting for you. Tap Send invoice to e-mail the payment link.
[Send invoice]  [View order]
```

| Card (alert key) | When | Buttons |
| --- | --- | --- |
| placed `order:<source>:<ref>` | intake | Send invoice (review) / none (auto) + View order |
| invoice `order:<id>:invoice:<n>` | e-mail n queued | Check payment, Resend e-mail, View order |
| invoice-sent `order:<id>:invoice-sent:<n>` | e-mail n delivered (edits the invoice card) | same |
| invoice-failed / exception `order:<id>:invoice-failed:<n>`, `order:<id>:exception:<reason>:<n>` | needs the owner | Send invoice or Retry e-mail, View order |
| paid `order-payment:<id>:paid` | verified payment (supersedes the cards above: their buttons are cleared) | Done, View order |
| fulfilled `order:<id>:fulfilled` | Done pressed (edits the paid card) | View order |

Mechanics (`src/lib/notifications/delivery-runner.ts`,
`tests/notifications/delivery-runner-cards.test.ts`):

- A producer stores `buttons`, `order_id`, `edit_of` and `supersedes` in the
  delivery payload. The runner signs action buttons **at send time** for that
  order (`callback_data` = `o|<action>|<22-char order id>|<expiry>|<HMAC16>`,
  ≤ 64 bytes, key derived from the bot token, 30-day expiry), stores the
  Telegram `message_id` (`provider_message_id`), edits the message of
  `edit_of` when known (falls back to a new message), and clears the buttons
  under superseded cards (best effort).
- A press: the webhook route verifies `X-Telegram-Bot-Api-Secret-Token`;
  `authorizeOrderCallback` verifies the HMAC and expiry, rate-limits the
  presser, loads the link by chat id, requires the presser to be the linked
  user (`photo_telegram_links.user_id`; in a private chat linked before user
  ids were recorded, the chat's own user), and checks the order belongs to
  the link's owner. Then `answerCallbackQuery` immediately ("Invoice queued…"),
  the shared service runs, and the message is edited to the order's current
  card with a one-line result. Stale presses (order paid or cancelled
  meanwhile) are refused with an honest answer and the card is refreshed.
  Repeated presses are idempotent (`tests/telegram-order-callbacks.test.ts`).
- Delivery is **confirmed in two steps**: "queued" the moment the e-mail row
  exists, "sent" only after the e-mail runner's `onSent` hook (so a Telegram
  outage never blocks the e-mail, and the card never claims a delivery that
  did not happen). A Telegram outage also never blocks recording the order,
  verifying a payment or e-mailing the buyer: cards are outbox rows with
  their own retries.

### Webhook registration

Telegram keeps the `allowed_updates` list from the **last** `setWebhook`
call. A registration made before the buttons existed delivers `message` only
and silently drops every click. Register (or re-register) from **Settings →
Telegram → Register webhook (messages + buttons)**, which calls `setWebhook`
with `url = <NEXT_PUBLIC_SITE_URL>/api/telegram/webhook`, `secret_token =
TELEGRAM_WEBHOOK_SECRET`, `allowed_updates = ["message","callback_query"]`,
then **Check webhook** (`getWebhookInfo`, shown without secrets: URL match,
missing update types, pending count, last error). By hand:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<site>/api/telegram/webhook&secret_token=<SECRET>&allowed_updates=["message","callback_query"]
```

A chat linked before user ids were stored shows "re-link to enable the
buttons" in Settings: generate a code and send `/start CODE` again from your
own account (the chat stays the same).

## Settings, dashboard and test orders

- **Settings → Photo-order payment links**: mode (Review / Automatic),
  activation time, the server switches as on/off, the invoice queue (waiting,
  exceptions, e-mail failed) and the last `payments` / `deliveries` runner
  ticks (`photo_job_heartbeats`, written by the two cron routes). A runner
  older than 30 minutes is flagged.
- **Orders** list: invoicing chips (Invoice not sent / queued / Payment link
  e-mailed / E-mail failed / Attention: … / Paid online), a **Needs
  attention** filter, and the same three status cards.
- **Order page → Payment link card**: every state the Telegram card can show,
  the private link with Copy, Send invoice / Resend / Retry e-mail / Check
  payment / Done. "Paid by hand" (offline confirmation) and Cancel stay in the
  Payment card. Collaborators never see any of it (owner-only RLS).
- **Notifications**: deliveries read "No linked chat" (not "Skipped") when the
  owner has no enabled Telegram link; e-mail rows show queued / sent / failed.
- **Test orders**: the Settings card can create an order marked **Test**
  (`source = test`, reference `TEST-<timestamp>`, method photographer) for an
  e-mail address you control, running the normal flow. Allowed only when the
  payment service is in **sandbox** (`MYFATOORAH_BASE_URL` = apitest) or
  `ORDERS_TEST_ORDERS_ENABLED=1`. Historical customers are never used.

## Activation checklist

1. Apply `supabase/migrations/20261011120000_order_invoicing.sql` (additive:
   new `photo_orders` columns, `photo_job_heartbeats`, `photo_telegram_links.user_id
   / chat_type`, `photo_notification_deliveries.provider_message_id`, updated
   `photo_record_order`).
2. Vercel env: `PAYMENTS_MYFATOORAH_ENABLED=1`, `MYFATOORAH_API_KEY`,
   `MYFATOORAH_WEBHOOK_SECRET`, `MYFATOORAH_BASE_URL` (sandbox first),
   `PAYMENTS_AUTO_INVOICE_ENABLED=1`, `PAYMENTS_RECONCILE_ENABLED=1`,
   `EMAIL_ENABLED=1`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
   `TELEGRAM_ENABLED=1`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
   `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ORDERS_INTAKE_ENABLED=1`.
3. Railway worker env: `APP_URL`, `CRON_SECRET`, `DELIVERY_SECONDS=30`,
   `PAYMENTS_SECONDS=60`. The worker only *calls* `/api/cron/deliveries` and
   `/api/cron/payments`; the jobs run in Vercel, so **no Telegram, Resend or
   MyFatoorah credential belongs on Railway**. `GET /status` on the worker and
   the Settings card show the ticks without secrets.
4. Settings → Telegram: Register webhook, Check webhook (expect "Registered,
   buttons enabled"); re-link with `/start CODE` if the card asks for it.
5. Settings → Photo-order payment links: create a **test order** to your own
   address in sandbox; expect the Telegram card, the e-mail, the private page,
   a sandbox card payment, the Paid card, the receipt. Press Done.
6. Switch the mode to **Automatic** (stamps the activation time). Orders
   received from that moment that pass the eligibility rules are billed by
   themselves; everything older waits for Send invoice.
7. Move `MYFATOORAH_BASE_URL` to production only after the sandbox pass and
   the owner's approval; repeat step 5 with a small real amount.

## What stays manual or dependent on third parties

- **Zapier delivering the order** at all. The intake accepts manual and Zap
  POSTs identically; the backend cannot repair or verify a Zap trigger
  subscription. If the Zap does not fire, nothing here runs; the Orders page
  shows the last credential use time.
- **Releasing the purchased photos** in the gallery (no documented API).
- **Marking the order paid in Pic-Time** (no documented API / Zap action).
- A buyer with **no e-mail address** on the order (exception; share the link).

## Tests

`tests/orders-eligibility.test.ts`, `tests/orders-payment-link.test.ts`,
`tests/telegram-callbacks.test.ts`, `tests/telegram-order-callbacks.test.ts`,
`tests/payments/order-pay.test.ts`, `tests/payments/webhook-order.test.ts`,
`tests/payments/cron-route.test.ts`, `tests/api-orders-intake.test.ts`,
`tests/notifications/delivery-runner-cards.test.ts`, `tests/email-outbox.test.ts`,
and the existing match-alert / reminder / incident suites (unchanged behaviour).
