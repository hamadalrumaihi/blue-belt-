# Integrations inventory — what exists, what is configured, what is proven

Written 15 October 2026 for the overhaul (workstream F). Every line is backed by code, tests or docs in this repository. **This container has no production secrets, no Vercel/Railway/Supabase dashboard access for the `bluebeltmedia` team, and cannot reach the hosted services**, so the two right-hand columns say what the repository and its docs *record*, not what was observed today. "Verified end to end" means a document in this repo records a live observation with a date; otherwise it says so.

Legend: **implemented** = code + tests in this repo; **configured** = the variables/flags the code needs and where they are documented as set; **reachable** = the endpoint/URL the other side must call or that we call, and whether anything in the repo proves it answered; **verified end to end** = a dated live observation recorded in `docs/`.

| Integration | Implemented | Configured (per repo docs) | Reachable | Verified end to end | Evidence / notes |
|---|---|---|---|---|---|
| **Supabase** (auth, Postgres, RLS) | yes — `src/lib/supabase/{server,browser,service}.ts`, 25 migrations, 10 SQL tests | public URL + anon key, `SUPABASE_SERVICE_ROLE_KEY` on Vercel; project `nuujdewnkovtdvlbfzdx` (shared with another app, hence the `photo_`/`bbm-` prefixes) | hosted project | **partly**: CHECKPOINT records migrations applied through `pictime_approval_jobs`; `docs/delivery-report.md` records 4 of 5 SQL isolation tests run live (`ROLLBACK_OK`); **no storage buckets exist yet** (media library, workstream C) | `docs/overhaul/CHECKPOINT.md`, `docs/delivery-report.md §1` |
| **MyFatoorah** (payments) | yes — V2 webhook signature, idempotent events, atomic transition RPC, reconcile job, deposit/balance requests, website pay pages `/pay/<bbp_>` and `/pay/order/<bbo_>`, embedded card view + hosted page, Pic-Time approval gate | `PAYMENTS_MYFATOORAH_ENABLED`, `MYFATOORAH_API_KEY`, `MYFATOORAH_WEBHOOK_SECRET`, `MYFATOORAH_BASE_URL` (Qatar production `https://api-qa.myfatoorah.com`), `PAYMENTS_RECONCILE_ENABLED`, `PAYMENTS_AUTO_INVOICE_ENABLED`; Railway `PAYMENTS_SECONDS` | webhook `POST /api/payments/myfatoorah/webhook` answers 404 until the flag + secrets are set | **no.** `docs/payments.md` is titled "prepared, not live"; the deposit/balance round says "Sandbox only. Live activation is pending"; `docs/delivery-report.md` F2 "production payments off by design". No doc records a live sandbox transaction either. | `docs/payments.md` (activation procedure §"Activation", rollback §"Rollback"), `tests/payments/*` (one pre-existing failing test: `cron-route.test.ts` "asks the provider about old pending bookings", see CHECKPOINT) |
| **Pic-Time — orders intake via Zapier** | yes — `POST /api/orders/intake` with `bbmo_` credential, `photo_record_order` atomic outbox, dedupe on (owner, source, externalRef), offline orders stay "payment not yet confirmed" | `ORDERS_INTAKE_ENABLED=1`, `SUPABASE_SERVICE_ROLE_KEY`, credential from Settings → Orders intake; Zap "New Order Placed" → Webhooks by Zapier POST | `https://www.bluebeltmedia.com/api/orders/intake` | **yes, with a caveat**: `docs/orders-intake.md` says "Status: live in production (`ORDERS_INTAKE_ENABLED=1`, Zap connected)" and "What Pic-Time really sends (confirmed 2026-10-04)". Caveat recorded in `docs/pictime-approval.md`: the Zap fires on **approval**, not placement, so photographer-paid orders arrive only after they ship. | `docs/orders-intake.md`, `docs/pictime-approval.md` ("Evidence that this is the blocker today", Zap 382341383 history, 12 Oct 2026), `tests/api-orders-intake.test.ts`, `supabase/tests/orders_rls.test.sql` |
| **Pic-Time — gallery events via Zapier** | yes — `POST /api/galleries/intake` (same flag + credential): gallery created / invite sent / visitor | same as orders intake; two more Zaps (invite sent, new visitor) | `…/api/galleries/intake` | **not recorded.** `docs/studio-platform.md` activation step 8 says "add" the two Zaps; nothing records that they were added. | `tests/api-galleries-intake.test.ts` |
| **Pic-Time — approval job** (click "Approve" after a provider-verified payment) | yes, behind flags — app `src/lib/payments/pictime-approval.ts` (lease, provider re-check, allow-list) + worker `POST /pictime/approve` (`worker/src/pictime.mjs`, dry run by default) | app: `PICTIME_APPROVAL_ENABLED`, `PICTIME_APPROVAL_ORDER_ALLOWLIST`, `WATCHER_WORKER_URL`, `WATCHER_WORKER_TOKEN`; worker: `PICTIME_APPROVAL_ENABLED`, `PICTIME_APPROVAL_DRY_RUN`, `PICTIME_ORIGIN=https://bluebeltmedia.pic-time.com`, `PICTIME_STORAGE_STATE_PATH` (a Playwright storage state on the Railway volume) | worker `/pictime/approve` (token-protected) | **no.** `docs/pictime-approval.md`: "implemented behind flags; not enabled or verified end to end"; dashboard selectors observed 12 Oct 2026, "no live approval was clicked". Depends on MyFatoorah being live and on a provisioned Pic-Time browser session. | `docs/pictime-approval.md`, `worker/test/pictime.test.mjs` |
| **Pic-Time — dashboard intake** (read pending offline orders from the signed-in dashboard) | yes, behind flags, read-only by construction — `worker/src/pictime-intake.mjs`, ticked by the worker scheduler | worker: `PICTIME_INTAKE_ENABLED`, `PICTIME_INTAKE_SECONDS` (≥ 300), `PICTIME_INTAKE_POST`, `PICTIME_INTAKE_TOKEN` (`bbmo_`), `PICTIME_INTAKE_BUYER_SELECTOR`, `PICTIME_ORIGIN`, `PICTIME_STORAGE_STATE_PATH`, `APP_URL` | posts to `APP_URL/api/orders/intake` in POST mode | **no.** `docs/pictime-intake.md`: "off by default, not run against the live dashboard"; orders-list markup confirmed 12 Oct 2026 (`OrderLink_<n>` rows) but the buyer-name selector is "not observed yet", so every order is skipped as `BUYER_UNREADABLE` until it is set. | `docs/pictime-intake.md`, `worker/test/pictime-intake.test.mjs` (pins "never clicks, types or submits") |
| **Pic-Time — public gallery link** | yes — `settings.pictimeGalleryUrl` validated to https on pic-time.com / galleries.bluebelt.media, default `https://galleries.bluebelt.media/client` | Settings → Public site | outbound link only | the default is documented as "verified as a direct link (HTTP 200)" in `src/lib/studio/site-content.ts` (no date) | `tests/site-content.test.ts` |
| **Zapier** (transport for the three Pic-Time triggers) | n/a (external) — contract documented, credential kind `orders` | `bbmo_` credential in the Zap's Authorization header | — | orders Zap live (see above); the two gallery Zaps not recorded | `docs/orders-intake.md §Zapier field mapping`, `docs/pictime-intake.md` (Pic-Time Zapier app triggers read with `@zapier/zapier-sdk` on 12 Oct 2026) |
| **Resend** (client e-mail) | yes — outbox + lease-claimed runner in `/api/cron/deliveries`, templates with HTML escaping, dry run under tests | `EMAIL_ENABLED=1`, `RESEND_API_KEY`, `EMAIL_FROM` (verified domain), `EMAIL_REPLY_TO`, `EMAIL_DRY_RUN` | outbound to Resend's API | **not recorded.** `docs/studio-platform.md` activation step 5 ("create a Resend account, verify the sending domain, test with `EMAIL_DRY_RUN=1` first") has no completion note. While off, client e-mails queue and `/notifications` says they are waiting. | `tests/email-outbox.test.ts`, `tests/email-templates.test.ts` |
| **Telegram** (owner alerts + order buttons) | yes — grammY webhook, link codes, signed inline buttons, delivery runner with leases/backoff, `[Match]/[Orders]/[System]` | `TELEGRAM_ENABLED=1`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_REMINDER_MINUTES`; webhook registered from Settings → Telegram | `POST /api/telegram/webhook` (404 until enabled; secret header required) | **partly**: `docs/orders-intake.md` describes the live orders Zap producing `[Orders]` cards and `docs/delivery-report.md` D1 records the claim RPC live; no document records the webhook registration (`getWebhookInfo`) outcome. Settings → Telegram → "Check webhook" shows it without secrets. | `docs/telegram.md`, `tests/telegram-*.test.ts`, `tests/notifications/*` |
| **E-signature** | yes — `internal` (typed name at `/sign/<bbs_>`, PDF via `/api/documents/[id]/pdf`), `mock` (dev only, refused on `VERCEL_ENV=production`), `docusign` (JWT grant + Connect webhook scaffold) | `ESIGN_PROVIDER` (default `internal`), `ESIGN_WEBHOOK_SECRET`, `DOCUSIGN_*` (5) | internal: nothing external; DocuSign: `POST /api/esign/webhook` | internal provider needs no third party and is covered by `tests/sign-service.test.ts`, `tests/documents-pdf.test.ts`; **DocuSign is a scaffold "nothing here is called in tests with real credentials"** (`src/lib/esign/docusign.ts` header) and has no live record. Contract texts are "drafts for legal review". | `docs/studio-platform.md §Security review`, `tests/esign-*.test.ts` |
| **Umami** (public-site analytics) | yes — `src/components/public/Analytics.tsx`, loaded only in the `(public)` layout, no cookies, click events `book-start`, `contact-click`, `gallery-click`, `booking-submitted` | `NEXT_PUBLIC_UMAMI_WEBSITE_ID`, `NEXT_PUBLIC_UMAMI_SCRIPT_URL` (https only) | outbound script | **not recorded** anywhere in `docs/`. Off unless both variables are set. | `.env.example` |
| **Anthropic API** (bracket photo extraction; photo curation vision pass) | yes — `src/lib/bracket-extract-server.ts` (`/api/brackets/extract`, owner-only, 20 per 10 min), `scripts/photos/vision.mjs` (runs on the owner's PC, never on Vercel) | `ANTHROPIC_API_KEY`, `PHOTO_VISION_MODEL`, `PHOTO_SOURCE` | outbound | not recorded; the route answers 404 when the key is unset | `tests/bracket-extract.test.ts`, `tests/photos-select.test.ts` |
| **Railway worker** (Chromium render + scheduler + Pic-Time jobs) | yes — `worker/` (Dockerfile on the Playwright image, `/health`, `/render`, `/pictime/approve`, scheduler ticking the four cron routes) | Railway service `blue-belt-` (ids in `scripts/ops/prod-coherence.mjs`): `WORKER_TOKEN`, `APP_URL`, `CRON_SECRET`, `SCHEDULE_SECONDS`, `DELIVERY_SECONDS`, `PAYMENTS_SECONDS`, `OPS_HEALTH_SECONDS`, volume at `/data`; Vercel: `WATCHER_WORKER_URL`, `WATCHER_WORKER_TOKEN` | **`https://blue-belt-production.up.railway.app`** (`/health` public: `ok`, `browserReady`, `mode`) | **partly**: `docs/ops.md` names the health URL and `npm run ops:coherence` checks Vercel + Railway + health against `main` (it cannot run from this container: the proxy's Vercel token is not on the team, see CHECKPOINT). Rendering AJP/Smoothcomp pages from Railway is recorded as **blocked by Cloudflare** (README/`docs/watcher.md`, verified 2 Oct 2026: `CHALLENGE_NOT_CLEARED` in every mode, also through a UK residential proxy). The scheduler/cron leg is what the worker is relied on for today. | `scripts/ops/prod-coherence.mjs`, `tests/ops-prod-coherence.test.ts`, `worker/test/*` (CI runs the real-Chromium integration test against a local page) |
| **Windows capture agent** (event laptop) | yes — `agent/` (spool, jobs, heartbeat, pause on human check) against `/api/capture/*` with a `bbmc_` credential | `agent.env`: `APP_URL`, `CAPTURE_TOKEN` (+ optional `BROWSER_CHANNEL`, `AGENT_DATA_DIR`, `INTERVAL_SECONDS`, `READY_WAIT_MS`, `HEADLESS`) | posts to the app | **no.** `docs/windows-agent.md §Status`: "End-to-end on a Windows laptop against the live app — not live-verified"; schema live. | `agent/test/*`, `tests/api-capture-route.test.ts` |
| **Vercel** (hosting) | — | project `prj_yBNZa9kYn2TSWDH4nUTWSurC2ICK`, team `team_pIA1MXrlQGKiPGr5SAtdYMXi` (from `scripts/ops/prod-coherence.mjs`); `bluebeltmedia.com` 308 → `www.bluebeltmedia.com`, region iad1 | — | live site observed 15 Oct 2026 (CHECKPOINT: copy issues on `/services`, `/book`, no hero image) | `docs/overhaul/CHECKPOINT.md` |
| **21st.dev MCP** (developer tooling only) | vendored skills under `.claude/`, remote server in `.mcp.json` keyed by `API_KEY_21ST` | env var on the developer's machine; inert without it | outbound from Claude Code sessions only | n/a — never used by the app | `.claude/vendor/21st/SOURCE.md` |

### Not present in this container

The **CID** and **Leqat** repositories were not available in this container, and no copy of their code, docs or configuration exists under `/home/user`. Nothing in this overhaul was adapted from them; any statement elsewhere that patterns were "taken from CID/Leqat" would be an assumption, not a fact.

---

## URLs — one place for the current values

| Thing | Current value | Source of truth | Stale spellings still in the repo |
|---|---|---|---|
| Public site / app origin (`NEXT_PUBLIC_SITE_URL`, worker and agent `APP_URL`) | `https://www.bluebeltmedia.com` (`bluebeltmedia.com` redirects with 308) | `docs/overhaul/CHECKPOINT.md` (live check 15 Oct 2026); default in `src/lib/studio/queries.ts:siteUrl()` | `https://tournament-watcher.vercel.app` in `worker/.env.example:26`, `agent/agent.env.example:6`, `docs/windows-agent.md:32` (historical Vercel alias; whether it still resolves is not known from here) — patch P-20 in the security register |
| Render worker (`WATCHER_WORKER_URL` on Vercel, `WORKER_URL` for ops) | `https://blue-belt-production.up.railway.app` | `scripts/ops/prod-coherence.mjs` `DEFAULTS.WORKER_URL`, `docs/ops.md` | `https://bbm-worker.up.railway.app` was the example in `.env.example` (now corrected) |
| Railway project / environment / service ids | `1b9f1330-…`, `d83f35b0-…`, `b0bbd0d4-…` | `scripts/ops/prod-coherence.mjs` | — |
| Vercel team / project ids | `team_pIA1MXrlQGKiPGr5SAtdYMXi`, `prj_yBNZa9kYn2TSWDH4nUTWSurC2ICK` | `scripts/ops/prod-coherence.mjs` | — |
| Supabase project | `nuujdewnkovtdvlbfzdx` (us-east-1, shared) | `docs/overhaul/CHECKPOINT.md`, `docs/delivery-report.md` | — |
| Pic-Time dashboard origin | `https://bluebeltmedia.pic-time.com` (hard-coded guard in `worker/src/pictime.mjs`) | code | — |
| Public client gallery | `https://galleries.bluebelt.media/client` (default; overridable in Settings) | `src/lib/studio/site-content.ts` | — |
| MyFatoorah production base (Qatar) | `https://api-qa.myfatoorah.com`; sandbox `https://apitest.myfatoorah.com` | `src/lib/payments/config.ts` | — |

---

## Environment variables — every name referenced in `src/**`, `worker/**`, `agent/**`, `scripts/**`

Collected with `grep process.env.`, the `env("NAME")`/`env.NAME` accessors (`src/lib/payments/config.ts`, `src/lib/esign/config.ts`, `src/lib/bookings/policy.ts`, `src/lib/studio/business.ts`, `src/lib/ops/intake-silence.ts`, `worker/src/pictime-intake.mjs`, `agent/src/config.mjs`) and the config files. "Where" = which process reads it. "In `.env.example`" refers to the root file (app); the worker and agent have their own example files.

### App (Vercel / `.env.local`)

| Variable | Where | Purpose | In `.env.example` |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | app (server + browser) | Supabase project URL | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app (server + browser) | anon/publishable key; RLS applies | yes |
| `NEXT_PUBLIC_SITE_URL` | app | canonical origin for links in e-mails, Telegram, signing/pay pages, magic-link redirect | yes |
| `APP_URL` | app (fallback for `siteUrl()` only), worker, agent | the app origin; on the app it is only a fallback after `NEXT_PUBLIC_SITE_URL` | **added** (comment) |
| `VERCEL_ENV` | app (`src/lib/esign/config.ts`) | platform-provided; `production` refuses `ESIGN_PROVIDER=mock` | **added** (comment) |
| `SUPABASE_SERVICE_ROLE_KEY` | app (server only) | service role for cron, webhooks, public reads/submissions, token pages, intake, portal linking | yes |
| `STUDIO_OWNER_ID` | app | pins which owner the public site serves | yes (now marked recommended in production) |
| `CRON_SECRET` | app, worker | bearer secret for `/api/cron/*` | yes |
| `LOG_LEVEL` | app | `debug` for per-step logs | yes |
| `WATCHER_WORKER_URL`, `WATCHER_WORKER_TOKEN`, `WATCHER_PREFER_BROWSER` | app | render worker and Pic-Time approval endpoint | yes (URL example corrected) |
| `PAYMENTS_MYFATOORAH_ENABLED`, `MYFATOORAH_API_KEY`, `MYFATOORAH_WEBHOOK_SECRET`, `MYFATOORAH_BASE_URL`, `PAYMENTS_RECONCILE_ENABLED`, `PAYMENTS_AUTO_INVOICE_ENABLED`, `ORDERS_TEST_ORDERS_ENABLED` | app | MyFatoorah | yes |
| `BOOKINGS_DEPOSIT_REQUIRED`, `BOOKINGS_DEPOSIT_PERCENT`, `BOOKINGS_BALANCE_TIMING` | app | deposit policy (fail-safe defaults) | yes |
| `ESIGN_PROVIDER`, `ESIGN_WEBHOOK_SECRET`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_URL`, `DOCUSIGN_PRIVATE_KEY` | app | e-signature | yes |
| `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_REMINDER_MINUTES`, `TELEGRAM_DRY_RUN` | app | Telegram | yes |
| `ANTHROPIC_API_KEY` | app (`/api/brackets/extract`), scripts (`scripts/photos`) | Claude vision | yes |
| `ORDERS_INTAKE_ENABLED`, `ORDERS_INTAKE_SILENCE_HOURS` | app | Pic-Time orders/galleries intake and the silent-intake alert | yes |
| `EMAIL_ENABLED`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_DRY_RUN` | app | Resend | yes |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID`, `NEXT_PUBLIC_UMAMI_SCRIPT_URL` | app (browser) | Umami | yes |
| `BUSINESS_LEGAL_NAME`, `BUSINESS_CR_NUMBER`, `BUSINESS_PUBLIC_LOCATION`, `BUSINESS_CONTACT_EMAIL`, `BUSINESS_CONTACT_PHONE` | app | public business identity | yes |
| `PICTIME_APPROVAL_ENABLED`, `PICTIME_APPROVAL_ORDER_ALLOWLIST` | app (also worker) | Pic-Time approval gate | yes |
| `PHOTO_SOURCE`, `PHOTO_VISION_MODEL` | scripts (owner's PC) | photo curation pipeline | yes |
| `NODE_ENV`, `VITEST` | app (tests) | dry-run switches under Vitest | n/a (runtime) |
| `VERCEL_TOKEN`, `RAILWAY_TOKEN`, `MAIN_SHA`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_SERVICE_ID`, `WORKER_URL`, `GIT_REMOTE` | `scripts/ops/prod-coherence.mjs` (local/ops only) | production coherence check | **added** (comment block; never on Vercel) |

### Worker (Railway) — `worker/.env.example`

| Variable | Purpose | In `worker/.env.example` |
|---|---|---|
| `WORKER_TOKEN` (required, ≥ 16 chars), `PORT`, `ALLOWED_HOSTS`, `HEADLESS`, `ENGINE`, `PROFILE_DIR`, `NAV_TIMEOUT_MS`, `CHALLENGE_WAIT_MS`, `MAX_CONCURRENCY`, `BROWSER_PROXY`, `PROXY_BLOCK_ASSETS`, `BROWSER_WS_ENDPOINT` | rendering | yes |
| `SCHEDULE_SECONDS`, `APP_URL`, `CRON_SECRET`, `DELIVERY_SECONDS`, `PAYMENTS_SECONDS`, `OPS_HEALTH_SECONDS` | scheduler ticks to the app | yes (`APP_URL` example stale, P-20) |
| `PICTIME_APPROVAL_ENABLED`, `PICTIME_APPROVAL_DRY_RUN`, `PICTIME_APPROVAL_ORDER_ALLOWLIST`, `PICTIME_ORIGIN`, `PICTIME_STORAGE_STATE_PATH`, `PICTIME_INTAKE_ENABLED`, `PICTIME_INTAKE_SECONDS`, `PICTIME_INTAKE_POST`, `PICTIME_INTAKE_TOKEN`, `PICTIME_INTAKE_BUYER_SELECTOR` | Pic-Time jobs | yes |
| `MAX_HTML_BYTES`, `READY_WAIT_MS`, `MAX_EXPAND_PAGES`, `MAX_SCROLL_PASSES`, `MAX_FRAMES`, `USER_AGENT`, `CHROMIUM_EXTRA_ARGS`, `LOCALE`, `TZ_ID` | readiness/expansion bounds, fingerprint | **no** — documented in `worker/README.md` now (defaults in `worker/src/config.mjs`) |
| `CHROMIUM_NO_SANDBOX` | set by the Dockerfile | — | n/a |
| `BBM_WORKER_BROWSER_TESTS` | tests only | yes (README) |

### Agent (Windows laptop) — `agent/agent.env.example`

| Variable | Purpose | In `agent/agent.env.example` |
|---|---|---|
| `APP_URL`, `CAPTURE_TOKEN` (required) | app origin + `bbmc_` credential | yes (`APP_URL` example stale, P-20) |
| `BROWSER_CHANNEL`, `AGENT_DATA_DIR`, `INTERVAL_SECONDS`, `READY_WAIT_MS`, `HEADLESS` | optional | yes |
| `PROFILE_DIR`, `SPOOL_DIR`, `JOBS_REFRESH_SECONDS`, `HEARTBEAT_SECONDS`, `NAV_TIMEOUT_MS`, `MAX_HTML_BYTES`, `MAX_SPOOL_FILES` | optional (defaults in `agent/src/config.mjs`) | **no** — documented in `agent/README.md` now |
| `LOCALAPPDATA` | Windows-provided | n/a |
| `BBM_TEST_A/B/C` | tests only | n/a |

---

## How to turn an "implemented" row into "verified"

1. **MyFatoorah**: follow `docs/payments.md §Activation procedure` on a Vercel *Preview* with the sandbox; record the first `photo_payment_events` row with `signature_valid=true, processing_result=processed`, the `[Orders] Payment confirmed` card and a refund, with dates, in `docs/payments.md`.
2. **Resend**: verify the domain, set the three variables with `EMAIL_DRY_RUN=1`, read `/notifications`, then unset the dry run and send one booking-received e-mail to yourself; record the date.
3. **Gallery Zaps**: add the two Zaps per `docs/studio-platform.md` step 8 and record the first `galleries.event` log line.
4. **Telegram**: Settings → Telegram → Check webhook; record the host and `allowed_updates`.
5. **Worker**: `VERCEL_TOKEN=… RAILWAY_TOKEN=… npm run ops:coherence` from a machine whose token is on the `bluebeltmedia` team; paste the one-line verdict into `docs/ops.md` with the date.
6. **Agent**: one event with the laptop; `docs/windows-agent.md §Status`.
7. **Pic-Time approval / intake**: the single-order dry run in `docs/pictime-approval.md` and the five-step switch-on in `docs/pictime-intake.md` (buyer selector first).
