# Delivery report — phases A–F (improvement program, round 2)

Branch `claude/hopeful-wright-t7jlm9`, six local commits on top of the
reviewed `775879d` (PR #14). Nothing has been pushed, no hosted migration
applied, nothing activated — those need the explicit go-ahead listed at the
end, because production (Vercel) deploys from this branch and the new code
depends on the new schema.

## 1. Status ledger

Legend — **Implemented**: code + tests exist locally. **Locally verified**:
`npm run typecheck`, `npm run lint`, `npm test` (421 tests), worker
`node --test` (42), agent `node --test` (16) and `next build` pass on this
checkout. **Live verified**: observed working against the hosted project /
real source. **Blocked**: cannot be completed from here, with the dependency.

| # | Item | Implemented | Locally verified | Live verified | Blocked / notes |
| --- | --- | --- | --- | --- | --- |
| A1 | Source identity preserving bracket / category params (`src/lib/capture/source-identity.ts`) | ✅ | ✅ | — | — |
| A2 | Capture ledger `photo_captures`: capture-id replay, out-of-order refusal, timing plausibility, final-URL check, redacted diagnostics | ✅ | ✅ | ❌ | migration `20261004000000` not applied (authorization) |
| A3 | Capture once per owner+source in batch refreshes | ✅ | ✅ | — | — |
| A4 | Worker bounded readiness + expansion with complete/partial/unknown | ✅ | ✅ (unit; no real browser in this sandbox) | ❌ | live source still serves an interactive challenge to the worker |
| A5 | Bookmarklet / hand-over carry capture id + time; Import page replay / stale hints | ✅ | ✅ | ❌ | needs deploy |
| B1 | Capture credentials (hash, expiry, revoke, event scope) + Settings card | ✅ | ✅ | ❌ | migration `20261004010000` |
| B2 | `POST /api/capture`, `GET /api/capture/jobs`, `POST /api/capture/heartbeat` | ✅ | ✅ | ❌ | needs deploy + credential |
| B3 | Windows agent (`/agent`): session, one-minute jobs, spool, replay, backoff, pause on human check, clean stop | ✅ | ✅ (fake app; no Windows/Chrome here) | ❌ | needs a laptop at an event |
| C1 | Offline coverage commands (persist-before-send, exact-ack delete, conflict) + `photo_apply_coverage_command` | ✅ | ✅ | ❌ | migration `20261004020000` |
| C2 | Owner manual mat/time corrections with provenance, lifetime, explicit supersede | ✅ | ✅ | ❌ | same migration (re-creates `photo_apply_refresh`) |
| D1 | Lease-based claim RPC + independent runner (`/api/cron/deliveries`, worker tick) | ✅ | ✅ | ❌ | migration `20261004030000`; worker env `DELIVERY_SECONDS` |
| D2 | 15/5-min reminders independent of captures, [Match]/[Orders]/[System] prefixes, dry run in tests | ✅ | ✅ | ❌ | — |
| E1 | Orders intake contract + `POST /api/orders/intake` + `photo_record_order` (atomic outbox) | ✅ | ✅ (synthetic fixtures) | ❌ | migration `20261004040000`; **real Pic-Time payload never seen** — mapping is a proposal |
| E2 | Owner-only `/orders` pages, offline-payment confirmation, RLS test | ✅ | ✅ | ❌ | — |
| F1 | Regressions (invalid-before-valid, failed→success, late failure, signature≠paid, unmatched invoice, isolation) | ✅ | ✅ | — | — |
| F2 | Atomic `photo_apply_payment_transition` + confirmation job `/api/cron/payments` | ✅ | ✅ | ❌ | migration `20261004050000`; production payments **off** by design |
| F3 | Fulfilment | shipped **disabled** | ✅ | — | dependency: verified Pic-Time order-approval integration |
| S | SQL isolation / concurrency tests (`supabase/tests/*.sql`) | ✅ written | ❌ not executed here | ❌ | need a disposable Postgres with one seeded owner |

## 2. What changed (per phase)

- **A — trustworthy bracket capture** (`57d8e00`): `docs/captures.md`.
- **B — credentials, machine intake, Windows agent** (`29932ac`): `docs/windows-agent.md`, `agent/README.md`.
- **C — offline completion + manual corrections** (`7ac6a1e`): README "Offline completion and manual corrections".
- **D — independent delivery runner** (`c382fa9`): `docs/telegram.md` "Delivery: producers and the independent runner".
- **E — Pic-Time orders** (`a9f6610`): `docs/orders-intake.md` (contract, Zapier mapping, fixtures).
- **F — MyFatoorah** (`4004d47`): `docs/payments.md` "Phase F" + activation + rollback.

143 files, +8 278 / −461 lines. Hand-maintained `database.types.ts` updated with every migration.

## 3. Migrations (additive, in order) and how to apply

```
supabase/migrations/20261004000000_captures.sql
supabase/migrations/20261004010000_capture_credentials.sql
supabase/migrations/20261004020000_coverage_commands_and_overrides.sql
supabase/migrations/20261004030000_delivery_runner.sql
supabase/migrations/20261004040000_orders_intake.sql
supabase/migrations/20261004050000_payment_transition_rpc.sql
```

- Supabase CLI present in the sandbox: `npx supabase --version` → `2.119.0`.
  Normal path: `supabase link --project-ref nuujdewnkovtdvlbfzdx && supabase db push`
  (needs the database password / access token — not available here).
- Alternative used for PR #14: paste each file into the SQL editor. All six are
  idempotent (`if not exists`, `create or replace`, guarded policies). Three
  statements use `drop constraint if exists … add constraint` (status / kind
  check constraints); through the MCP `execute_sql` path, which hangs on
  DROP, run those two-liners from the SQL editor instead.
- **Order matters once**: apply all six before pushing this branch, because
  Vercel builds and serves the new routes immediately.
- Rollback: the schema is additive; to roll back behaviour, revert the branch
  (or redeploy `775879d`) — old code ignores the new columns/tables. The only
  replaced object is `photo_apply_refresh`, whose new body is a superset of
  the old; the old definition is in `20261002150000_watcher_v2.sql` if ever
  needed.

## 4. Operations: env, runners, recovery

New / changed environment (all templated in `.env.example`, `worker/.env.example`, `agent/agent.env.example`):

| Where | Variable | Default | Purpose |
| --- | --- | --- | --- |
| Vercel | `ORDERS_INTAKE_ENABLED` | off | `POST /api/orders/intake` |
| Vercel | `TELEGRAM_REMINDER_MINUTES` | `15,5` | reminder leads |
| Vercel | `TELEGRAM_DRY_RUN` | off | log instead of send (tests always dry-run) |
| Vercel | `PAYMENTS_RECONCILE_ENABLED` | off | provider calls from the confirmation job |
| Railway worker | `DELIVERY_SECONDS` | 30 when `SCHEDULE_SECONDS` set | notification runner tick |
| Railway worker | `PAYMENTS_SECONDS` | off | payment confirmation job tick |
| Railway worker | `READY_WAIT_MS`, `MAX_EXPAND_PAGES`, `MAX_SCROLL_PASSES`, `MAX_FRAMES` | 15000 / 4 / 6 / 4 | readiness + expansion bounds |
| Windows agent | `APP_URL`, `CAPTURE_TOKEN` (+ optional `BROWSER_CHANNEL`, `INTERVAL_SECONDS`, `READY_WAIT_MS`, `AGENT_DATA_DIR`) | — | see `docs/windows-agent.md` |

Runners (none is a `setInterval` in a request module): the Railway worker
process ticks `/api/cron/refresh`, `/api/cron/deliveries`, and optionally
`/api/cron/payments` with `CRON_SECRET`; each endpoint is bounded and safe to
run twice. Recovery guides: `docs/windows-agent.md` (agent), `docs/telegram.md`
(deliveries: leases expire, 429 releases the claim), `docs/payments.md`
(GetWebhooks replay, rollback), `docs/captures.md` (stale / out-of-order
captures are refused by design).

## 5. Security review notes

- Owner identity never comes from a request body: session (`/api/import`,
  actions), capture credential (`/api/capture/*`), orders credential
  (`/api/orders/intake`), or the credential's owner inside SECURITY DEFINER
  RPCs. Body fields like `ownerId` are rejected or ignored (tests).
- The service-role key stays on Vercel; the Windows agent and the Zap hold
  revocable, expiring, kind-specific tokens (hash stored, shown once).
- Collaborators cannot read orders, payments or captures (owner-only RLS; no
  collaborator function touches those tables; `orders_rls.test.sql`).
- No tracked athlete is ever created or linked from an order or payment
  (`athlete_name_hint` is free text; `pending_athlete_link` stays a flag).
- Production Telegram messages: the default sender is a dry run under
  Vitest / `TELEGRAM_DRY_RUN=1`; no hard-coded chat ids or topics.
- Payments: production operations remain off; fulfilment is hard-disabled with
  its dependency named; prices are never invented (orders without an amount
  are refused; replays never change amounts).
- Logs and stored diagnostics are allow-listed scalars (no HTML, names,
  tokens, cookies). Agent logs mask its own token.

## 6. Cost measured locally

`npm run typecheck` ≈ 25 s, `npm run lint` ≈ 20 s, `npm test` 421 tests ≈
25 s, worker 42 tests ≈ 3 s (browser integration excluded), agent 16 tests
≈ 1 s, `next build` ≈ 1–2 min in this sandbox. CI gains one small job
(agent). Database: +4 tables (`photo_captures`, `photo_capture_credentials`,
`photo_coverage_commands`; `photo_orders` extended), +6 columns on
`photo_matches`, +3 on `photo_notification_deliveries`, +4 functions,
+1 re-created function, +7 indexes. Runtime: one extra bounded HTTP tick every
30 s from the worker (deliveries); batch refreshes make fewer source fetches
than before (capture-once).

## 7. Completion report (six points)

1. **Done and verified locally**: A–F as listed; every phase has failing-
   first tests that now pass, typecheck/lint/build clean, independent commits.
2. **Done but not live-verified**: everything that touches the hosted schema
   or a real device/service (ledger column "Live verified ❌").
3. **Explicitly not done / shipped disabled**: automatic Pic-Time fulfilment
   (dependency named); production payments and reconciliation calls (flags
   off); real Pic-Time payload mapping (proposal + synthetic fixtures until a
   Zap test run shows the true fields).
4. **Blocked, needs you**: (a) authorization to apply the six additive
   migrations to `nuujdewnkovtdvlbfzdx`; (b) authorization to push this
   branch (auto-deploys production) — in that order; (c) a Windows laptop +
   event to live-verify the agent; (d) a Pic-Time test order through Zapier;
   (e) MyFatoorah test-portal run per the activation procedure.
5. **Risks**: the delivery runner replaces inline sending — until the worker
   has `DELIVERY_SECONDS` (default on when `SCHEDULE_SECONDS` is set) or
   another cron calls `/api/cron/deliveries`, retries and reminders wait and
   only the per-owner kick sends. Source identity now keeps bracket params:
   clients whose stored URL differs only by a non-identity param still match;
   clients on different `?category=` values are now correctly separate.
6. **Next step on go-ahead**: apply migrations → push → create draft PR →
   set `NEXT_PUBLIC_SITE_URL`, confirm `DELIVERY_SECONDS` on Railway →
   create a capture credential and run the agent once (`npm run once`) →
   run the Zap test step → report live results in this ledger.
