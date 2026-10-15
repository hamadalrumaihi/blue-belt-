# Tournament Watcher — render worker

Playwright service that renders AJP / Smoothcomp pages in a real Chromium so the
app can read schedules that sit behind a bot challenge. Full setup, endpoints,
`CHALLENGE_NOT_CLEARED` guidance and troubleshooting live in the main
[README](../README.md#playwright-render-worker-worker).

```bash
cp .env.example .env            # set WORKER_TOKEN
npm install                     # Playwright downloads Chromium on first install
npm start                       # http://localhost:8080/health
npm test                        # node --test: HTTP contract, URL policy, config
BBM_WORKER_BROWSER_TESTS=1 npm test   # also launches Chromium against a local page
```

Security contract:

- `POST /render` needs `Authorization: Bearer <WORKER_TOKEN>`; `GET /health` is public but only reports `ok / browserReady / mode` without the token.
- Only `https://` URLs on `ALLOWED_HOSTS` (default `ajptour.com,smoothcomp.com` and subdomains) are opened: no credentials, no custom ports, no IP literals. The page the browser lands on after redirects must pass the same policy or the HTML is discarded (`REDIRECT_BLOCKED`).
- Logs are JSON lines without tokens, cookies or page HTML (only byte counts, hosts, paths, codes and timings).
- `--no-sandbox` is only added when `CHROMIUM_NO_SANDBOX=1` (set in the Dockerfile for Railway, where the container has no user namespaces); drop it on hosts that permit the sandbox.

Deploy on Railway from this directory (Dockerfile) with a volume at `/data`.

## Configuration reference

Every variable is read in `src/config.mjs` (defaults there). `.env.example` lists the common ones; these are the rest:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAX_HTML_BYTES` | 3 MB | cap on the rendered HTML returned by `/render` |
| `READY_WAIT_MS` | 15000 | bounded wait for a real schedule page after the challenge cleared (`src/readiness.mjs`) |
| `MAX_EXPAND_PAGES` / `MAX_SCROLL_PASSES` / `MAX_FRAMES` | 4 / 6 / 4 | bounded expansion of "next / load more", virtualised rows and same-origin frames |
| `USER_AGENT` | a desktop Chrome string | browser user agent |
| `CHROMIUM_EXTRA_ARGS` | — | extra Chromium flags, space separated |
| `LOCALE` / `TZ_ID` | `en-GB` / `Asia/Qatar` | must match the proxy's exit country; `TZ_ID` must be an IANA zone id |
| `CHROMIUM_NO_SANDBOX` | set by the Dockerfile | adds `--no-sandbox` (Railway has no user namespaces) |
| `PAYMENTS_SECONDS`, `OPS_HEALTH_SECONDS`, `PICTIME_INTAKE_SECONDS` | 0 / 900 when the refresh loop is on / 0 | extra scheduler loops (`src/scheduler.mjs`) |

Current production values (ids, URLs) and the end-to-end status of every job the worker ticks live in
[docs/overhaul/INTEGRATIONS.md](../docs/overhaul/INTEGRATIONS.md). The worker's public origin is
`https://blue-belt-production.up.railway.app`; `APP_URL` is the app origin, `https://www.bluebeltmedia.com`
(the `tournament-watcher.vercel.app` example in `.env.example` is the historical alias).
