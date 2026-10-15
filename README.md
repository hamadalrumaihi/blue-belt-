# Blue Belt Media — studio platform

One app, two experiences, for a combat-sports photography business in Qatar:

- **Public website** (`/`, `/services`, `/work`, `/how-it-works`, `/book`, `/contact`) where athletes, parents and clubs book coverage, plus the **client portal** (`/client`) where a client sees their bookings, agreement, payment state and private gallery link.
- **Private studio** (`/studio` and friends) where the owner runs the business: leads, clients, bookings, contracts, payments, galleries, Pic-Time orders, media, pricing intelligence, notifications — and the **Tournament Watcher**, which answers one question standing next to the mats: *who do I need to photograph next, where, and how soon?*

Pic-Time remains the gallery, storage and photo-sales platform. MyFatoorah handles Blue Belt payments (feature-flagged until the account is activated). Telegram carries owner/operations notices; e-mail (Resend, optional) carries client notices.

> **Video editing** (DaVinci Resolve, MCP servers, `/bjj-*` skills) lives in [`resolve-ai/`](resolve-ai/README.md) and is documented there, not here.

## Contents

- [Architecture](#architecture)
- [Trust boundaries](#trust-boundaries)
- [Setup](#setup)
- [Local development and checks](#local-development-and-checks)
- [Deployment and rollback](#deployment-and-rollback)
- [Database](#database)
- [Tournament Watcher](#tournament-watcher)
- [Orders (Pic-Time via Zapier)](#orders-pic-time-via-zapier)
- [Website media and featured work](#website-media-and-featured-work)
- [Pricing intelligence](#pricing-intelligence)
- [Notifications and payments](#notifications-and-payments)
- [Testing and CI](#testing-and-ci)
- [Current limitations](#current-limitations)
- [Further reading](#further-reading)

---

## Architecture

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Components, Server Actions, Route Handlers). Read `node_modules/next/dist/docs/` before touching framework APIs (see `AGENTS.md`). |
| Language | TypeScript, strict |
| Styling | Tailwind CSS v4, brand tokens in `src/app/globals.css` |
| Auth + DB | Supabase (e-mail/password for the studio, magic link for clients, Postgres, Row Level Security, `SECURITY DEFINER` views/RPCs) |
| Hosting | Vercel (app) + Railway (Chromium render worker and scheduler) |
| HTML parsing | cheerio (server only) |

```
src/
  app/
    (public)/           /, /services, /services/[slug]*, /work*, /how-it-works*, /book, /book/done,
                        /contact, /privacy, /terms, /sign/[token], /pay/[token], /pay/order/[token],
                        /portfolio (→ redirects to /work*)
    (client)/client/    client portal: login (magic link), my bookings, booking detail
    (auth)/             login, forgot-password, reset-password;  auth/callback/ exchanges e-mailed links
    (app)/              private studio: studio (home), bookings, leads, people, clubs, documents (+templates),
                        galleries, payments, orders, packages, media*, website/*, production*, pricing/*,
                        events, clients, watcher, coverage, history, issues, import, featured-work,
                        notifications, settings (+danger), more
    api/
      watch/            POST — signed-in refresh / preview (Tournament Watcher)
      import/, import/receive/   signed-in page import and the bookmarklet hand-over
      capture/, capture/jobs/, capture/heartbeat/   Windows agent intake (bbmc_ credential)
      orders/intake/, galleries/intake/            Pic-Time events via Zapier (bbmo_ credential)
      payments/myfatoorah/webhook/                 signed MyFatoorah Webhook V2
      esign/webhook/                               signed e-signature provider events
      telegram/webhook/                            grammY webhook (secret header)
      cron/refresh|deliveries|payments|ops-health/ jobs ticked by the Railway worker (CRON_SECRET)
      documents/[id]/pdf/                          signed agreement PDF (token or session)
      brackets/extract/                            bracket photo → rows (owner, Anthropic API)
      media/*                                      media library uploads*
  components/           UI (public/, studio shell, cards, forms, nav.ts)
  lib/
    supabase/           browser + server (anon key, cookies) + service (service role, server-only) clients, hand-typed Database types
    actions/            Server Actions (one module per area; every public one is listed in docs/overhaul/SECURITY-REGISTER.md)
    catalog/*           the one catalog: audiences × services × media scopes, legacy type/kind mapping
    bookings/           public form schema, lifecycle state machine, deposit policy, gates, brief*
    services/           packages form + public price decision (publicPrice / bookableAmount)
    pricing/*           pricing intelligence: references, cost floor, recommendation engine (owner-only)
    media/*             media library: upload, validation, placements, public projection
    documents/, esign/  contracts, signing tokens, PDF, providers (internal | mock | docusign)
    payments/           MyFatoorah client, signature, webhook processing, pay pages, Pic-Time approval
    orders/, galleries/ Pic-Time orders and gallery events
    notifications/      outbox + delivery runner (Telegram, e-mail), incidents, reminders
    watchers/, capture/ Tournament Watcher adapters, URL policy, capture trust
    client-portal/      portal loaders (client-safe views only)
    studio/             public studio row, site content, dashboard
    i18n/               locale, cookie, server helpers*
    log.ts, rate-limit.ts, validation.ts, time.ts, cron-auth.ts, roles.ts, authz.ts
  proxy.ts              session refresh + auth gate (Next 16 name for middleware); PUBLIC_PATHS allow-list
supabase/migrations/    additive SQL, applied in order;  supabase/tests/  SQL isolation tests
worker/                 Playwright render worker + scheduler + Pic-Time jobs (Railway, Dockerfile)
agent/                  Windows event-laptop capture agent
scripts/                ops/prod-coherence.mjs, photos/ (curation pipeline, runs on the owner's PC)
docs/                   feature docs; docs/overhaul/ holds the overhaul checkpoint, security register and integrations inventory
```

`*` = **landing in this overhaul** (branch `claude/overhaul-2026-10`): `/work`, `/services/[slug]`, `/how-it-works`, the `/portfolio` redirect, `src/lib/catalog`, `src/lib/media` + `/media` + `api/media`, `src/lib/pricing` engine + `/pricing/*` screens, `/website/*`, `/production`, `src/lib/bookings/brief.ts`, the i18n helpers and the transactional public-submission RPC. Until those merge, the committed code is what `main` serves; `docs/overhaul/CHECKPOINT.md` records which workstream owns which file.

## Trust boundaries

The browser only ever holds the **anon key** plus the user's session cookie, so Row Level Security applies to everything a client component, a Server Component or a Server Action does with `createClient()`. The **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`) exists on the server and is used, deliberately and only there (`src/lib/supabase/service.ts`, `import "server-only"`), for the paths that have no user session:

| Path | What authenticates it before the key is touched |
| --- | --- |
| Public website reads (`loadPublicStudio`, `listPublicEvents`) | reads only the single `photo_studio` row with `public_booking = true` (pin it with `STUDIO_OWNER_ID`), that owner's active public packages, and `id,name,event_date` of their active events |
| Public submissions (`/book`, `/contact`) | per-IP rate limit, honeypot, strict form schema; the owner is the public studio row, never the browser |
| Signing and pay pages (`/sign/<bbs_>`, `/pay/<bbp_>`, `/pay/order/<bbo_>`, `/api/documents/[id]/pdf?token=`) | the random token (40 base62 chars, stored as a SHA-256 hash) is the credential; expiry and status guards; amounts come from the row, never from the browser |
| Scheduled jobs (`/api/cron/*`) | `Authorization: Bearer <CRON_SECRET>` compared in constant time, fail-closed |
| Provider webhooks (MyFatoorah, e-signature, Telegram) | provider signature / secret header verified first; unverified deliveries are stored as a hash and never applied |
| Machine intake (`/api/capture/*`, `/api/orders/intake`, `/api/galleries/intake`) | revocable, expiring, kind-specific credentials (`bbmc_`, `bbmo_`) stored hashed; owner = the credential's owner |
| Client portal e-mail linking (`loadMyPeople`) | links CRM people to the signed-in user only by the auth provider's verified e-mail |
| Owner order actions shared with Telegram/cron (`src/lib/actions/orders.ts`) | `requireOwner()` and an explicit `owner_id` re-check before the shared service runs |

Inside Postgres: every `photo_*` table has RLS; owner policies additionally require an owner/staff profile (`photo_is_studio_user()`), so a self-registered portal account can never create its own tenant; clients read through `SECURITY DEFINER` views that expose client-safe columns only; collaborators reach data only through `SECURITY DEFINER` functions scoped to `auth.uid()`; the pricing tables require the **owner** role (`photo_is_owner_user()`), so staff and clients get zero rows. The full audit, with patch requests, is `docs/overhaul/SECURITY-REGISTER.md`; the SQL isolation tests are listed under [Testing and CI](#testing-and-ci).

---

## Setup

### 1. Supabase

The app uses an existing, **shared** Supabase project (other apps' tables live beside ours), so every object is prefixed `photo_` / `bbm-`. Apply `supabase/migrations/` in order (`supabase db push`, or paste into the SQL editor); every file is additive and idempotent. Create the studio login in **Authentication → Users** (no public sign-up for the studio; clients sign in with a magic link). Set the auth redirect URL to your origin plus `/auth/callback` (`docs/auth-config.md`).

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the two public Supabase values; everything else is optional and documented inline. The complete inventory of every variable the app, the worker and the agent read, with the current production URLs, is `docs/overhaul/INTEGRATIONS.md`. Never prefix a secret with `NEXT_PUBLIC_`.

### 3. Logo

The official lockup is `public/brand/logo.png`; `mark.png`, `wordmark*.png`, `logo-white.png`, `icon-192/512.png`, `src/app/icon.png` and `src/app/apple-icon.png` are derived from it (crop the mark at x 14–105 / y 13–104 and the wordmark at x 110–350 of the 364×118 original).

---

## Local development and checks

```bash
npm install
cp .env.example .env.local   # fill in the two Supabase values
npm run dev                  # http://localhost:3000
```

Before pushing:

```bash
npm run check        # typecheck + lint + vitest + worker and agent node --test
npm run build        # next build with the same placeholders CI uses
npm run test:db      # migrations + every supabase/tests/*.sql on a disposable local Postgres (DATABASE_URL); see Testing and CI
```

`npm run typecheck` runs `next typegen` first (Next 16 route types), so run it after adding routes.

---

## Deployment and rollback

**Deploy.** Push to `main`; Vercel builds the app (framework preset Next.js, no custom settings; `/api/*` runs on the Node.js runtime). The Railway worker builds from `worker/` on the same commit. `VERCEL_TOKEN=… RAILWAY_TOKEN=… npm run ops:coherence` confirms both platforms and the worker's `/health` agree with `main` (`docs/ops.md`).

**Roll back the app.** Vercel → Deployments → the previous production deployment → **Instant Rollback** (or `vercel rollback <deployment-url>`). This swaps the alias in seconds and keeps the environment variables. Roll the worker back from Railway → Deployments → Redeploy the previous build.

**Database.** Migrations are additive (new tables, nullable columns, `if not exists`, `create or replace`); no down-migration is needed to roll the app back, because the previous build ignores columns it does not know. Never drop or rename a column in a migration without a two-step deploy.

**Content.** Anything shown to visitors is unpublished from the studio, not with a deploy: **Studio → Featured work** (publish / unpublish the hero and featured set), **Studio → Media** (unpublish a photograph from every placement; landing in this overhaul), **Settings → Public site** (switch public booking off: `/book` then shows "Online booking opens soon" and the booking actions refuse), **Packages** (set a package to not public).

**Feature flags** (all off by default, each dark-404s its routes when off): `PAYMENTS_MYFATOORAH_ENABLED`, `PAYMENTS_RECONCILE_ENABLED`, `PAYMENTS_AUTO_INVOICE_ENABLED`, `ORDERS_INTAKE_ENABLED`, `EMAIL_ENABLED`, `TELEGRAM_ENABLED`, `PICTIME_APPROVAL_ENABLED` (+ allow-list), `ESIGN_PROVIDER`, `WATCHER_WORKER_URL`. Turning one off is the rollback for that integration; `docs/payments.md` has the payment-specific procedure.

---

## Database

Schema lives in `supabase/migrations/` (baseline `20260929000000_baseline_schema.sql`, then one file per feature through `20261012070000_pictime_approval_jobs.sql`; the overhaul adds `*_public_submission_rpc.sql`, `*_media_library.sql`, `*_pricing_intelligence.sql`). TypeScript types are hand-maintained in `src/lib/supabase/database.types.ts` and change together with the migration.

Core groups: **watcher** (`photo_events`, `photo_athletes`, `photo_matches`, `photo_match_history`, `photo_captures`, `photo_capture_credentials`, `photo_coverage*`, `photo_incidents`), **studio** (`photo_profiles`, `photo_studio`, `photo_people`, `photo_organizations`, `photo_services`, `photo_leads`, `photo_bookings`, `photo_booking_payment_requests`, `photo_documents`, `photo_document_templates`, `photo_esign_events`, `photo_galleries`, `photo_payment_*`, `photo_orders`, `photo_audit_log`), **pricing** (`photo_price_references`, `photo_quotes`, owner-only), **notifications** (`photo_telegram_links`, `photo_notification_subscriptions`, `photo_notification_deliveries`, `photo_job_heartbeats`).

Atomic paths: `photo_apply_refresh` (one athlete's refresh under an advisory lock, `SECURITY INVOKER`), `photo_apply_coverage_command`, `photo_claim_notification_deliveries`, `photo_record_order`, `photo_apply_payment_transition`, and (landing) `photo_submit_public_booking`. **Deletion is manual only** (Settings → Danger zone, typed `DELETE`).

---

## Tournament Watcher

Live match tracking for AJP / Smoothcomp athletes: every 60 s the app (or the Railway scheduler while phones are locked) re-reads each athlete's bracket page, diffs it against `photo_matches`, writes history for real changes, re-ranks clients (ON MAT → GO TO MAT → nearest ETA → later → complete → unknown) and raises in-app and Telegram alerts. Because the source pages sit behind a Cloudflare challenge for non-browser clients, the watcher has four ways to read a page, from automatic to human: plain fetch → the Chromium render worker → the photographer's own browser (bookmarklet hand-over / paste on `/import`) → the Windows event-laptop agent. Every applied page is recorded in the capture ledger with replay and out-of-order protection.

The full description — safety rules, adapters, worker deployment and the `CHALLENGE_NOT_CLEARED` guidance, import and capture trust, the Windows agent, scheduled refresh, ETA/alert rules, reliability notes, collaboration and coverage, offline completion and manual corrections — moved unchanged to **[docs/watcher.md](docs/watcher.md)**. Companion pages: [docs/captures.md](docs/captures.md), [docs/windows-agent.md](docs/windows-agent.md), [docs/local-competitions.md](docs/local-competitions.md), [docs/telegram.md](docs/telegram.md).

## Orders (Pic-Time via Zapier)

Feature-flagged (`ORDERS_INTAKE_ENABLED=1`) JSON intake at `POST /api/orders/intake`, authenticated with an **orders intake credential** (`bbmo_…`, Settings → Orders intake), recorded atomically with its **[Orders]** Telegram card, deduped by `(owner, source, externalRef)`, never inventing prices; Fawran / bank-transfer / cash orders stay "payment not yet confirmed" until the owner confirms or the buyer pays online. Payment links (`/pay/order/<token>`, provider invoice, one e-mail, Review or Automatic mode) and the Telegram control buttons are in [docs/orders-invoicing.md](docs/orders-invoicing.md); the contract and Zapier mapping in [docs/orders-intake.md](docs/orders-intake.md); the (flagged, unverified) Pic-Time approval job and dashboard intake in [docs/pictime-approval.md](docs/pictime-approval.md) and [docs/pictime-intake.md](docs/pictime-intake.md). Gallery events (`/api/galleries/intake`) share the flag and credential.

## Website media and featured work

Today the public site's photographs come from the committed `public/photos/manifest.json` produced by the curation pipeline (`scripts/photos/`, documented in [photos/README.md](photos/README.md)), and the owner approves and publishes them on **Studio → Featured work**; nothing is shown to visitors until it is published.

**Landing in this overhaul:** a **media library** in Supabase Storage (`src/lib/media/**`, `/media`, `api/media/*`, migration `*_media_library.sql`) with validation (minors / sensitive / third-party branding flags block publishing), placements (hero, featured, per-service, `/work` categories) and a public projection that only ever forwards published items; the manifest stays as a fallback source. See [docs/media-library.md](docs/media-library.md) once it lands.

## Pricing intelligence

Owner-only (`requireOwner()` in every action and page; `photo_is_owner_user()` in every policy): reference prices checked by hand, a cost floor, and a recommendation the owner applies to a booking as a quote. Nothing customer-facing may import these modules (`tests/pricing-isolation.test.ts` fails the build-time scan otherwise). The overhaul separates market comparison, cost floor and recommendation and fixes the margin formula (`price = cost / (1 − m − fee)`); see [docs/pricing-intelligence.md](docs/pricing-intelligence.md) once workstream D lands it.

## Notifications and payments

- **Telegram** (grammY, `TELEGRAM_ENABLED=1`): link codes, `[Match] / [Orders] / [System]` cards, signed inline buttons, an independent lease-claimed delivery runner ticked by `/api/cron/deliveries`; [docs/telegram.md](docs/telegram.md).
- **E-mail** (Resend, `EMAIL_ENABLED=1`): client notices queue in the same outbox and are sent by the same runner; owner switches per kind on `/notifications`.
- **MyFatoorah** (`PAYMENTS_MYFATOORAH_ENABLED=1`): Webhook V2 signature verification, idempotent deliveries, atomic state transition, reconciliation, 50 % deposit / 50 % balance requests, website pay pages (embedded card view + hosted page), photo-order payment links; **prepared, not live** — activation and rollback in [docs/payments.md](docs/payments.md).
- **E-signature**: the internal typed-name signing page by default; `mock` for development; a DocuSign scaffold behind `ESIGN_PROVIDER=docusign`.
- **Scheduler**: the Railway worker ticks `/api/cron/refresh`, `/api/cron/deliveries`, `/api/cron/payments` and `/api/cron/ops-health` with `CRON_SECRET`; each job writes `photo_job_heartbeats`, shown in Settings.

Status of every integration (implemented → configured → reachable → verified), with the evidence: **[docs/overhaul/INTEGRATIONS.md](docs/overhaul/INTEGRATIONS.md)**.

---

## Testing and CI

```bash
npm run typecheck   # next typegen + tsc
npm run lint        # eslint
npm test            # vitest (parsers, time/DST, validation, identity, plans, alerts, API 400s, payments, portal access, pricing isolation, …)
npm run test:worker # worker: node --test (HTTP contract, URL policy, config, readiness, scheduler, Pic-Time)
npm run test:agent  # Windows agent: node --test
npm run check       # all of the above except the build
npm run build
```

`.github/workflows/ci.yml` runs type-check, lint, unit tests and the build with placeholder public Supabase values (no secrets), the worker and agent checks, and the worker's real-Chromium integration test in the Playwright container. `.github/dependabot.yml` keeps the three npm roots and the actions current (weekly, grouped minor/patch).

**Database tests** (`supabase/tests/*.sql`) run against a real Postgres with `npm run test:db` (`scripts/db/sql-tests.mjs`): it creates a disposable `bbm_sql_tests` database on the server `DATABASE_URL` points at (default `postgres://postgres:postgres@127.0.0.1:5432/postgres`; Supabase hosts are refused), applies `scripts/db/shim.sql` (the Supabase roles, `auth.*` and `storage.*` a plain Postgres lacks), every migration and `scripts/db/seed.sql`, then runs each test file. Every file is a `DO` block that ends with `ERROR: ROLLBACK_OK: …` on success and rolls everything back. CI runs the same script in the **Database** job on the runner's Postgres. Flags: `--only <name>`, `--keep`, `--no-shim`, `--no-seed`.

## Current limitations

- Live schedule reading from Railway is blocked by Cloudflare for AJP / Smoothcomp (verified 2 Oct 2026); the import page, the bookmarklet and the Windows agent are the working paths, and the worker's value today is the scheduler. Details and the switches that exist (residential proxy, hosted browser) are in [docs/watcher.md](docs/watcher.md).
- Production payments, e-mail, the gallery Zaps, the Pic-Time approval and dashboard intake jobs and the Windows agent are implemented and tested but **not live-verified** — see [docs/overhaul/INTEGRATIONS.md](docs/overhaul/INTEGRATIONS.md) for what each needs.
- Rate limits are in-memory per Vercel instance; a WAF rule or a shared store is the next step (register F-05).
- Security headers (`nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy`, no-referrer on `/pay` and `/sign`) are set in `next.config.ts`; a full CSP is not (register F-03 closed).
- Both languages share one URL (cookie `bbm_lang`, `?lang=` switch), so no `hreflang` alternates are declared on purpose; declaring two languages for one URL would be incorrect.
- Per-device settings (timezone fallback, refresh interval, …) live in `localStorage` and sync to `photo_user_settings`.
- Contract templates are drafts for legal review.

## Further reading

| Topic | Page |
| --- | --- |
| Overhaul checkpoint, workstreams, ownership | [docs/overhaul/CHECKPOINT.md](docs/overhaul/CHECKPOINT.md) |
| Security audit, patch requests, public projections, RLS evidence | [docs/overhaul/SECURITY-REGISTER.md](docs/overhaul/SECURITY-REGISTER.md) |
| Integrations status, URLs, every environment variable | [docs/overhaul/INTEGRATIONS.md](docs/overhaul/INTEGRATIONS.md) |
| Entity model, lifecycles, roles, activation checklist | [docs/studio-platform.md](docs/studio-platform.md) |
| Tournament Watcher (full) | [docs/watcher.md](docs/watcher.md) |
| Production checks | [docs/ops.md](docs/ops.md) |
| Supabase Auth for the client portal | [docs/auth-config.md](docs/auth-config.md) |
| Delivery report of the previous programme | [docs/delivery-report.md](docs/delivery-report.md) |
