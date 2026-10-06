# Orders intake — Pic-Time orders via Zapier (proposed contract)

Status: **implemented and locally verified, feature-flagged, not live.** No
real Pic-Time payload was available while building; the contract below is a
proposal shaped so that a Zap can fill it from Pic-Time's "New order" trigger
fields. The fixtures under `tests/fixtures/orders/` are **synthetic** and say
so in a `_fixture` field. Before relying on it, send one real order through
Zapier's test step, compare the fields, and adjust the mapping (not the
guarantees).

## What it is — and is not

- A record that an order was **placed**, with buyer, items, amount and the
  payment situation Pic-Time reported, plus an **[Orders]** Telegram message.
- **Not** a payment webhook. It carries no provider signature and proves
  nothing about money. Card orders are stored with the state Pic-Time
  reported ("paid, reported by Pic-Time"). **Fawran, bank transfer and cash
  orders are always stored as "Order placed — payment not yet confirmed"**,
  whatever the payload says; the owner confirms receipt by hand on the order
  page. MyFatoorah webhooks (`docs/payments.md`) stay a separate, signed path.
- Buyers are customers, kept in `photo_orders`. Nothing links them to tracked
  athletes; `athleteNameHint` is free text for the photographer's eyes.
- Prices are never invented: an order without an amount is refused.

## Switch on

| Where | Setting |
| --- | --- |
| Vercel env | `ORDERS_INTAKE_ENABLED=1` (plus the existing `SUPABASE_SERVICE_ROLE_KEY`) |
| App → Settings → Orders intake | **Create credential** (prefix `bbmo_`, 30–365 days, revocable). Shown once. |
| Zapier | Trigger: Pic-Time → *New Order* (or the closest available). Action: **Webhooks by Zapier → POST**, Payload type **JSON**, URL `https://<app>/api/orders/intake`, header `Authorization: Bearer bbmo_…`. |

Run the Zap's test step: a `201` with `{ ok: true, orderId, replayed: false }`
means the order is in `/orders`; a re-send of the same order answers `200`
with `replayed: true` and changes nothing.

## Contract (`POST /api/orders/intake`, JSON)

```json
{
  "source": "pictime",
  "externalRef": "PT-2026-000123",
  "placedAt": "2026-03-14T06:12:00Z",
  "buyer": { "name": "Fatima Al-Kuwari", "email": "fatima@example.com", "phone": "+974 5555 0100" },
  "gallery": { "name": "Qatar National Pro 2026", "id": "g_8812" },
  "items": [{ "name": "Digital download — full match set", "quantity": 1, "unitAmount": 250, "sku": "DL-FULL" }],
  "amount": { "value": 370, "currency": "QAR" },
  "payment": { "method": "card", "state": "paid", "reference": "ch_…" },
  "notes": "Please include the podium shot.",
  "athleteNameHint": "Hamad Al Rumaihi"
}
```

Flat aliases are accepted for Zapier's one-level field mapping:
`orderId` / `orderNumber` → `externalRef`; `buyerName` / `customerName`,
`buyerEmail` / `customerEmail`, `buyerPhone` / `customerPhone`;
`galleryName`, `galleryId`; `total` + `currency` → `amount`;
`paymentMethod`, `paymentStatus` / `paymentState`, `paymentReference`;
`createdAt` / `orderDate` → `placedAt`; `note` / `comment` → `notes`;
`athleteName` / `competitorName` → `athleteNameHint`. Items accept
`title` / `product`, `qty`, `price` / `unit_price`.

| Field | Required | Rules |
| --- | --- | --- |
| `source` | no (default `pictime`) | must be `pictime` |
| `externalRef` | **yes** | 1–120 chars `[A-Za-z0-9._:#/-]`; dedupe key per owner |
| `buyer.name` | **yes** | ≤ 200 chars |
| `buyer.email` | no | must look like an email when present; lower-cased |
| `amount.value` | **yes** | number ≥ 0; rounded to 2 dp |
| `amount.currency` | no (default `QAR`) | 3-letter code |
| `payment.method` | no | words mapped: card/visa/apple… → `card`; fawran → `fawran`; bank/transfer/iban → `bank_transfer`; cash → `cash`; else `unknown` |
| `payment.state` | no | paid/succeeded → `paid`; pending/awaiting → `pending`; failed/declined → `failed`; refund… → `refunded`; **forced to `pending` for offline methods** (reported value kept in `payment_reported_state`) |
| `items[]` | no | up to 50; `name` required per item |

Responses: `201` recorded, `200` replayed, `400` `INVALID_JSON` / `INVALID_ORDER`
(message says which field), `401` no/unknown/expired/revoked credential,
`403` `WRONG_CREDENTIAL_KIND` (a capture credential was used), `404` flag
off, `413` body > 64 KB, `429` rate limited, `503` service client missing.

## Zapier field mapping (to confirm against a real trigger)

| Zap field (Pic-Time trigger, expected) | Send as |
| --- | --- |
| Order ID / Order Number | `externalRef` |
| Order Date | `placedAt` |
| Customer Name | `buyer.name` |
| Customer Email | `buyer.email` |
| Customer Phone | `buyer.phone` |
| Gallery / Project Name | `gallery.name` |
| Gallery ID | `gallery.id` |
| Line items (name, quantity, price) | `items[]` (use Zapier's line-item support, or send `items` as a JSON array in a Code step) |
| Order Total | `amount.value` |
| Currency | `amount.currency` |
| Payment Method | `payment.method` |
| Payment Status | `payment.state` |
| Transaction / Payment Reference | `payment.reference` |
| Customer Note | `notes` |
| Custom field "Athlete" (if you add one in Pic-Time) | `athleteNameHint` |

If the trigger lacks an order id, use Zapier's `id` of the trigger event as
`externalRef` — it is stable across Zap retries, which is all the dedupe
needs.

## Storage and guarantees

- `photo_record_order(owner, order, delivery)` (SECURITY DEFINER, service
  role only) inserts the order and the `[Orders]` Telegram outbox row in **one
  transaction**; a replay by `(owner, source, external_ref)` returns the
  existing order and enqueues nothing. The owner is the credential's owner —
  the body cannot name one.
- New columns on `photo_orders` (additive): `source`, `external_ref`,
  `payment_method`, `payment_state`, `payment_reference`,
  `payment_reported_state`, `items`, `placed_at`, `received_at`,
  `buyer_note`, `athlete_name_hint`, `raw` (redacted: no card-like keys,
  strings cut at 300 chars), `payment_confirmed_at/by`, `fulfilled_at`.
  Existing `status` is the lifecycle: `placed` → `fulfilled` | `cancelled`.
- Owner-only everywhere: `photo_orders` has owner RLS only; collaborators
  (event members) have no policy and the Orders pages are not linked from
  `/coverage`. Pinned by `supabase/tests/orders_rls.test.sql`.
- Telegram: one `ORDER_PLACED` row per order, category `orders`, delivered by
  the independent runner (`docs/telegram.md`).

## Owner actions (Orders pages)

`/orders` lists orders (filters: needs payment confirmation / paid /
fulfilled); `/orders/<id>` shows payment, buyer, items and record data with:
**Payment received — confirm** (offline methods; sets `payment_state=paid`,
`payment_confirmed_at/by`, optional note), **Mark fulfilled** / undo, and
**Cancel order** (record only; nothing is sent to Pic-Time).

## Invoice drafts for new buyers (owner review only)

At intake the buyer is compared with your clients (`photo_athletes` email,
or the last 8 digits of the phone). When the buyer is **not** a client and the
order is open, unpaid and not a card order (card orders are settled in
Pic-Time), the `[Orders]` Telegram message carries an **invoice draft**: bill-to,
the order's own lines (prices are never invented) and total, plus a link
(`/orders?ref=<Pic-Time ref>`) to the order. Existing clients are named instead.
A failed client lookup never blocks the order; the message says so.

On `/orders/<id>` the Invoice card shows the same draft (checked against the
current client list), **Copy invoice text**, **Open in email** / **Open in
WhatsApp** (your own app opens with the text filled in), and **Mark invoice
sent** (stored as `metadata.invoice_sent_at`). Nothing is sent to the buyer,
charged or created at a payment provider by any of this.

## Tests

`tests/orders-contract.test.ts` (normalisation, Fawran rule, refusals,
redaction), `tests/api-orders-intake.test.ts` (flag, credential kind,
owner from credential, atomic RPC call, replay 200), `supabase/tests/orders_rls.test.sql`.
