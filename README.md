# Blue Belt Media — Tournament Watcher

**Tournament Coverage Command Center** for a BJJ / sports photographer.

The app answers one question at all times, standing next to the mats:

> **Who do I need to photograph next, where, and how soon?**

It tracks pre-booked photography clients during live tournaments, watches their AJP / Smoothcomp schedule pages, detects mat and time changes, and ranks everyone by urgency.

It is **not** a gallery, storage, sales or payment tool. Pic-Time remains the long-term home for galleries, customers, photos and sales. Tournament Watcher holds temporary operational data only, and nothing is deleted automatically.

---

## Contents

- [Architecture](#architecture)
- [Setup](#setup)
- [Local development](#local-development)
- [Vercel deployment](#vercel-deployment)
- [Database](#database)
- [Watcher: AJP / Smoothcomp](#watcher-ajp--smoothcomp)
- [ETA and alert rules](#eta-and-alert-rules)
- [Current limitations](#current-limitations)
- [Roadmap](#roadmap)

---

## Architecture

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Components, Server Actions, Route Handlers) |
| Language | TypeScript, strict |
| Styling | Tailwind CSS v4, brand tokens in `src/app/globals.css` |
| Auth + DB | Supabase (email/password auth, Postgres, Row Level Security) |
| Hosting | Vercel |
| HTML parsing | cheerio (server only) |

```
src/
  app/
    (auth)/            login, forgot-password, reset-password
    (app)/             private app: dashboard, events, clients, watcher, history, settings, more
    api/watch/         POST /api/watch — the watcher endpoint
    api/cron/refresh/  POST — scheduled refresh (CRON_SECRET + service role)
    auth/callback/     Supabase code exchange (password reset links)
  components/          BrandHeader, Logo, EventCard, NextClientCard, ClientCard, MatchCard,
                       StatusBadge, EtaBadge, PlatformBadge, LiveIndicator, EmptyState,
                       LoadingState, RefreshButton, SourceLinkButton, DeleteDialog,
                       ClientForm, EventForm, ChangeHistory, MobileBottomNav, DesktopSidebar…
  hooks/               useLiveAthletes (refresh loop), useSettings, useNow
  lib/
    supabase/          browser + server clients, hand-typed Database types
    watchers/          url-policy (SSRF guard), safe-fetch, browser-fetch (worker client), extract, ajp, smoothcomp, index
    watch-service.ts   refresh → diff → persist matches + history
    changes.ts         change detection (mat / time / eta / opponent / status / order / number)
    eta.ts             ETA buckets, urgency ranking
    alerts.ts          in-app alert rules (30/15/5, GO TO MAT, mat change, moved earlier/later)
    notifications/     NotificationChannel interface (in-app today, push / n8n later)
    actions/           Server Actions: auth, events, clients, danger (deletes)
    queries.ts         server data loaders
    settings.ts        per-device preferences (localStorage)
  proxy.ts             session refresh + auth gate (Next 16 name for middleware)
public/brand/          official logo (logo.png) and derived mark / wordmark / icon files
supabase/migrations/   additive SQL applied on top of the existing tables
worker/                Playwright render worker (separate Railway service, Dockerfile included)
```

**Data flow during a tournament**

1. The Dashboard / Match Watcher render from Supabase (RLS scoped to the signed-in owner).
2. Every 60 s (configurable) the client calls `POST /api/watch { athleteIds }`.
3. The server validates each athlete's source URL, fetches it with a timeout and size cap, runs the platform adapter, diffs against `photo_matches`, writes `photo_match_history` rows for real changes, and returns the fresh state.
4. The UI re-ranks clients (ON MAT → GO TO MAT → nearest ETA → later → complete → unknown) and raises in-app alert banners.

No service-role key exists anywhere in the app. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are used, on the server and in the browser alike, so RLS is always in force.

---

## Setup

### 1. Supabase

The app uses the existing Supabase project and these tables:

- `public.photo_events`
- `public.photo_athletes`
- `public.photo_matches`
- `public.photo_match_history`

(`photo_orders`, `photo_payment_events`, `photo_bookings` are untouched and reserved for later.)

The SQL in `supabase/migrations/` has already been applied to the project. It is **additive only**: optional client columns (platform, belt, weight, gender, age category, package, internal notes, last watch status), an `updated_at` trigger, a delete policy on history, and a few indexes. Re-running it is safe (`if not exists` everywhere).

Create the photographer's login in **Supabase → Authentication → Users** (email + password). There is no public sign-up.

Set the auth redirect URL in **Authentication → URL Configuration** to your deployed origin plus `/auth/callback` (for password-reset links).

### 2. Environment variables

Copy `.env.example` to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or sb_publishable_… key>
# optional
NEXT_PUBLIC_SITE_URL=https://your-domain
```

### 3. Logo

The official Blue Belt Media lockup is `public/brand/logo.png` (364×118, transparent). Everything else in `public/brand` is derived from it:

| File | Use |
| --- | --- |
| `mark.png` | square knight badge, colour (header, cards, loading) |
| `wordmark.png` / `wordmark-white.png` | script wordmark for light / dark surfaces |
| `logo-white.png` | full lockup in white ink |
| `icon-192.png`, `icon-512.png` | PWA icons (white tile) |
| `src/app/icon.png`, `src/app/apple-icon.png` | favicon and iPhone home-screen icon |

To swap in a higher-resolution or vector master later, replace `logo.png` and re-cut the derived files (crop the mark at x 14–105 / y 13–104 and the wordmark at x 110–350 of the 364×118 original, or adjust for the new size).

---

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the two Supabase values
npm run dev                  # http://localhost:3000
```

Checks a contributor runs before pushing:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

### First event

On first sign-in with no events, the dashboard offers **Set up AJP Qatar 2026**, which creates:

- AJP TOUR QATAR NATIONAL JIU-JITSU CHAMPIONSHIP 2026 - GI & NO-GI
- 16 October 2026 · Aspire Ladies Sports Hall, Doha, Qatar · Platform AJP · Asia/Qatar

No match data is fabricated; matches appear only when the watcher reads them from the source.

### Testing the watcher by hand

Signed in, from the browser console or curl with your session cookie:

```
GET  /api/watch?url=https://ajptour.com/en/…&athleteName=Ali%20Al-Marri
POST /api/watch  { "url": "…", "athleteName": "…", "timezone": "Asia/Qatar", "eventDate": "2026-10-16" }
POST /api/watch  { "athleteIds": ["…"] }     # refresh + persist
POST /api/watch  { "eventId": "…" }          # refresh every active client of an event
```

The client form also has a **Test link** button that previews the same result.

---

## Vercel deployment

1. Push this repository to GitHub and import it in Vercel (framework preset: Next.js, no custom build settings needed).
2. Add the environment variables from `.env.example` to the Vercel project (Production + Preview).
3. Deploy. `/api/watch` runs on the Node.js runtime (cheerio needs Node, not Edge).
4. In Supabase → Authentication → URL Configuration, add `https://<your-vercel-domain>/auth/callback` to the redirect allow-list and set the Site URL.
5. Optional: set `NEXT_PUBLIC_SITE_URL` so password-reset emails always link to the canonical domain.

Add the site to the iPhone home screen for a full-screen, standalone experience (`manifest.webmanifest` + Apple meta tags are included).

---

## Database

Column reference for the four tables the app uses (existing columns plus the additive migration):

**photo_events** — id, owner_id, name, venue, country*, event_date, platform (`AJP` | `SMOOTHCOMP` | `OTHER`), source_url, timezone, active, created_at, updated_at

**photo_athletes** — id, owner_id, event_id, name, phone, email, division, academy, source_url, notes, active, platform*, belt*, weight*, gender*, age_category*, package_name*, internal_notes*, last_checked_at*, last_watch_status*, last_watch_message*, created_at, updated_at

**photo_matches** — id, owner_id, athlete_id, external_match_id, opponent, mat, scheduled_at, estimated_at, status (`scheduled` | `on_mat` | `complete` | `delayed` | `unknown`), match_order, source_url, last_checked_at, last_changed_at, raw_snapshot (includes `matchNumber`), created_at, updated_at

**photo_match_history** — id, owner_id, match_id, change_type, old_value `{value,label}`, new_value `{value,label}`, detected_at

`*` added by `supabase/migrations/`.

RLS: every table has `auth.uid() = owner_id` policies for select / insert / update / delete. Deleting an event cascades to athletes → matches → history.

**Deletion is manual only** (Settings → Danger zone, or per event / client). Deleting a tournament or everything requires typing `DELETE` and shows exactly what will be removed.

---

## Watcher: AJP / Smoothcomp

### Safety

- Only `https://` URLs on `ajptour.com` / `smoothcomp.com` (and subdomains) are ever fetched. Anything else is rejected before any network call (`src/lib/watchers/url-policy.ts`).
- Redirects are followed manually (max 3) and re-validated against the allow-list on every hop.
- 10 s timeout, 2 MB body cap, no credentials, no custom ports.
- The endpoint requires a signed-in user, so it cannot be used as an open proxy.

### Adapters

`src/lib/watchers/ajp.ts` and `src/lib/watchers/smoothcomp.ts` share one defensive pipeline (`extract.ts`) because both sites run the same Laravel-style stack:

1. **Bot-challenge detection** → `REQUIRES_BROWSER_WATCHER`
2. **Embedded JSON** (`__NEXT_DATA__`, Inertia `data-page`, `window.__INITIAL_STATE__`, JSON-LD) → walk for match-like objects
3. **Tables** whose header mentions mat / time / opponent
4. **Cards / list items** containing a mat and a time
5. Nothing found: JS shell → `REQUIRES_BROWSER_WATCHER`, otherwise `NO_MATCHES`

Every row is normalised to:

```ts
{ athlete, opponent, mat, scheduledAt, estimatedAt, matchNumber, matchOrder, status, sourceUrl, externalMatchId, raw }
```

Wall-clock times (e.g. `10:20`) are resolved in the event's timezone (default Asia/Qatar) on the event date.

### Scraping limitations (verified while building)

- AJP's **listing pages** render server-side, but **event, schedule and athlete pages sit behind a Cloudflare JavaScript challenge** for non-browser clients. Smoothcomp event and schedule pages behave the same way.
- Plain `fetch` therefore cannot read live match data from those pages today. The app reports this honestly per athlete as **"Live schedule unavailable (source needs a browser). Open source page."** and keeps the one-tap **Open AJP / Open Smoothcomp** button prominent.
- Markup on both platforms is not stable. The extraction is heuristic and degrades to `NO_MATCHES` rather than crashing; one failing athlete never breaks a batch refresh.
- Identity of a match across refreshes uses, in order: platform match id, match number, single-match athlete, opponent name, scheduled time.

### Playwright render worker (`/worker`)

A small always-on Node service that opens pages in a real Chromium, waits for the Cloudflare challenge to clear, and returns the rendered HTML. The app then runs the **same adapters** on it, so normalisation, change detection, history and alerts are unchanged.

```
app  --POST /render {url}-->  worker (Chromium, persistent profile)  -->  AJP / Smoothcomp
app  <--{html, finalUrl}----  worker
```

How the app uses it (`src/lib/watchers/index.ts`):

1. Plain HTTPS fetch first (fast, cheap).
2. If the adapter reports `REQUIRES_BROWSER_WATCHER` and the worker is configured, render there and parse again.
3. `WATCHER_PREFER_BROWSER=1` skips step 1.
4. If the worker itself cannot clear the challenge the athlete shows "Browser worker could not clear the site's bot challenge" and the Open AJP button stays one tap away. One failing athlete never breaks a batch.

**Deploy on Railway**

1. New project → Deploy from GitHub repo → set the root directory to `worker/`. The Dockerfile uses the official Playwright image (Chromium + Xvfb included).
2. Add a **Volume** mounted at `/data` so the Chromium profile (and the Cloudflare clearance cookie) survives restarts.
3. Variables: `WORKER_TOKEN` (long random string). Optional: `HEADLESS=new|shell|headed`, `CHALLENGE_WAIT_MS`, `MAX_CONCURRENCY`, `BROWSER_PROXY`, `BROWSER_WS_ENDPOINT` (see `worker/.env.example`).
4. Generate a public domain for the service and note it.
5. In Vercel add `WATCHER_WORKER_URL=https://<railway-domain>` and `WATCHER_WORKER_TOKEN=<same token>` (server-only, not `NEXT_PUBLIC_`), then redeploy.
6. Test: client → **Test link** on an AJP profile URL, or `GET /api/watch?url=…` while signed in. The `strategy` field in the JSON says `browser:…` when the worker was used.

**Endpoints**

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/health` | | browser state, queue depth, mode |
| POST | `/render` | `{ "url": "https://ajptour.com/…", "waitForSelector?": "css" }` | `Authorization: Bearer <WORKER_TOKEN>`; only allow-listed hosts; 3 MB cap; queued at `MAX_CONCURRENCY` |

Responses: `{ ok: true, html, finalUrl, status, elapsedMs, fetchedAt }` or `{ ok: false, code: CHALLENGE_NOT_CLEARED | TIMEOUT | NAVIGATION_ERROR | PROXY_AUTH_FAILED | PROXY_ERROR | BROWSER_CLOSED | WORKER_RESTARTING | TOO_LARGE | UNSUPPORTED_HOST | INVALID_URL | UNAUTHORIZED, message }`. A context that dies under a request (crash, restart) is relaunched and the page retried once before `BROWSER_CLOSED` is reported.

**Cloudflare from Railway: verified result.** Cloudflare scores the IP reputation first and the browser fingerprint second. From Railway's data-centre IPs the AJP and Smoothcomp bracket pages stayed challenged in every browser mode tried (stock Playwright new-headless, Patchright new-headless, Patchright headed under Xvfb), with `CHALLENGE_WAIT_MS=60000`. The browser mode is not the lever; the exit IP is. Two switches exist for that, no code changes needed:

- `BROWSER_PROXY=http://user:pass@host:port` routes the worker's Chromium through a residential proxy. Put the login in the URL; the worker splits it into the separate `username`/`password` fields Playwright needs (Playwright itself drops credentials from the URL). With a per-GB plan, `PROXY_BLOCK_ASSETS=1` skips images, media and fonts once the challenge is clearing.
- `BROWSER_WS_ENDPOINT=wss://…` connects to a hosted browser (Browserless, Bright Data Scraping Browser, and similar) that handles challenges on its own infrastructure; the worker then only drives it.

`/health` reports the active `proxy` host, and one Test-link run from the app shows the outcome as a `[watch] …` line in the Vercel runtime logs.

### Scheduled refresh while phones are locked

`POST /api/cron/refresh` refreshes every active athlete of every active event whose date is today (±1 day in the event's timezone), for all owners, without a user session. Configure:

- App (Vercel): `CRON_SECRET` (random string) and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API → `service_role`; server-side only, never `NEXT_PUBLIC_`).
- Worker (Railway): `SCHEDULE_SECONDS=60`, `APP_URL=https://tournament-watcher.vercel.app`, `CRON_SECRET=<same>`.

The worker then ticks the endpoint every 60 s; the app fetches through the worker, diffs, and writes matches and history exactly as a manual refresh does. Body `{ "all": true }` refreshes every active event regardless of date. Without the service-role key the endpoint answers 503 and the in-app refresh keeps working as before.

---

## ETA and alert rules

`src/lib/eta.ts`:

- Target time = `estimated_at` if present, else `scheduled_at`.
- Minutes remaining are computed against the event timezone (Asia/Qatar by default).
- `> 30` UPCOMING · `≤ 30` 30 MIN · `≤ 15` 15 MIN · `≤ 5` 5 MIN · `≤ 2` GO TO MAT · status running → ON MAT · complete → COMPLETE · no time → UNKNOWN.
- Sort: ON MAT → GO TO MAT → nearest ETA → later matches → complete → unknown / no match.

`src/lib/alerts.ts` builds in-app banners for the 30 / 15 / 5 minute thresholds, GO TO MAT, ON MAT, mat changes, matches moved earlier, and matches moved ≥ 15 min later. The same `AppAlert` objects feed the `NotificationChannel` interface in `src/lib/notifications/` so push / n8n / WhatsApp can be added later (labelled **Coming Soon** in Settings).

Colour language: green = healthy/upcoming, amber = approaching, orange = very soon, red = GO TO MAT / ON MAT / mat change only, blue = general tracking.

---

## Current limitations

- Live schedule reading needs the Playwright worker deployed (see above); without it, expect `REQUIRES_BROWSER_WATCHER` on most AJP / Smoothcomp schedule pages. Whether Cloudflare lets the worker through from Railway's IPs must be verified against a live event; residential proxy / hosted browser switches exist if not.
- The parser has only been exercised on synthetic AJP-style markup and the public listing pages. Tune it against a real schedule page once the worker can see one.
- In-app auto-refresh runs only while the app is open; the worker's scheduler + `/api/cron/refresh` covers locked phones once the service-role key and secrets are set.
- Settings (timezone fallback, refresh interval, default platform, show completed, notification toggles, pinned event) are stored per device in `localStorage`, not in Supabase.
- Single-owner model. RLS is per `owner_id`; team accounts would add a membership table and widen the policies.
- No payments, bookings, galleries, invoices or Pic-Time integration by design.

---

## Roadmap

**Pre-booking flow (later)**  booking form → MyFatoorah → paid → automatically add client to the watcher (`photo_bookings` / `photo_orders` already exist for this).

**Post-event flow (later)**  Pic-Time → order → MyFatoorah → payment webhook → order paid (`photo_payment_events`).

**Notifications (later)**  n8n / push / WhatsApp channels implementing `NotificationChannel`.

None of these are implemented yet, on purpose.
