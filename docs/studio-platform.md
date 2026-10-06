# Blue Belt Media studio platform

How the Tournament Watcher became one module inside a photography-business
platform: entities, lifecycles, security boundaries, integrations and the
exact steps to switch each piece on. Everything here is additive on top of
the watcher, capture agents, Railway worker, Telegram queue, MyFatoorah
groundwork and Pic-Time order intake that already existed.

## Two experiences, one app

| Surface | Routes | Who | Auth |
| --- | --- | --- | --- |
| Public website | `/`, `/services`, `/portfolio`, `/contact`, `/book`, `/book/done`, `/privacy`, `/terms` | anyone | none (service-role reads of `photo_studio` + public services only) |
| Signing page | `/sign/<token>` | the signer | the single-use signing token (hashed in the DB) |
| Client portal | `/client`, `/client/login`, `/client/bookings/<id>` | clients | Supabase magic link; RLS shows only rows linked to the signed-in person |
| Studio | `/studio`, `/leads`, `/bookings`, `/people`, `/clubs`, `/packages`, `/documents`, `/payments`, `/galleries`, `/orders`, `/notifications`, `/settings` + the watcher routes (`/dashboard`, `/watcher`, `/events`, `/clients`, `/coverage`, `/issues`, `/history`, `/import`) | owner, staff | e-mail + password; role from `photo_profiles` |

`src/proxy.ts` lists the public paths; everything else needs a session.
`src/app/(app)/layout.tsx` additionally refuses the `client` role (sent to
`/client`). `/clients` keeps its URL (it is the athlete module) and is
labelled **Athletes** in the nav; CRM people live at `/people`.

## Roles

`photo_profiles.role` ∈ `owner | staff | client`, read through the
SECURITY DEFINER RPC `photo_my_role()` (never from the browser):

- existing auth users were backfilled as `owner` (users who only had
  `photo_event_members` rows became `staff`);
- every auth user created from now on is `client` unless
  `raw_app_meta_data.role` says `owner` or `staff` (set it in the Supabase
  dashboard when creating a collaborator account, or update
  `photo_profiles` afterwards);
- the trigger `photo_on_auth_user_created` also links `photo_people.user_id`
  for the person with the same e-mail, so a client's magic-link sign-in
  immediately shows their bookings.

Staff keep the existing collaborator experience (coverage board, settings).
Clients never reach the studio shell.

## Entities

```
photo_people ───────┐           photo_organizations
 (CRM person,       │             (club / academy / team)
  may have user_id) │                    │
                    ▼                    ▼
photo_leads ──► photo_bookings ◄──── photo_services (packages, price or quote)
                    │  ├─ status           = MyFatoorah payment status (existing machine)
                    │  ├─ booking_status   = business lifecycle (below)
                    │  ├─ watcher_athlete_id → photo_athletes (explicit link only)
                    │  ├─ contract_document_id → photo_documents
                    │  └─ gallery_id        → photo_galleries (Pic-Time URL)
                    ├─► photo_payment_records (provider + manual, append-only)
                    ├─► photo_documents (rendered body, hash, signature evidence)
                    └─► photo_galleries
photo_orders (Pic-Time sales; optional client_id / gallery_id)
photo_notification_deliveries (outbox: channel telegram | email)
photo_client_notification_prefs (owner switches per client e-mail kind)
photo_audit_log (who did what: payments, signatures, status changes)
photo_studio (single tenant: business details + public_booking switch)
```

One person may book for themselves, for a child, manage several athletes
or represent a club: the person is the contact, `athlete_name` /
`details.athlete_name` is who is photographed, and `photo_athletes` rows
(the watcher) are created or linked only by an explicit owner action.

## Lifecycles (state machines)

**BOOKING** (`photo_bookings.booking_status`, `src/lib/bookings/state.ts`)

```
inquiry → quoted → awaiting_contract → awaiting_payment → confirmed → in_progress → delivered → completed
   └───────────────────── any non-terminal ──────────────────────────────→ cancelled → inquiry (reopen)
```

Forward skips are allowed (cash booking: inquiry → confirmed); one step
back is allowed to correct a mistake; `completed` is terminal. New bookings
start where `initialBookingStatus` says: quote → `inquiry`; priced +
contract required → `awaiting_contract`; priced → `awaiting_payment`; free →
`confirmed`. A verified MyFatoorah payment or a manual payment that covers
the amount moves `awaiting_*` → `confirmed`; a signed agreement moves
`awaiting_contract` → `awaiting_payment` (or `confirmed` when nothing is
owed); marking the gallery ready moves `confirmed | in_progress` →
`delivered`.

**PAYMENT** (`photo_bookings.status`, unchanged): `pending → paid | failed |
cancelled`, `paid → refunded | disputed`, `disputed → refunded | paid`,
`failed → pending | paid | cancelled`; written only by the MyFatoorah
webhook / reconciliation through `photo_apply_payment_transition`.
**Manual payments never touch it**: they are `photo_payment_records`
(`kind = 'manual'`, method, amount, date, note, `recorded_by`) summarised
into `amount_paid_qr` / `manual_paid_at`. `effectivePayment()` answers
"is it paid?": provider status wins, manual records fill in cash / bank /
Fawran, partial = something received but less than the amount.
`recordManualPayment` refuses when `status = 'paid'` (provider-verified).

**CONTRACT** (`photo_documents.status`, `src/lib/documents/state.ts`)

```
draft → sent → viewed → signed
             └────────→ declined
             └────────→ expired
```

`signed` is immutable (body + `body_hash` + `signature_evidence`). Declined
or expired documents are re-issued as new documents.

**GALLERY** (`photo_galleries.status`, `src/lib/galleries/state.ts`):
`pending → created → ready → delivered` (back one step allowed).

**DELIVERY** is the booking's `delivered_at` / `completed_at` plus the
`DELIVERY_COMPLETE` client e-mail and `DELIVERY_SENT` owner notice.

## Flows

**Public booking** (`/book` → `submitPublicBooking`): per-IP rate limit,
honeypot, length caps → studio owner from `photo_studio` → person
find-or-create (e-mail, then phone) → lead → booking (`payment_mode` from
the service: quote or payment link later; never instant on the public
form) → audit (`actor_kind = 'public'`) → owner Telegram `[Bookings] New
booking request` → client e-mail *Booking received* → `/book/done?ref=BB-…`.
Clubs and custom requests become an inquiry + quote.

**Owner follow-up** (`/bookings/<id>`): quote, send agreement
(`/documents`), create a MyFatoorah link (`requestBookingInvoice`, gated by
`PAYMENTS_MYFATOORAH_ENABLED`; the link is stored on the booking and only
e-mailed when the owner ticks *Send to client*), record cash / bank /
Fawran, assign photographer / videographer, link to a tracked athlete
(`/clients`) or create one from the booking by explicit confirmation.

**Payment confirmation**: webhook (`/api/payments/myfatoorah/webhook`,
signature-verified, idempotent) → `photo_apply_payment_transition` →
`booking_status = confirmed` → `photo_payment_records` (provider) → client
e-mails *Payment received* + *Booking confirmed* → owner Telegram `[Orders]
Payment confirmed`.

**Signing**: `sendDocument` renders the template with merge fields, stores
the body hash, creates a token (stored as a SHA-256 hash) and e-mails the
link. `/sign/<token>` marks viewed, shows the full text, takes a typed
full name + consent checkbox, re-checks the hash and the expiry, writes
`signature_evidence` (method, typed name, agreed text, IP, user agent,
body hash, timestamp) atomically guarded by `status in (sent, viewed)`.
PDF: `/api/documents/<id>/pdf` (token, owner session or client session).

**Galleries**: the owner creates the gallery in Pic-Time, pastes the URL on
`/galleries`, marks it ready (optionally e-mailing the client the link).
Zapier → `/api/galleries/intake` (same `bbmo_` credential as orders)
accepts Pic-Time's *Main Client Gallery Invite Sent* and *New Gallery
Visitor* triggers to flip status / count visitors. Pic-Time's *Create
Gallery* action can be driven from Zapier by the owner; the app does not
call Pic-Time directly (no public API).

**Notifications**: one outbox (`photo_notification_deliveries`) with two
channels. `telegram` (owner) categories `[Match] [Bookings] [Orders]
[Delivery] [System]`; `email` (client) kinds listed on `/notifications`
with per-kind switches. `/api/cron/deliveries` drains both, each only when
its own flag is on; queued rows wait otherwise. Repeated failures are
deduped by `alert_key`; the e-mail runner retries three times with backoff
and failures show on `/notifications` with a Retry button.

## Security review (what was checked)

- **Owner id** is taken from the session, the studio row or an intake
  credential — never from a form. Public actions use the service role only
  after loading the studio row with `public_booking = true`.
- **Tenant isolation**: owner RLS on every `photo_*` table additionally
  requires an owner/staff profile (`photo_is_studio_user()`), so a
  self-registered portal account can never create its own tenant, studio
  row or outgoing e-mail. Every studio server action also calls
  `requireStudioUser()`. Clients read only through the SECURITY DEFINER
  views `photo_client_{people,bookings,galleries,payments}_v`, which expose
  client-safe columns (no internal notes, metadata, assignments or
  provider ids); documents stay readable through RLS because the agreement
  is the client's own. Drafts and not-ready galleries are invisible.
- **Public forms never re-link people**: a website submission matches an
  existing person by e-mail only and never writes contact details onto an
  existing row (a phone-only match could otherwise hand a stranger an
  existing client's portal).
- **Documents**: tokens are random (`bbs_` + 40 chars), stored hashed,
  single-use per document, expire; the signed body is hash-locked; signing
  is an atomic guarded update; signer name must contain letters.
- **Payments**: `photo_bookings.status` is written by the webhook path
  only; manual records are append-only with actor + audit; a manual
  record cannot override a provider `paid`; invoice creation is
  rate-limited per owner and gated by the payments flag; amounts come from
  the booking row, never from the request.
- **Public abuse**: per-IP sliding-window limits on booking, contact,
  signing and portal sign-in; honeypot field; field length caps; no
  internal error text leaks; the portal login always answers neutrally.
- **Injection**: every e-mail/Telegram/HTML string goes through
  `escapeHtml`; gallery URLs must be `https` and pic-time.com (or a host
  the owner allow-lists); informational source URLs are validated as
  http(s) only and never fetched by the public flow.
- **IDOR**: every action validates UUIDs and loads the row through the
  user client (RLS) or `.eq("owner_id", user.id)` + count check.
- **Secrets**: `RESEND_API_KEY`, `EMAIL_FROM`, MyFatoorah and Supabase
  service keys are server-only; nothing new is `NEXT_PUBLIC_`.
- **Audit**: manual payments, signatures, status transitions, gallery
  delivery and public submissions write `photo_audit_log`.

Known gaps (honest): the in-memory rate limiter is per serverless
instance (as before); IP addresses in signature evidence are whatever the
platform forwards; contract texts are drafts for legal review; there is
no refund API; e-mail deliverability depends on a verified Resend domain.

## Environment variables (new)

| Variable | Purpose |
| --- | --- |
| `EMAIL_ENABLED` | `1` turns client e-mail on (needs the next two) |
| `RESEND_API_KEY` | Resend API key (server-only) |
| `EMAIL_FROM` | Verified sender, e.g. `Blue Belt Media <bookings@domain>` |
| `EMAIL_REPLY_TO` | Optional reply-to |
| `EMAIL_DRY_RUN` | `1` logs instead of sending |
| `STUDIO_OWNER_ID` | Optional: pins which owner the public site serves |

Unchanged but now used by new features: `PAYMENTS_MYFATOORAH_ENABLED`,
`MYFATOORAH_*`, `ORDERS_INTAKE_ENABLED` (also gates `/api/galleries/intake`),
`SUPABASE_SERVICE_ROLE_KEY` (public forms, signing, portal linking),
`NEXT_PUBLIC_SITE_URL` (links in e-mails and Telegram).

## Activation checklist

1. **Apply the migration** `supabase/migrations/20261007000000_studio_platform.sql`
   (additive; backfills `photo_profiles`). Verify: `select role, count(*)
   from photo_profiles group by 1` shows your account as `owner`.
2. **Deploy** `main` to Vercel; set `NEXT_PUBLIC_SITE_URL` to the real
   domain (`https://bluebelt.media` when the domain is attached).
3. **Studio → Settings → Public site**: business details, Instagram,
   WhatsApp; **Packages**: seed defaults, set real prices (or leave as
   quote); switch **Public booking** on. `/book` is live from that moment.
4. **Supabase Auth**: enable the e-mail OTP / magic link provider, set the
   site URL and add `https://<domain>/auth/callback` to the redirect list
   (the portal uses `?next=/client`). Customise the magic-link e-mail
   template to say "Blue Belt Media client portal".
5. **Client e-mail**: create a Resend account, verify the sending domain,
   set `EMAIL_ENABLED=1`, `RESEND_API_KEY`, `EMAIL_FROM`; test with
   `EMAIL_DRY_RUN=1` first; review `/notifications`.
6. **Contracts**: open `/documents/templates`, read every default template
   with your lawyer, edit, and only then send one to a real client.
7. **MyFatoorah**: follow `docs/payments.md` (test portal on a preview
   deployment first). Only after that, set the production key, secret,
   `MYFATOORAH_BASE_URL=https://api-qa.myfatoorah.com`, register the
   webhook `https://<domain>/api/payments/myfatoorah/webhook`, and set
   `PAYMENTS_MYFATOORAH_ENABLED=1`. "Create MyFatoorah link" appears on
   bookings from then on; nothing is sent to a client unless you tick it.
8. **Pic-Time via Zapier**: keep the existing *New Order Placed* zap →
   `/api/orders/intake`; add *Main Client Gallery Invite Sent* and *New
   Gallery Visitor* zaps → `/api/galleries/intake` with the same `bbmo_`
   bearer token (Settings → Orders intake). Map `gallery name` → `galleryName`,
   `gallery url` → `galleryUrl`, `client email` → `clientEmail`.
9. **Telegram**: nothing new to configure; studio messages arrive in the
   linked chat under `[Bookings]`, `[Delivery]`, `[Orders]`, `[System]`.
10. **Railway worker**: unchanged (`DELIVERY_SECONDS` already ticks the
    runner that now also sends e-mail).
