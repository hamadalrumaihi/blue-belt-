# Tournament Watcher

The Tournament Watcher is the studio module that answers one question standing next to the mats: **who do I need to photograph next, where, and how soon?** This page holds the full technical description of the module (adapters, the render worker, the import and capture paths, the Windows agent, scheduled refresh, ETA/alert rules, reliability, collaboration). The top-level [README](../README.md) only summarises it.

Related pages: [captures.md](captures.md) (capture trust), [windows-agent.md](windows-agent.md) (event-laptop agent), [local-competitions.md](local-competitions.md) (manual tracking), [telegram.md](telegram.md) (alerts), [ops.md](ops.md) (production checks), [overhaul/INTEGRATIONS.md](overhaul/INTEGRATIONS.md) (worker URL and environment variables).

**Data flow during a tournament**

1. The Dashboard / Match Watcher render from Supabase (RLS scoped to the signed-in owner).
2. Every 60 s (configurable) the client calls `POST /api/watch { athleteIds }`.
3. The server validates each athlete's source URL, fetches it with a timeout and size cap, runs the platform adapter, diffs against `photo_matches`, writes `photo_match_history` rows for real changes, and returns the fresh state.
4. The UI re-ranks clients (ON MAT → GO TO MAT → nearest ETA → later → complete → unknown) and raises in-app alert banners.

## First event

On first sign-in with no events, the dashboard offers **Set up AJP Qatar 2026**, which creates:

- AJP TOUR QATAR NATIONAL JIU-JITSU CHAMPIONSHIP 2026 - GI & NO-GI
- 16 October 2026 · Aspire Ladies Sports Hall, Doha, Qatar · Platform AJP · Asia/Qatar

No match data is fabricated; matches appear only when the watcher reads them from the source.

## Testing the watcher by hand

Signed in, from the browser console or curl with your session cookie:

```
GET  /api/watch?url=https://ajptour.com/en/…&athleteName=Ali%20Al-Marri
POST /api/watch  { "url": "…", "athleteName": "…", "timezone": "Asia/Qatar", "eventDate": "2026-10-16" }
POST /api/watch  { "athleteIds": ["…"] }     # refresh + persist
POST /api/watch  { "eventId": "…" }          # refresh every active client of an event
```

The client form also has a **Test link** button that previews the same result.

---


## Watcher: AJP / Smoothcomp

### Safety

- Only `https://` URLs on `ajptour.com` / `smoothcomp.com` (and subdomains) are ever fetched. Anything else is rejected before any network call (`src/lib/watchers/url-policy.ts`).
- Redirects are followed manually (max 3) and re-validated against the allow-list on every hop.
- 10 s timeout, 2 MB body cap, no credentials, no custom ports.
- The endpoint requires a signed-in user, so it cannot be used as an open proxy.
- Request bodies are validated explicitly (`src/lib/validation.ts`): malformed JSON, null, primitives, arrays, empty or non-id `athleteIds`, invalid `eventId`, unknown fields and impossible dates all get a `400` with a `code`. Per-user rate limits answer `429` with `Retry-After` (`src/lib/rate-limit.ts`; per Vercel instance).
- Every request logs one JSON line per attempt with a correlation id (`x-request-id`, echoed in the response) and redaction of tokens, e-mails and phone numbers (`src/lib/log.ts`). Page HTML is never logged. Search Vercel runtime logs for `[watch]`.
- Transient source failures (timeouts, network errors, 5xx) are retried with backoff (3 attempts); 4xx, oversized bodies, blocked redirects, invalid URLs and parser failures are not.

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
- Identity of a match across refreshes uses, in order: platform match id, match number (exact), then a single id-less candidate by sole row / opponent name / scheduled time (probable). When a fallback key matches **several** stored rows the parsed match is kept as a separate row flagged `identity_confidence = ambiguous` with an `IDENTITY_AMBIGUOUS` history entry ("Needs review" on the card) instead of silently merging.
- **Last-known data stays visible.** A failed or empty read never erases stored matches; the athlete's `last_success_at` / `consecutive_failures` drive the Live / Aging / Stale badge and the card says what failed (bot challenge, worker unreachable, source timeout, parser problem, athlete not listed, schedule not published).
- Each client's page has a "Source diagnostics" panel: last attempt, last success, failure streak, strategy (`http:table`, `browser:embedded-json`, …), source HTTP status, elapsed time and final URL.

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

With a proxy, set `LOCALE` and `TZ_ID` to match the exit country so the browser's clock agrees with its IP (a UK proxy: `LOCALE=en-GB`, `TZ_ID=Europe/London`). `TZ_ID` must be an IANA zone id; a bare city name such as `London` makes Chromium refuse to launch (`Invalid timezone ID`), which `/health` now reports under `configErrors` and `/render` answers with 503 `MISCONFIGURED`.

`/health` without the token returns only `{ ok, browserReady, mode }` (what Railway's health check needs); with `Authorization: Bearer <WORKER_TOKEN>` it adds config problems, queue depth, engine, uptime and the active `proxy` host. One Test-link run from the app shows the outcome as a `[watch] …` line in the Vercel runtime logs (strategy, source status, elapsed time, worker code).

### Import a page (the human-in-the-loop path)

**Verified 2 Oct 2026:** through a UK residential proxy, headed Patchright, 60 s wait, AJP still answered a 403 with a Turnstile widget (`CHALLENGE_NOT_CLEARED`, `challengeKind: interactive`). Cloudflare wants a person to tick the box on that IP; no browser setting changes that, and the project does not use CAPTCHA solvers or bypass libraries. The import route makes the person the normal workflow instead of a fallback:

1. The photographer opens the bracket page in their own browser (phone or laptop) and passes the check as a human.
2. A bookmarklet (or an iOS Shortcut running the same script) on that page submits a plain form with the page URL and `document.documentElement.outerHTML` to `POST /api/import/receive`.
3. That endpoint stores nothing: it answers a tiny first-party page that parks the payload in the tab's `sessionStorage` and navigates to `/import`.
4. `/import` (signed in) shows the URL and size, and one tap posts it to `POST /api/import`, which runs every active client whose `source_url` is that page through the usual adapters → refresh plan → `photo_apply_refresh` RPC → history → notifications. The `[watch]` log line carries `strategy: "import:table"` (or `import:embedded-json`, …).

Safety: the hand-over accepts only `Origin`s on the allow-listed source hosts (or the app itself), is rate-limited per address and capped at 3 MB, and never auto-imports: the signed-in page asks for a tap first. `/api/import` requires the session like `/api/watch` and is rate-limited per user. A handed-over page that is still the challenge page is reported as `BROWSER_CHALLENGE` with a message to pass the check first. `/import` also accepts pasted HTML (desktop: view-source, select all, copy) and reads the page URL from its canonical tag.

### Capture trust (Phase A)

Every applied page, whatever brought it (import page, bookmarklet hand-over,
the Windows agent, the render worker), is recorded in `photo_captures` with a
client-stable capture id, the owner-neutral **source identity**, source and
final URL, transport, captured / received / applied times, a content hash and a
completeness label. The rules, with the tests that pin them, are in
[captures.md](captures.md):

- **Source identity** keeps the query parameters that select a bracket /
  category / division and ignores presentation ones, so two brackets on one
  path never merge and `?tab=2` never splits a page (`src/lib/capture/source-identity.ts`).
- **Capture once, apply to all**: a batch refresh fetches each owner + source
  once and parses it per athlete; captures are never shared across owners.
- **Replay** of a capture id reports the earlier outcome instead of applying
  twice; **out-of-order** captures older than the newest applied one are
  refused (`STALE_CAPTURE`); implausible times (future, or older than 12 h)
  are refused (`CAPTURE_TIMING`); a final URL that is another bracket is
  refused (`FINAL_URL_MISMATCH`). Owner identity always comes from the
  session or credential, never from the body.
- The render worker now waits (bounded) for a **ready** page — not a
  challenge, login, error page or empty app shell, and the page that was
  asked for — then expands virtualised rows, "next / load more" pages and
  same-origin frames within fixed bounds and labels the capture
  `complete`, `partial` or `unknown` (`worker/src/readiness.mjs`).

### Windows event-session agent (Phase B)

When the automatic worker is blocked and the photographer cannot keep sending
pages by hand, a small long-running agent on the event laptop (`/agent`) keeps
each bracket page open in a real browser window and posts it once a minute to
a **separate machine-intake endpoint**, `POST /api/capture` (JSON), with
`GET /api/capture/jobs` for its job list and `POST /api/capture/heartbeat`.
It authenticates with a revocable, expiring, owner/event-scoped **capture
credential** created in Settings → Capture agent — never the service-role key.
The HTML form hand-over (`/api/import/receive`) and the signed-in import page
are unchanged. Durable spool, capture-id replay, backoff with `Retry-After`,
pause on a human check and a clean stop are built in. Setup, start/stop and
recovery: [windows-agent.md](windows-agent.md).

### `CHALLENGE_NOT_CLEARED` — what it means and what to do

The worker answers `CHALLENGE_NOT_CLEARED` when the page is still Cloudflare's "Just a moment…" interstitial after `CHALLENGE_WAIT_MS`. The app records it per athlete as `REQUIRES_BROWSER_WATCHER` / code `BROWSER_CHALLENGE`, keeps the last known matches on screen marked **Stale**, and keeps the manual **Open source page** button, which is the guaranteed fallback at the mats.

**Status as of 2026-10-02:** real `/render` requests for AJP and Smoothcomp bracket pages from Railway return `CHALLENGE_NOT_CLEARED` in every browser mode tried (Playwright new-headless, Patchright headless, Patchright headed under Xvfb). The parser has therefore **not** been exercised on real bracket markup; the fixtures in `tests/fixtures/` are synthetic. Do not treat the browser path as working until a real render returns usable HTML and `[watch] OK` appears in the logs with `matches > 0`.

What is needed, in order of likelihood of success:

1. **Persistent volume** at `/data` (already configured): once a challenge clears, the `cf_clearance` cookie in the Chromium profile keeps the site open for its lifetime.
2. **A residential or ISP egress IP you are permitted to use** (`BROWSER_PROXY=http://user:pass@host:port`): Cloudflare scores the data-centre IP first. Use a provider whose terms allow this traffic; the worker does not and must not try to defeat interactive (Turnstile) challenges.
3. **A hosted browser service** (`BROWSER_WS_ENDPOINT=wss://…`) that handles challenges on its own infrastructure.
4. **A browser-friendly deployment** closer to a normal client (for example a small VM or Mac mini on a home / office connection running `worker/` with `HEADLESS=headed`).

If a page shows an interactive CAPTCHA, the correct response is to open the source page by hand; the worker will keep reporting `CHALLENGE_NOT_CLEARED` and must not be modified to bypass it. "Stealth" or "Cloudflare bypass" packages are not dependencies of this project and must not become ones.

### Scheduled refresh while phones are locked

`POST /api/cron/refresh` processes **one page per call** (default 40 athletes, max 200) ordered by last attempt (never-attempted first), honours a per-athlete cooldown, and returns `{ eligible, processed, failed, skipped, remaining, cursor, changes, statuses }`; pass `cursor` back to continue. The worker's scheduler follows the cursor automatically (up to 10 pages per tick). The route stops after ~240 s and reports what is left as `remaining`.

`POST /api/cron/refresh` refreshes every active athlete of every active event whose date is today (±1 day in the event's timezone), for all owners, without a user session. Configure:

- App (Vercel): `CRON_SECRET` (random string) and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API → `service_role`; server-side only, never `NEXT_PUBLIC_`).
- Worker (Railway): `SCHEDULE_SECONDS=60`, `APP_URL=<the app origin; see overhaul/INTEGRATIONS.md>`, `CRON_SECRET=<same>`.

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

## Reliability notes

- **Offline:** the auto-refresh loop pauses while the browser is offline, keeps the last known schedule on screen, and refreshes promptly when connectivity returns.
- **Multiple tabs:** only one tab runs the automatic loop (Web Locks API, localStorage lease fallback); the others follow.
- **Backoff:** failed batch calls double the interval (max 5 min); `429` responses are honoured via `Retry-After`.
- **Concurrent refreshes** of the same athlete (two taps, two tabs, cron + tap) are serialised in the database; the loser receives the winner's rows and `skipped: "CONCURRENT"`.
- **Alerts** are announced once per threshold crossing (30 → 15 → 5 → GO TO MAT) through `aria-live` regions (assertive for danger, polite otherwise); banners stay until dismissed.
- **Settings** are cached per device in localStorage and synced to `photo_user_settings` so another device starts from the same preferences.

## Collaboration and coverage

A photographer (event owner) can invite collaborators to an event and assign
each client to a photographer and/or a videographer:

- **Invite / remove** collaborators by email on the event page (they need an
  account already; `SUPABASE_SERVICE_ROLE_KEY` resolves the email server-side).
- **Assign** a photographer / videographer per client on the client page.
- **Photos done** and **Video done** are separate, independently togglable,
  timestamped and attributed; tapping again undoes them. Completion is kept
  apart from the competition match status and is never cleared by a refresh.
- **Collaborators** see only `/coverage`: their events and the clients assigned
  to them, with mat, time, opponent and status — never phone, email, academy,
  package or notes. Removing a collaborator clears their assignments and stops
  their reads and writes immediately.

This is enforced in Postgres, not just the UI: collaborators reach data only
through SECURITY DEFINER functions (`photo_collaborator_board`,
`photo_collaborator_events`, `photo_set_coverage_done`) scoped to
`auth.uid()`; existing table policies are unchanged. See
`supabase/migrations/20261003000000_collaboration_coverage.sql` and the
authorization test `supabase/tests/coverage_rls.test.sql`.

### Offline completion and manual corrections (Phase C)

- **Photos done / Video done work offline.** A tap records a desired-state
  command (`{athlete, kind, done, expectedDoneAt, commandId}`) in
  `localStorage` *before* anything is sent; a sync loop replays commands one
  at a time through `applyCoverageCommand` → `photo_apply_coverage_command`,
  which re-checks the session and assignment, applies idempotently by command
  id (`photo_coverage_commands` log) and reports a **conflict** when someone
  else changed the same kind since the client looked. A command is removed
  only when the ack names its id and it is still the live command for that
  athlete + kind, so a late ack can never delete a newer tap. UI states:
  *Pending sync*, *Saved*, *Failed — will retry*, *Conflict* (apply mine /
  keep theirs). `src/lib/offline/coverage-queue.ts`, `tests/coverage-queue.test.ts`,
  `supabase/tests/coverage_commands.test.sql`.
- **Owner manual mat / time corrections.** On a client's page the owner can
  correct the mat and/or time (reason optional). The correction is stored in
  `override_*` columns beside the source values, attributed and timestamped,
  expires at the end of the event day by default, is labelled **Manual**
  wherever the match is shown, and drives ranking/ETA. An automatic capture
  never silently overwrites it: it is carried forward while the source still
  says what it said, and dropped explicitly with an `OVERRIDE_SUPERSEDED`
  history entry when the source itself changes that field.
  `src/lib/manual-correction.ts`, `tests/manual-correction.test.ts`.

