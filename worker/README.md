# Tournament Watcher — render worker

Playwright service that renders AJP / Smoothcomp pages in a real Chromium so the
app can read schedules that sit behind a bot challenge. Full setup, endpoints and
troubleshooting live in the main [README](../README.md#playwright-render-worker-worker).

```bash
cp .env.example .env            # set WORKER_TOKEN
npm install                     # Playwright downloads Chromium on first install
npm start                       # http://localhost:8080/health
```

Deploy on Railway from this directory (Dockerfile) with a volume at `/data`.
