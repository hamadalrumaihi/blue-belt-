# Tournament Watcher — capture agent (Windows event laptop)

A small long-running Node program that keeps the clients' bracket pages open
in a real browser window on the event laptop and sends what it sees to the
app once a minute. It replaces the automatic worker when the source only
answers to a real browser on a normal connection, and it never asks the
photographer to tap anything after setup.

Full install / start / stop instructions, recovery and the security model are
in [docs/windows-agent.md](../docs/windows-agent.md).

```text
agent/
  src/main.mjs       loop: replay spool → refresh jobs → capture due sources → heartbeat
  src/session.mjs    one persistent browser context (dedicated profile) + one tab per source
  src/schedule.mjs   due logic (no catch-up), backoff, Retry-After, upload verdicts
  src/spool.mjs      durable on-disk queue (write before upload, delete after ack)
  src/uploader.mjs   POST /api/capture, GET /api/capture/jobs, POST /api/capture/heartbeat
  src/readiness.mjs  re-export of worker/src/readiness.mjs (same "is this a real schedule page?" rules)
  start-agent.cmd    double-click to start on Windows
  agent.env.example  configuration template (copy to agent.env)
```

Security contract:

- Authenticates with a **capture credential** (`bbmc_…`) created by the owner
  in Settings → Capture agent; it is owner-scoped, optionally event-scoped,
  expires (≤ 14 days) and can be revoked at any time. The Supabase
  service-role key is never on the laptop.
- The browser profile lives in a dedicated folder
  (`%LOCALAPPDATA%\BlueBeltAgent\profile`), not the user's Chrome profile.
- Only `https://` pages the app's job list names are opened; the app enforces
  its host allow-list and the credential's scope on every upload.
- Logs are JSON lines with hosts, codes, sizes and timings — never tokens,
  cookies or page HTML.

```bash
npm install
npm test        # node --test: schedule, spool, config, one full tick against a fake app
npm start       # needs agent.env
npm run once    # one tick, then exit (useful for checking the setup)
```
