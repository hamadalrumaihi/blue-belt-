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
