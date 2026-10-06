# Payments (MyFatoorah) — prepared, not live

This document describes the MyFatoorah groundwork that ships behind a feature
flag. It sits entirely outside the Tournament Watcher's critical path: nothing
here runs on the refresh loop, the watcher pages, or the cron endpoint.

## What exists

| Piece | Path |
| --- | --- |
| Booking state machine | `src/lib/payments/types.ts` |
| Env / flag / base URLs | `src/lib/payments/config.ts` |
| Webhook signature verification | `src/lib/payments/myfatoorah/signature.ts` |
| Provider adapter (`SendPayment`, `GetPaymentStatus`) | `src/lib/payments/myfatoorah/client.ts` |
| Webhook processing + reconciliation | `src/lib/payments/myfatoorah/webhook.ts` |
| Webhook route | `src/app/api/payments/myfatoorah/webhook/route.ts` → `POST /api/payments/myfatoorah/webhook` |
| Tests (no network, in-memory Supabase fake) | `tests/payments/*.test.ts` |

Database (already live, see `supabase/migrations/20261002150000_watcher_v2.sql`):
`photo_bookings` (status + provider invoice id + timestamps), `photo_payment_attempts`
(one row per provider payment / refund / dispute id), `photo_payment_events`
(one row per webhook delivery, unique on `provider_event_id`).

## What is NOT implemented (on purpose)

- No checkout UI, no "Pay" button, no booking form. `createInvoice` exists but
  nothing calls it yet.
- No invoice/receipt generation, no e-mails.
- No Pic-Time integration (`photo_orders` is untouched).
- No refund API call (`PaymentProvider.refund` is declared optional and not
  implemented).
- No automatic fulfilment: approving the order in Pic-Time after payment is a
  **manual step** — see "Fulfilment (shipped disabled)".
- **No automatic client creation.** See the rule at the bottom.

## Environment variables

All server-only; never prefix with `NEXT_PUBLIC_`. Templates are in `.env.example`.

| Variable | Meaning |
| --- | --- |
| `PAYMENTS_MYFATOORAH_ENABLED` | `"1"` turns the feature on. Anything else = off. |
| `MYFATOORAH_API_KEY` | Bearer token. Portal → Integration Settings → API Key → Add. (docs: https://docs.myfatoorah.com/docs/api-key) |
| `MYFATOORAH_WEBHOOK_SECRET` | Webhook secret key from Portal → Integration Settings → Webhook Settings (enable the secure key). |
| `MYFATOORAH_BASE_URL` | Defaults to the test base `https://apitest.myfatoorah.com`. Production for the Qatar account is `https://api-qa.myfatoorah.com` (Kuwait/Bahrain/Jordan/Oman: `https://api.myfatoorah.com`, Saudi: `https://api-sa…`, UAE: `https://api-ae…`, Egypt: `https://api-eg…`). |

`isPaymentsEnabled()` is true only when the flag is `"1"` **and** both secrets
are non-empty. While it is false the webhook route answers **404** for every
request, so the endpoint is not even discoverable. Test portal:
https://demo.myfatoorah.com/ (MyFatoorah publishes a public test token on the
API-key docs page; keep it out of git anyway).

## Registering the webhook in the MyFatoorah portal

Per https://docs.myfatoorah.com/docs/webhook-information and
https://docs.myfatoorah.com/docs/webhook-v2:

1. Log in to the portal → **Integration Settings → Webhook Settings**.
2. Enable the webhook feature.
3. Endpoint URL: `https://<your-domain>/api/payments/myfatoorah/webhook` (HTTPS
   with a valid certificate is required).
4. Select event types. Subscribe **only** to `PAYMENT_STATUS_CHANGED`,
   `REFUND_STATUS_CHANGED` and `DISPUTE_STATUS_CHANGED`. The other V2 events
   (balance transferred, supplier, recurring) have no signature field list in
   our verifier and would be answered 401.
5. Choose **Webhook V2** and configure retries (max 5, max 180 s delay). The
   secret key is mandatory in V2; enable it and copy it to
   `MYFATOORAH_WEBHOOK_SECRET`.
6. Save.

Missed deliveries can be listed afterwards with `POST /v2/GetWebhooks`
(https://docs.myfatoorah.com/docs/getwebhooks): filter by `Start`/`End`,
`EventType`, `Status` (`Waiting` / `Running` / `Succeeded` / `Failed`) or by
`KeyType: "InvoiceId" | "CustomerReference" | "WebhookReference"` + `Key[]`.
Each item carries the original `Data` payload and the `Signature`, so a
missed event can be replayed through `processWebhook` or, simpler, the booking
can be reconciled with `reconcileBooking`.

## Signature verification (as implemented)

Source: https://docs.myfatoorah.com/docs/webhook-signature plus the "Webhook
Signature" section of each data model page.

1. Determine the event from `Event.Name` (fallback `Event.Code`).
2. Take **only** the documented properties, in the documented order, read
   from `Data` (dotted = nested path):
   - `PAYMENT_STATUS_CHANGED`: `Invoice.Id, Invoice.Status, Transaction.Status, Transaction.PaymentId, Invoice.ExternalIdentifier`
   - `REFUND_STATUS_CHANGED`: `Refund.Id, Refund.Status, Amount.ValueInBaseCurrency, ReferencedInvoice.Id`
   - `DISPUTE_STATUS_CHANGED`: `Dispute.DisputeTransactionId, Dispute.Status, Invoice.Id, Invoice.Status, Transaction.Status, Transaction.PaymentId, Invoice.ExternalIdentifier`
   All other fields (card, customer, amounts beyond the listed one, …) are
   excluded from the signed string.
3. Join as `key=value,key2=value2` (comma, no spaces). Null/missing → empty
   value (`Transaction.PaymentId=`).
4. UTF-8 encode; HMAC-SHA256 with the webhook secret; **base64** the raw digest.
5. Compare with the `MyFatoorah-Signature` header using a constant-time
   comparison (`timingSafeEqual`; a different length is a mismatch).

The route reads the raw body text once, parses it, verifies, then processes.
A bad/missing header or an unsupported event → **401** (and the delivery is
still recorded with `signature_valid=false`, `processing_result='invalid_signature'`).

## Idempotency and state transitions

- Every delivery is inserted into `photo_payment_events` keyed by
  `(provider, provider_event_id)` where `provider_event_id = Event.Reference`
  (unique per webhook per the docs). If it is absent, a SHA-256 of
  `event type | signed field string | Event.CreationDate` is used.
- The unique index is partial, which PostgREST `upsert` cannot target, so the
  primitive is insert → on `23505` bump `attempts` and return `duplicate`
  without re-applying anything. The route answers **200** for `duplicate`, so
  MyFatoorah stops retrying.
- Status mapping:
  - `PAYMENT_STATUS_CHANGED` → `Transaction.Status` `SUCCESS→paid`,
    `FAILED→failed`, `CANCELED→cancelled`, `AUTHORIZE→ignored`.
  - `REFUND_STATUS_CHANGED` → `Refund.Status` `REFUNDED→refunded`,
    `CANCELED→ignored`; invoice = `ReferencedInvoice.Id`.
  - `DISPUTE_STATUS_CHANGED` → `Dispute.Status` `PENDING→disputed`,
    `RESOLVED→paid`, `LOST→refunded` (verify against real disputes before
    relying on this; adjust `mapWebhookEvent`).
- The booking is found by `(provider, provider_invoice_id)`; unknown invoice →
  `booking_not_found` (200).
- Transitions go through `canTransition` / `applyTransition`:
  `pending→paid|failed|cancelled`, `paid→refunded|disputed`,
  `disputed→refunded|paid`, `failed→pending`; `refunded` and `cancelled` are
  terminal. Illegal jumps are stored as `ignored_transition:<from>-><to>` and
  answered 200; a repeat of the current status is `unchanged` (the docs warn
  two events may arrive for one transaction).
- The booking update is guarded with `.eq("status", previous)` so a concurrent
  writer cannot be clobbered.
- One `photo_payment_attempts` row is written per provider payment id
  (`refund:<id>` / `dispute:<id>:<status>` for the other events); a duplicate
  id is ignored.
- Route status codes: 200 processed/duplicate/ignored/unchanged/not-found,
  400 malformed JSON, 401 signature, 404 flag off, 413 body over 64 KB,
  429 rate limit (120/min **per client IP**, so one abusive source cannot
  starve the provider's genuine deliveries), 503 service client not configured,
  500 only if the delivery row could not be written (so MyFatoorah retries).
- Pre-activation hardening: the body is capped at 64 KB before it is read, and
  an **unverified** delivery (bad/missing signature) stores only a SHA-256 hash
  and byte count as evidence — never the raw attacker-controlled blob. A later
  real, signed copy upgrades the row to the full body.
- Logs (`src/lib/log.ts`) carry result, event id/type, booking id and the
  signature verdict; never the payload, header or secrets.

## Reconciliation

`reconcileBooking(bookingId, provider, deps)` loads the booking, calls
`GetPaymentStatus` with `KeyType: "InvoiceId"`, maps the inquiry
(`InvoiceStatus Paid→paid`, `Canceled→cancelled`, `Pending` + only failed
transactions → `failed`, otherwise no-op) and applies the same transition rules
and attempt-row write as the webhook. It is safe to run on a schedule or by
hand; use it for `Failed` webhooks listed by `GetWebhooks`, or as the
belt-and-braces check the docs recommend ("rely on both the webhook and
GetPaymentStatus").

`reconcilePendingBookings` and `replayUnmatchedEvents` are both bounded in age
(default 14 days): an invoice a customer never pays stops being polled past the
window (the owner reconciles it by hand), and a verified event still unmatched
past the window is retired to `processing_result='abandoned'` so it is not
re-scanned every tick. Without this an abandoned invoice would cost one provider
call, and an unmatchable event one lookup, on every run forever.

## Phase F: regressions, atomic state, confirmation job, fulfilment

### Regressions pinned by `tests/payments/regressions.test.ts`

| Case | Behaviour |
| --- | --- |
| Invalid-before-valid | An unsigned copy of an event is recorded as `invalid_signature`; when the real, signed delivery with the same `Event.Reference` arrives it **takes the row over** (`signature_valid=true`, `attempts+1`) and is processed. A further unsigned copy is a plain duplicate. |
| Failed-then-success | `failed → paid` is a legal transition (the customer retried the same invoice; MyFatoorah sends SUCCESS directly). Both attempts are recorded. |
| Late failure after paid | `paid → failed` is illegal: an out-of-order FAILED is stored as `ignored_transition:paid->failed`, `paid_at` untouched, no attempt row, no notification. |
| Signature validity ≠ paid | A correctly signed event whose `Transaction.Status` is FAILED marks the booking `failed`, never `paid`, and enqueues nothing. |
| Invoice not associated | A verified event for an unknown invoice is kept as `booking_not_found`; the confirmation job (`replayUnmatchedEvents`) applies it once a booking with that invoice exists. |
| Isolation | An event for owner B's invoice changes only B's booking; attempt, event and outbox rows carry B's `owner_id`; A's booking is untouched. |

### Atomic state

`photo_apply_payment_transition` (`supabase/migrations/20261004050000_payment_transition_rpc.sql`,
SECURITY DEFINER, service role only) applies, in ONE transaction, guarded by
the expected previous status: the booking columns from `applyTransition`,
the `photo_payment_attempts` row (unique per provider payment id), the
`photo_payment_events` outcome, and — on `paid` — the owner's **[Orders]
Payment confirmed** row in `photo_notification_deliveries`
(key `payment:<bookingId>:paid`), delivered by the independent runner
(`docs/telegram.md`). A concurrent writer wins (`applied=false`,
`concurrent_update`) and the delivery is reported as an ignored transition.

### Confirmation job

`POST /api/cron/payments` (`Authorization: Bearer <CRON_SECRET>`, dark while
`PAYMENTS_MYFATOORAH_ENABLED` is off):

1. `replayUnmatchedEvents` — re-applies verified `booking_not_found` events
   (no provider call), bounded to 50 per run.
2. Only with **`PAYMENTS_RECONCILE_ENABLED=1`**: `reconcilePendingBookings`
   asks `GetPaymentStatus` about bookings still `pending` / `failed` 10+
   minutes after creation (25 per run). Off by default so nothing calls the
   provider before activation.

Tick it from the Railway worker with `PAYMENTS_SECONDS=300` (same APP_URL /
CRON_SECRET as the other loops), or any cron.

### Fulfilment (shipped disabled)

`src/lib/payments/fulfillment.ts`: `isFulfillmentAvailable()` is hard-coded
`false` and `fulfillmentProvider()` returns `null`. **Dependency:** a
verified Pic-Time order-approval integration (API or Zapier action) for this
account — none has been verified. Until then a paid booking is flagged
`metadata.fulfillment = { state: "manual", dependency }` and the owner's
confirmation message says "Approve the order in Pic-Time by hand". No env
flag can switch automatic fulfilment on; it needs code (a provider) plus a
verified test order.

### Activation procedure (production payments stay OFF until this is done)

1. **Test portal first.** In Vercel *Preview* (not Production) set
   `PAYMENTS_MYFATOORAH_ENABLED=1`, `MYFATOORAH_API_KEY=<test token>`,
   `MYFATOORAH_WEBHOOK_SECRET=<test secret>`, `MYFATOORAH_BASE_URL=https://apitest.myfatoorah.com`.
   Register the preview URL as the V2 webhook in the demo portal (events:
   payment status, refund status, dispute status; secure key on).
2. Create a test booking row with the invoice id from `SendPayment`, pay it
   with a MyFatoorah test card, and check: `photo_payment_events` has the
   delivery with `signature_valid=true`, `processing_result=processed`; the
   booking is `paid` with `paid_at`; an attempt row exists; the owner's
   Telegram received **[Orders] Payment confirmed** (via the delivery
   runner). Re-send the webhook from the portal: `duplicate`. Refund it:
   `refunded`.
3. Run `POST /api/cron/payments` by hand with the cron secret;
   then set `PAYMENTS_RECONCILE_ENABLED=1` on the preview and run it again
   with a deliberately unpaid invoice to see `reconcile.scanned`.
4. Only after 1–3 pass: switch **Production** env to the live key, the live
   secret and `MYFATOORAH_BASE_URL=https://api-qa.myfatoorah.com`, register
   the production webhook URL, and set `PAYMENTS_MYFATOORAH_ENABLED=1` last.
   Add `PAYMENTS_SECONDS=300` to the Railway worker to run the confirmation
   job. Charges and customer-facing payment links still need a checkout flow,
   which does not exist yet — activation here only makes the app able to
   *observe* payments correctly.

### Rollback

Set `PAYMENTS_MYFATOORAH_ENABLED=0` (webhook and cron answer 404 within one
deploy; MyFatoorah retries up to 5 times and then lists misses in
`GetWebhooks` for later replay through `processWebhook` / reconciliation).
Remove `PAYMENTS_SECONDS` from the worker. The migration is additive and can
stay; no data is deleted.

## Rule: paid bookings never auto-create clients

A paid booking **must not** create a `photo_athletes` row (a tracked client in
the watcher). `linkBookingToAthlete` in `webhook.ts` is a deliberate stub: it
only sets `photo_bookings.metadata.pending_athlete_link = true` so the
photographer can link the booking to an athlete by hand. This is enforced by
the test "NEVER creates a photo_athletes row from a paid booking".

Only after webhook processing has been observed working in production
(signatures verified, duplicates handled, statuses matching the portal) should
that boundary be replaced with a real link, and even then it should link to an
existing athlete the owner chose rather than inventing one from booking text.

## Cross-check against the official PHP library

Compared on 2026-10-02 with [my-fatoorah/library](https://github.com/my-fatoorah/library) (`MyFatoorahWebhook.php`, `MyFatoorahHelper.php`, `MyFatoorahPaymentStatus.php`, `mf-config.json`) and [my-fatoorah/omnipay-myfatoorah](https://github.com/my-fatoorah/omnipay-myfatoorah):

- **Signature**: identical for Webhook V2 codes 1 (payment status) and 2 (refund): same field lists and order, `key=value` joined with commas, HMAC-SHA256 raw digest, base64, constant-time compare. The library additionally verifies codes 3-5 (balance transferred, supplier, recurring) and V1 signatures; this adapter answers 401 for those (do not subscribe to them) and requires the `MyFatoorah-Webhook-Version` header to be absent or `v2`.
- **Status words**: the library maps webhook `CANCELED` to "Expired"; this adapter maps it to the booking status `cancelled`. `GetPaymentStatus` success transactions are spelled `Succss` by the API (handled), and `DuplicatePayment` counts as paid (handled). The library derives "Expired" from `ExpiryDate`/`ExpiryTime` in the vendor timezone; this adapter leaves such invoices `pending` until a webhook or a later inquiry says otherwise.
- **Endpoints and auth**: `POST /v2/SendPayment`, `POST /v2/GetPaymentStatus` with `Authorization: Bearer <API key>`, matching both libraries. Refunds use `POST /v2/MakeRefund` (not implemented here yet).
- **Base URLs**: Qatar production `https://api-qa.myfatoorah.com`, test `https://apitest.myfatoorah.com`, matching `mf-config.json`.

## Order ↔ invoice lifecycle (NEW-2)

Until now the Pic-Time **orders** pipeline and the MyFatoorah **booking/invoice**
pipeline never touched. The lifecycle connects them, entirely behind the
existing flags (nothing runs until payments are activated):

- **Invoice from an order (option b).** `createInvoiceForOrder` (in
  `src/lib/payments/invoicing.ts`) calls `SendPayment` with the **order id as the
  `customerReference`**, then writes `provider` / `provider_invoice_id` /
  `payment_url` back onto the `photo_orders` row. Two entry points:
  - *Manual*: the owner action `requestOrderInvoice(orderId)` (Orders → an
    order → "Create MyFatoorah payment invoice"). Gated by `isPaymentsEnabled()`.
  - *Automatic*: the payments cron invoices every eligible order when
    `PAYMENTS_AUTO_INVOICE_ENABLED=1`. Eligible = unpaid, not cancelled, has an
    amount, no invoice yet, **and paid by an offline method** (Fawran / bank
    transfer / cash). A card order is already settled in Pic-Time, so it is
    never auto-invoiced (no double charge).
- **Direct / standalone invoice (option a).** `createStandaloneInvoice` inserts
  a `photo_bookings` row and invoices it with the booking id as the reference,
  so it flows through the existing webhook/reconcile path. (Library only for
  now: no owner action or form calls it yet.)
- **No double invoices.** Before calling SendPayment the order is claimed
  (`invoice_claimed_at`, set only if the order has no invoice and no live
  claim), and the invoice is recorded only if the order still has none. A
  claim older than 10 minutes means an earlier attempt died mid-way: the
  invoice is looked up at MyFatoorah by CustomerReference (the order id) and
  re-linked, never created twice. The invoice-id index is unique. The
  automatic path stops after 3 provider failures per order and works within a
  time budget.
- **The webhook/reconcile now resolve orders too.** When an invoice does not
  match a standalone booking, `processWebhook` / `replayUnmatchedEvents` look it
  up as an order (by `provider` + `provider_invoice_id`) and set the order's
  `payment_state` (paid / failed / refunded), `paid_at`, and
  `photo_payment_events.order_id`. Paid never regresses to failed (a late
  FAILED attempt is ignored), the update is conditional on the state it was
  read in, and the buyer-reported state is left as Pic-Time sent it. A failed
  order update is retried by the replay job. On the first transition to
  **paid** an owner `[Orders]` confirmation is enqueued.

### What this does NOT do (owner's decision)

Creating an invoice **stores a payment URL on the order; it never sends that
link to the customer.** Delivering the link to the buyer (and whether the
automatic path should message them) is a deliberate, unbuilt step — it is an
outward, customer-facing action that needs the owner's explicit sign-off on
wording and channel. The owner sees the link on the order page and sends it
themselves. A paid booking still never creates a tracked athlete.
