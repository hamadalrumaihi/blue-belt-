# Pic-Time approval after a verified payment

Status: implemented behind flags; **not enabled or verified end to end**.

## Account observations, 12 October 2026

The signed-in dashboard showed a pending digital order with a visible
`Approve` control (`.approveOfflinePayment.orderApprove`). Its status was
`Offline Payment`. A previously completed digital order showed
`Shipped to client` in `.itemStatus`. Currency is exposed as
`.totalSale .salePrice .pCurrency[data-name="QAR"]`.

No live approval was clicked. A confirmation dialog, if any, has not been
observed. The adapter deliberately does not guess how to accept one.
These observations describe the dashboard, not a supported public API.

## Implemented flow

The existing payment cron scans paid MyFatoorah orders with provider-verified
invoice, payment ID, amount and currency evidence. Sandbox payments are rejected.
It queries production payment status again and checks the invoice's customer
reference, successful transaction, amount and currency before browser dispatch.
It leases one order for
two minutes, then sends only its Pic-Time reference, integer amount in
minor units and currency to the authenticated Railway endpoint
`POST /pictime/approve`. Concurrent cron ticks cannot claim the same order.
Failures and dry runs wait five minutes before another attempt; Telegram
notices deduplicate by order and outcome.

The worker uses a separate Playwright context, never the tournament browser
profile. It opens the exact order, checks its identity, total and currency,
and supports only one High-Res digital line item (possibly multiple photos).
Unknown product combinations fail closed. Dry run never clicks. Live mode
clicks only the observed approval control and requires a positive shipped
status afterward. A timeout is uncertain, never a delivery success. A later
attempt can recognize an already shipped order without clicking again.

Only a confirmed shipped result updates `approved_in_pictime_at`,
`fulfilled_at` and `status = fulfilled` in the app, writes an
`order.fulfilled` audit row, and edits the order's Paid card in Telegram into
a Fulfilled card (its Done button is retired). An order cancelled in the app
is never sent to the worker. The app's receipt is not proof of photo delivery.

## Configure for a single-order dry run

1. Apply `supabase/migrations/20261012070000_pictime_approval_jobs.sql`.
2. Deploy this branch's app and worker together, initially with flags off.
3. Establish a separate Pic-Time session for the worker. On a trusted computer
   with this worker's dependencies installed, use Playwright's interactive
   browser and sign in yourself:

   ```sh
   npx playwright codegen --save-storage=pictime-state.json https://bluebeltmedia.pic-time.com/professional
   ```

   Close it after the dashboard appears. The state file contains session
   credentials. Keep it out of git and logs; transfer it securely to the
   worker's private persistent volume, for example `/data/pictime/state.json`.
   A browser session on another computer or tool is not a Railway session.

4. Set server-only Vercel variables:

   ```text
   PICTIME_APPROVAL_ENABLED=1
   PICTIME_APPROVAL_ORDER_ALLOWLIST=<one verified paid Pic-Time order number>
   WATCHER_WORKER_URL=<existing HTTPS Railway worker origin>
   WATCHER_WORKER_TOKEN=<existing shared worker token>
   ```

5. Set Railway variables:

   ```text
   PICTIME_APPROVAL_ENABLED=1
   PICTIME_APPROVAL_DRY_RUN=1
   PICTIME_APPROVAL_ORDER_ALLOWLIST=<same order number>
   PICTIME_ORIGIN=https://bluebeltmedia.pic-time.com
   PICTIME_STORAGE_STATE_PATH=/data/pictime/state.json
   ```

6. Keep the existing payments scheduler enabled. The MyFatoorah payment gate
   and valid secrets are also required. Verify the dry-run Telegram message
   and that the Pic-Time order remains pending.

## Live verification and rollout

Use a genuine provider-confirmed payment associated with the exact test order.
Never mark an unpaid order paid just to exercise automation. Change only
`PICTIME_APPROVAL_DRY_RUN=0` on Railway for the allowlisted test order. Verify:

- Pic-Time reports shipped, the app records fulfillment, and the exact
  purchased unwatermarked downloads are available to the buyer.
- A repeated cron tick does not repeat the approval or notification.
- A wrong amount, refunded payment and expired session leave delivery pending.

Keep the rollout restricted until these checks pass. `*` permits all eligible
orders, but both app and worker must have it before broad rollout.

If a confirmation dialog appears, capture its visible controls and add its
specific handling and regression fixture before retrying. Do not click
generic OK/Confirm controls or replay undocumented payment endpoints.

## Remaining limitations

- Pending-order discovery is still the existing intake. The dashboard can
  show pending orders, but automatic dashboard intake has not been built.
  A live Zap that never emits pending orders still needs repair or a separate
  intake adapter. Approval automation cannot approve an order the app lacks.
  The adapter is designed in [pictime-intake.md](pictime-intake.md) (off by
  default, read-only).

  Evidence that this is the blocker today (Zap 382341383 history export,
  12 October 2026): every trigger payload of Pic-Time's "New Order Placed" is
  an `orderApproved` event (type 210) whose `createDate` is the approval
  time, not the placement time. Order 1475080675 was placed on 28 September
  and its event was created on 4 October; the two zero-amount test orders
  produced events only after they were approved. For a store with
  photographer-collected payment, orders are held until approved, so the
  Zap delivers an order only after its approval. With this job enabled the
  order would reach the app only after the job had approved it, which it
  cannot do for an order the app lacks. The Zap's later post-approval
  delivery is harmless (the intake dedupes on the Pic-Time reference).

- **Never approve an unpaid offline order in Pic-Time to make the Zap fire.**
  Approving a digital order ships it ("Shipped to client"), which releases
  the purchased downloads before any payment.
- A worker session must be provisioned and refreshed; login expiry alerts
  require intervention. The worker does not automate Google authentication.
- A refund racing an external approval cannot be made atomic across two
  services. The app rechecks payment before dispatch and conditionally saves
  delivery. An uncertain response requires inspecting Pic-Time.
- The bounded scan examines 100 undelivered paid orders per tick. Clear stale
  or unsupported records before broad rollout; otherwise they can obscure
  later eligible orders.
- Shipment status is observed, but end-to-end client email/download delivery
  must be verified with the real test order.

## Disable

Set `PICTIME_APPROVAL_ENABLED=0` on both app and worker. Existing payment
verification, invoices and manual approval continue.
