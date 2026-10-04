# Windows event-session agent — setup, operation, recovery

The agent runs on the laptop that is physically at the event. It keeps each
bracket page open in a real browser window and sends the page to the app once
a minute, so the dashboard keeps updating even while the automatic worker is
blocked by the site's human check. The photographer does nothing after setup,
except solve a human check in the browser window if the site asks for one.

## What it needs

| Item | Where from |
| --- | --- |
| Windows 10/11 laptop with Google Chrome (or Edge) installed | — |
| Node.js LTS (20 or newer) | <https://nodejs.org> (default install, "Add to PATH" ticked) |
| This repository (the `agent/` and `worker/` folders) | `git clone …` or the ZIP from GitHub |
| A **capture credential** | App → Settings → Capture agent → *Create credential* |
| The app origin | e.g. `https://tournament-watcher.vercel.app` |

The credential is the agent's only secret. It is scoped to your account (and
optionally one event), expires after 1–14 days, and the Revoke button stops it
immediately. **Never** put the Supabase service-role key, your password or
the cron secret on the laptop — the agent has no use for them and refuses to
start with anything but a `bbmc_…` credential.

## Install (once per laptop)

1. Install Node.js LTS.
2. Unzip / clone the repository, e.g. to `C:\BlueBelt\blue-belt`.
3. Open `C:\BlueBelt\blue-belt\agent`, copy `agent.env.example` to `agent.env`
   and set:
   ```ini
   APP_URL=https://tournament-watcher.vercel.app
   CAPTURE_TOKEN=bbmc_xxxxxxxx_…   (from Settings → Capture agent)
   ```
4. Double-click `start-agent.cmd`. The first run installs dependencies
   (`npm install`), then a browser window opens.

The browser uses its own profile under `%LOCALAPPDATA%\BlueBeltAgent\profile`;
your personal Chrome profile is untouched. Captured pages waiting to be sent
are kept under `%LOCALAPPDATA%\BlueBeltAgent\spool`.

## Start / stop

- **Start**: double-click `agent\start-agent.cmd` (or `npm start` in that
  folder). Leave the black console window and the browser window open.
- **Stop**: press `Ctrl+C` in the console window, or close it. The agent
  finishes the step it is on, sends a last heartbeat and closes the browser.
  Anything not yet acknowledged by the app stays in the spool and is sent on
  the next start.
- **Check the setup without waiting**: `npm run once` runs a single cycle
  (jobs → captures → heartbeat) and exits.

Optional: to start it automatically when you log in, create a Task Scheduler
task "At log on" that runs `C:\BlueBelt\blue-belt\agent\start-agent.cmd`
with *Run only when user is logged on* (the browser window must be visible).

## What you see

- Console: one JSON line per step plus plain `>>>` messages for people:
  `Capture agent started…`, `The site is asking for a human check…`,
  `Human check cleared…`, `The capture credential has expired…`.
- App → Settings → Capture agent: the credential row shows *agent online*
  with its last heartbeat, state (`running` / `paused: human check` /
  `stopped`), queued captures and last error.
- App → clients: source age shows the capture time; the method reads
  "agent" in diagnostics.

## How a cycle works

Every ~30 s (never overlapping):

1. **Replay the spool** — captures the app has not acknowledged yet are
   re-sent first, with their original capture id, so a double send is a
   harmless replay on the server.
2. **Refresh the job list** (every 5 min) — `GET /api/capture/jobs` returns
   one job per *source identity* of today's active events for this
   credential's owner and scope. No local list of URLs to maintain.
3. **Capture due sources** — a source is due 60 s after its last start.
   Missed intervals are not caught up (a laptop that slept an hour captures
   once). Each capture: reload the tab → wait (≤ 15 s) for a real schedule
   page → write to the spool → `POST /api/capture` → delete from the spool
   on a terminal answer.
4. **Heartbeat** — `POST /api/capture/heartbeat` with state, queue size and
   counters (no page content).

Upload answers:

| Answer | Agent does |
| --- | --- |
| 200 applied / replayed | delete from spool |
| 409 `STALE_CAPTURE`, 404 `NO_ATHLETES`, 403 `OUT_OF_SCOPE`, 422 `CAPTURE_TIMING` / `FINAL_URL_MISMATCH` / `CHALLENGE_PAGE` | delete from spool (the server's verdict is final for that capture) |
| 429 / 5xx / network error | keep, retry with exponential backoff (2 s → 5 min, jitter), honouring `Retry-After` |
| 401 `CREDENTIAL_EXPIRED` / `CREDENTIAL_REVOKED` | stop the agent with a message; spool kept |

## Human check (Cloudflare)

When the page shows the site's human check, the agent **pauses** all
captures, brings that tab to the front and prints
`The site is asking for a human check. Solve it in the browser window…`.
Solve it in that window (click the checkbox, etc.). The agent notices the
page is back, prints `Human check cleared`, and resumes. Nothing is captured
while paused, so no challenge page is ever applied to clients.

## Recovery

| Symptom | What to do |
| --- | --- |
| `Configuration problem: CAPTURE_TOKEN must be…` | The token in `agent.env` is not a capture credential. Create one in Settings and paste it exactly. |
| `The capture credential has expired` | Create a new credential, replace `CAPTURE_TOKEN`, start again. The spool is sent automatically. |
| `No clients to watch right now` | No active event is today (±1 day in its timezone), or the credential's event scope has no clients. Check the event date / scope. |
| Console shows `capture.failed … PAGE_NOT_READY LOGIN_PAGE` | The site wants a login in that tab. Sign in once in the agent's browser window; the profile remembers it. |
| `capture.queued … NETWORK` repeating | Laptop offline. Captures accumulate (newest 200 kept) and are sent when the network returns; the oldest beyond the freshness window are refused as `CAPTURE_TIMING` and dropped, which is correct — stale pages must not look fresh. |
| Browser window closed by accident | The next cycle reopens it. |
| Laptop rebooted | Start the agent again (or use the Task Scheduler task). Spool is replayed first. |
| Want to stop everything now | Settings → Capture agent → Revoke. The agent stops at its next upload. |

## Where the data goes

The agent posts to the app only. The app records every capture in
`photo_captures` (owner, capture id, source, times, hash, completeness,
outcome) and applies it through the same pipeline as a manual import; see
[captures.md](captures.md). The credential cannot read orders, settings,
other owners' data or anything but its own job list and heartbeat answer.

## Status

| Item | Status |
| --- | --- |
| Credentials (create / revoke / expiry / scope), Settings card | Implemented, locally verified (vitest) |
| `/api/capture`, `/api/capture/jobs`, `/api/capture/heartbeat` | Implemented, locally verified (vitest, incl. scope, rate limits, replay codes) |
| Agent loop, spool, backoff, pause on human check, graceful stop | Implemented, locally verified (`agent/npm test` against a fake app; no real browser in CI) |
| `photo_capture_credentials` migration | Written; not applied to the hosted project (needs authorization) |
| End-to-end on a Windows laptop against the live app | **Not live-verified** — requires the migration applied, a credential, and a laptop at an event |
