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
- No cron wiring for reconciliation; `reconcileBooking` is ready for a cron or
  an admin action to call.
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
  400 malformed JSON, 401 signature, 404 flag off, 429 rate limit (120/min),
  503 service client not configured, 500 only if the delivery row could not
  be written (so MyFatoorah retries).
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
