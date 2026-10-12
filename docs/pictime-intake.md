# Pic-Time dashboard intake (design note)

Status: **implemented behind flags, off by default, not run against the live
dashboard.** Read-only by construction. Nothing here can approve, ship or
change a Pic-Time order.

## Why it exists

Orders paid to the photographer directly are held in Pic-Time until they are
approved, and the only order trigger Pic-Time offers Zapier fires on
approval. So such an order reaches the app only after it has shipped, which
means the invoice and the payment check come too late, and the approval job
(`docs/pictime-approval.md`) can never see it.

Evidence from Pic-Time's Zapier app (`App197910CLIAPI@2.0.7`), read with
`@zapier/zapier-sdk` 0.115.1 against the existing `bluebeltmedia` connection
on 12 October 2026:

| Trigger (key) | Event type in the sample | Fires on |
| --- | --- | --- |
| New Order Placed (`new_order`) | `orderApproved` (210) | approval, despite its name; the payload is `orderApproved.*` with `placeOrderDate` and `paymentCollectedBy` |
| New Gallery Visitor (`new_gallery_visitor`) | `firstClientVisit` (402) | a client's first visit to a gallery |
| Main Client Gallery Invite Sent (`project_email_sent`) | `email` (301) | a gallery invite e-mail |

None of these takes input fields, so there is no "placed" or "pending" variant
of the order trigger to select. The app has one write action, Create New
Gallery, which this design does not use. No Zap change can deliver pending
orders. The existing Zap's later post-approval delivery stays useful: the
intake dedupes on the Pic-Time reference.

## Design

`worker/src/pictime-intake.mjs`, ticked in-process by the Railway worker's
scheduler every `PICTIME_INTAKE_SECONDS` (minimum 300):

1. Opens the **same dedicated Pic-Time context as the approval job**, with
   the owner's storage state from `PICTIME_STORAGE_STATE_PATH` and never the
   tournament profile. It holds the same session lock, so approval and intake
   never run at once.
2. Loads `#dash|store|orders` and collects order references from links and
   attributes naming `order_<digits>` and from visible `Order #<digits>`
   text. Orders this process has already sent, or seen shipped, are not
   reopened, and at most 10
   are opened per pass.
3. Opens each order page (`#dash|store|orders|order_<ref>`, observed) and
   reads it with the approval job's `snapshot`. It keeps only orders whose
   single status is **`Offline Payment`** (pending) and whose amount and
   currency are readable.
4. Reads the buyer name with `PICTIME_INTAKE_BUYER_SELECTOR`, and accepts it
   only if exactly one non-empty match is found. The intake requires a name
   and the adapter never invents one, so without a usable selector every
   order is skipped as `BUYER_UNREADABLE`.
5. In **POST mode** it sends the Zap's flat shape to `APP_URL/api/orders/intake`
   with an orders credential (`bbmo_…`):
   `{ source: "pictime", externalRef, buyerName, total, currency,
   paymentMethod: "photographer", paymentStatus: "pending approval" }`.
   The app stores `payment_state = pending`. A `201` or `200` marks the
   reference done. A `400` is skipped. Any `401`, `403`, `404`, `429` or
   `5xx` ends the pass, and the next tick retries.

Guarantees, pinned by `worker/test/pictime-intake.test.mjs`:

- **It never clicks, types, fills, presses or submits anything.** The test
  fails if any of those calls appears in the module.
- Observe mode is the default. It counts what it could read and sends
  nothing.
- No buyer data, page text, URLs or tokens appear in logs or results, only
  counts and codes. A login page instead of the dashboard reports
  `SESSION_REQUIRED`.
- It cannot mark anything paid. The app keeps offline orders pending until
  the owner, or a verified MyFatoorah payment, says otherwise.

## Not yet observed (why it is off)

- **The orders list.** Its route (`#dash|store|orders`) and the markup the
  references come from are inferred from the observed order URL; they have
  not been seen.
- **The buyer name on an order page.** No selector has been observed, hence
  the environment variable instead of a guessed constant.

## Switching on, in this order

| Step | Where | Setting |
| --- | --- | --- |
| 0 | Railway volume | A worker session at `/data/pictime/state.json`, the same file the approval job uses (see `docs/pictime-approval.md`, step 3) |
| 1 | Railway | `PICTIME_INTAKE_ENABLED=1`, `PICTIME_INTAKE_SECONDS=900`, `PICTIME_ORIGIN=https://bluebeltmedia.pic-time.com`, `PICTIME_STORAGE_STATE_PATH=/data/pictime/state.json`. Leave `PICTIME_INTAKE_POST` unset (observe). |
| 2 | Railway logs | One `pictime_intake.run` line per pass. `listed > 0` and `pending` matching the dashboard confirm discovery. `buyerReadable` stays 0 until step 3. |
| 3 | Owner, once | Inspect a pending order page in a desktop browser and note the buyer name element's selector. Set `PICTIME_INTAKE_BUYER_SELECTOR`, then confirm `buyerReadable == recordable` in the next pass. |
| 4 | App → Settings → Orders intake | Create a second orders credential for the worker (keep the Zap's own). Set it as `PICTIME_INTAKE_TOKEN` on Railway. |
| 5 | Railway | `PICTIME_INTAKE_POST=1`. The next pass records pending orders: an `[Orders]` card arrives with the invoice plan, and the order shows as "to be paid to you directly, not yet confirmed". |

Undo: `PICTIME_INTAKE_ENABLED=0` (or remove it), then revoke the worker's
orders credential. Orders already recorded stay, as with any intake.

## Interplay

- The **Zap** keeps running. Its post-approval delivery of the same order is
  a `200` replay that changes nothing.
- **Invoicing** (`docs/orders-invoicing.md`) now sees offline orders while
  they are still unpaid, which is the point.
- **Approval** (`docs/pictime-approval.md`) can now find an order the owner
  has not approved, once its payment is provider-verified. Its own flags and
  allowlist still apply.
