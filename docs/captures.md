# Capture trust — how a bracket page becomes client data

This document describes the guarantees around *capturing* a source page
(AJP / Smoothcomp) and *applying* it to the owner's clients. It covers every
transport: the signed-in Import page, the bookmarklet / iOS Shortcut hand-over,
the render worker, and the Windows event-session agent.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Capture** | One observation of one source page at one moment: the rendered HTML plus metadata. |
| **Capture id** | Client-chosen, stable id (UUID or `cap-…`). Unique **per owner**. The same id is never applied twice. |
| **Source identity** (`source_key`) | Owner-neutral key for "the same page": `host\|path\|bracket-selecting params`. `src/lib/capture/source-identity.ts`. |
| **Transport** | `import` (pasted on the Import page), `handoff` (bookmarklet / Shortcut form POST), `agent` (Windows agent), `worker` (Railway render worker), `http` (plain fetch). |
| **Completeness** | `complete` — nothing more was offered by the page; `partial` — a bound stopped the expansion; `unknown` — the transport could not tell. |

## Source identity

A path-only key would merge distinct brackets that differ only by a query
parameter (Smoothcomp `?category=`, `?bracketId=`), attributing one bracket's
mats and times to clients on another. Identity therefore:

- lower-cases the host and drops `www.`;
- drops a leading locale segment (`/en/`, `/ar/`, `/pt-br/`), the trailing
  slash and the hash;
- **keeps** parameters whose name matches
  `bracket|category|division|class|group|pool|stage|round|day|mat|weight|belt|age` (optionally `_id`, plural), sorted;
- **ignores** everything else (`tab`, `page`, `sort`, `lang`, `utm_*`…).

Examples: `…/bracket/130617?tab=2` ≡ `…/bracket/130617`;
`…/schedule?category=12` ≠ `…/schedule?category=13`.

Pinned by `tests/source-identity.test.ts`.

## The ledger: `photo_captures`

One row per capture, owner-isolated by RLS (`owner_id = auth.uid()`), with a
unique index on `(owner_id, capture_id)`. Columns: source/final URL,
`source_key`, transport, `captured_at` (client), `received_at` (server),
`applied_at`, status `received → applied | rejected` (+ `reject_code`),
`content_hash` (sha256 of the HTML), `bytes`, `completeness`, `athlete_count`,
a compact `outcome` and **redacted** `diagnostics` (fixed allow-list of scalar
keys; never HTML, names, headers or cookies — `redactDiagnostics`).

Migration: `supabase/migrations/20261004000000_captures.sql`.
Isolation test: `supabase/tests/captures_rls.test.sql`.

## Applying a capture (`importPage`)

In order; each step is tested in `tests/import-service.test.ts`:

1. **URL policy** and **challenge page** rejection — nothing stored.
2. **Timing plausibility** — `capturedAt` more than 5 min in the future or
   older than 12 h is refused (`CAPTURE_TIMING`, HTTP 422). Stale tabs never
   look fresh.
3. **Final URL** must have the same source identity as the requested URL
   (`FINAL_URL_MISMATCH`, 422). Locale / tab variants are fine.
4. Load the owner's active clients whose `source_url` has the same identity
   (`NO_ATHLETES`, 404, lists the tracked pages).
5. **Register** the capture. A duplicate `(owner, capture_id)`:
   - already `applied` → returns the stored outcome with `capture.replayed: true`
     and applies nothing (no duplicate history when a phone retries);
   - already `rejected` → returns the same rejection;
   - still `received` for < 2 min → `CAPTURE_IN_PROGRESS` (409);
   - `received` and older → considered abandoned and taken over.
6. **Out-of-order** — if the newest *applied* capture of this owner + source
   was captured later than this one → `STALE_CAPTURE` (409) and the row is
   marked rejected. Captures of *other* brackets never block.
7. Apply through the normal pipeline (`refreshAthletes` → plan → `photo_apply_refresh`
   → history → notifications), then mark the capture `applied`.

Owner identity is the authenticated session (`/api/import`) or the capture
credential (machine intake, Phase B). The body cannot name an owner; a
`capture.ownerId` field is rejected (`INVALID_CAPTURE`).

## Capture once, apply to all

`refreshAthletes` builds one page cache per batch. `watchUrl` is called with
`cacheKey = owner_id|source_key`; the network step (plain fetch, then the
browser worker if needed) runs once per key and the HTML is parsed per athlete
with that athlete's name. Keys always include the owner, so two owners
watching the same public page each fetch it (never share a capture).
Diagnostics carry `shared: true` on the athletes that reused a fetch.

Pinned by `tests/watch-url.test.ts` ("capture-once…") and `tests/watch-service.test.ts`.

## Bounded readiness in the render worker

After the challenge wait, `worker/src/browser.mjs` polls
`assessReadiness()` (`worker/src/readiness.mjs`, pure, tested) every 750 ms
until the page is ready, a terminal verdict is reached or `READY_WAIT_MS`
(default 15 s) passes:

| Verdict | Meaning | Result |
| --- | --- | --- |
| `SCHEDULE_FOUND` | table rows / match cards / embedded schedule JSON present | ready |
| `NO_SCHEDULE_YET` | real page saying the schedule is not published | ready, empty |
| `NO_SCHEDULE_STRUCTURE` | real content, nothing schedule-like | ready; the app's parser decides |
| `UNHYDRATED` | empty app shell with scripts | keep waiting (bounded) |
| `HTTP_ERROR` / `CHALLENGE` / `WRONG_PAGE` / `LOGIN_PAGE` / `ERROR_PAGE` | terminal | `PAGE_NOT_READY` (502) with `readiness` |

`WRONG_PAGE` compares the landed URL to the requested one by host + path
(locale-insensitive); a redirect to another event is never captured.

When a schedule is present the worker then **expands** within bounds:
scrolls to the bottom until the height settles (`MAX_SCROLL_PASSES`, 6),
follows `rel=next` / pagination / "load more" controls (`MAX_EXPAND_PAGES`, 4,
appending each page's body inside the first document), and appends
same-origin frames (`MAX_FRAMES`, 4). Hitting any bound → `completeness:
"partial"`; an exception → `"unknown"`. The size bound (`MAX_HTML_BYTES`)
still applies to the combined document.

The app maps `PAGE_NOT_READY` to `FETCH_ERROR / BROWSER_PAGE_NOT_READY`
(last-known data stays visible) and persists `completeness` / `readiness` in
the refresh diagnostics.

## Hand-over (bookmarklet / Shortcut)

`/api/import/receive` is unchanged in role: it stores and decides nothing. The
bookmarklet now also posts `captureId` (a fresh UUID) and `capturedAt`; the
receive page parks them with the HTML and the signed-in Import page sends them
as `capture` on Apply with `transport: "handoff"` and `finalUrl` = the page's
location. A pasted page gets a per-paste capture id too, so a retried Apply
replays instead of re-applying.

## Status

| Item | Status |
| --- | --- |
| Source identity, envelope, ledger store, import pipeline, capture-once, worker readiness | Implemented, locally verified (vitest + worker `node --test`) |
| `photo_captures` migration | Written; **not applied to the hosted project** (needs authorization — production deploys from this branch, so apply the migration before pushing) |
| `captures_rls.test.sql` | Written; run against a disposable database |
| Worker readiness against the live source | Not live-verified (the live source currently serves an interactive challenge to the worker) |
