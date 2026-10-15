# Security register — Blue Belt Media overhaul (workstream F)

Audit date: 15 October 2026. Branch `claude/overhaul-2026-10` at the baseline checkpoint (`1eda7d1`), read while workstreams A–E were changing `src/lib/actions/public.ts`, `leads.ts`, `src/lib/pricing/**`, `src/lib/media/**`, the public pages and the nav. Every finding names the code **as it stood when read**; where another workstream owns the file, the status says so.

Scope: every route handler under `src/app/api/**`, every `"use server"` module in `src/lib/actions/*`, `src/proxy.ts`, every caller of `createServiceClient`, the client portal, cron authentication, webhook signature verification (MyFatoorah, e-signature, Telegram), token expiry, rate limits, input schemas, error leakage, log redaction, money units and rounding, Asia/Qatar date handling, state-transition validation, tenant selectors, the public projections, and the RLS of the pricing tables. Evidence is the code plus the tests named per row; nothing in this container can reach production secrets or the hosted database.

Severity scale: **Critical** (money or data of another tenant/person exposed or corrupted on the normal path), **High** (wrong customer-facing money/consent decision, or exposure reachable without credentials), **Medium** (defence-in-depth gap or exposure needing an unlikely precondition), **Low** (hygiene, consistency, documentation).

The integrator applies the patches; nothing outside `docs/`, `README.md`, `.env.example`, `.github/dependabot.yml`, `worker/README.md` and `agent/README.md` was changed by this workstream.

---

## 1. Findings

| # | Sev | Journey | Where (file:line as read) | Finding | Status |
|---|---|---|---|---|---|
| F-01 | **Critical** | Public request → booking amount | `src/lib/actions/public.ts` `submitPublicBooking`, the line `const quoteOnly = isClub \|\| values.booking_type === "custom" \|\| !service \|\| service.price_qr === null;` (≈ l.131) | `price_mode` is ignored. A `price_mode='quote'` service that still carries a `price_qr` yields `amount_qr > 0`, a deposit split, `payment_mode='link_later'` and `booking_status='awaiting_contract'`, while `/services` shows "Quote on request". Telegram line `service.price_qr === null ? " (quote)" : ""` has the same bug. | **In progress by A** (CHECKPOINT #10): at 15 Oct 07:30 the working tree already routes the decision through `bookableAmount(service, { quoteFirst })` in `src/lib/services/pricing.ts:55-60` (built on `publicPrice()`) and submits through a new `photo_submit_public_booking` RPC. P-01 below is the minimum A's version must satisfy; the integrator should confirm the regression test named there exists before merging. |
| F-02 | **High** | Public `/book` → browser | `src/app/(public)/book/page.tsx:34` projects `price_qr` raw; `src/app/(public)/book/BookingWizard.tsx:442` and `:549` render `formatQr(price_qr)` whenever it is non-null | The hidden price of a `quote`-mode package reaches the RSC payload and is printed in the service `<select>` and the review step ("Name: 350 QAR") although the services page says "Quote on request". The same projection forwards `description` with the "Set your price." placeholder (CHECKPOINT #2). | **Open — expected to be fixed by A** (`book/**` is A's). Patch P-02. |
| F-03 | **High** | Pay page, signing page, whole site | `next.config.ts` (no `headers()`), no `vercel.json` | No `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy` is sent. `/pay/<token>` embeds the MyFatoorah card view and `/sign/<token>` takes a typed signature; both can be framed (clickjacking) and the capability tokens in their URLs can leak through `Referer` on outbound links (`/pay` links to `/client` and to the provider; `/sign` to nothing external today). Vercel adds HSTS on custom domains but none of the others. | **Open.** Patch P-03. |
| F-04 | **Medium** | Payments (webhook → `paid`) | `src/lib/payments/myfatoorah/signature.ts:56-68`; `src/lib/payments/myfatoorah/webhook.ts:150,249-258,331-338` | MyFatoorah's documented V2 signature covers `Invoice.Id, Invoice.Status, Transaction.Status, Transaction.PaymentId, Invoice.ExternalIdentifier` only. `Amount.ValueInBaseCurrency`/`Amount.BaseCurrency` are **not signed**, yet `applyStatusToBooking` marks a booking stage `paid` from them (after `amountMismatch`). Forging is impossible without the secret and replays are deduped by event id, so the risk is a tampered first delivery (needs a man-in-the-middle on the provider's TLS leg). The return-visit path (`verifyReturnedPayment`) and the Pic-Time approval job already re-ask the provider; the webhook path does not. | **Open.** Patch P-04 (confirm with `GetPaymentStatus` before `paid` when a provider client is available; keep the current behaviour as fallback). |
| F-05 | **Medium** | Every public surface | `src/lib/rate-limit.ts` (module-level `Map`) | All limits (`publicFormPerIp` 8/10 min, `signPerIp`, `clientLoginPerIp` 6/10 min, `paymentsWebhookPerIp`, `captureAuthPerIp`…) are per warm Vercel instance; a distributed or simply persistent caller gets N× the budget, and a cold start resets it. Already documented as a known gap in `docs/studio-platform.md`. | **Open (accepted risk, documented).** Mitigation M-05: Vercel WAF rate-limit rules on `/book`, `/contact`, `/client/login`, `/sign/*`, `/pay/*`, `/api/payments/*` (no code), or a shared store (Upstash) behind the same `rateLimit()` signature. |
| F-06 | **Medium** | Public site tenant selection | `src/lib/studio/queries.ts:61-64` | Without `STUDIO_OWNER_ID` the public site serves "the earliest `photo_studio` row with `public_booking=true`". Only owner/staff profiles can create studio rows (RLS `photo_is_studio_user`), so a client cannot hijack it, but a second staff account that switches public booking on would silently take the site (or be ignored) by `created_at`. | **Open (configuration).** Set `STUDIO_OWNER_ID` in production; `.env.example` now says so. No code change required; optional patch P-06 logs a warning when more than one row qualifies. |
| F-07 | **Medium** | DB tests / CI | `supabase/tests/*.sql`, `.github/workflows/ci.yml`, no `supabase/config.toml` | README promised `supabase test db` (pgTAP) but the repo has no `supabase/config.toml`, so the CLI cannot start a local stack; only `rls.test.sql` is TAP, the other nine files are `DO` blocks that end in `raise exception 'ROLLBACK_OK…'` and would be reported as failures by `pg_prove`. The pricing RLS test (`pricing_rls.test.sql`) is therefore run by hand only. | **Open.** Not added to CI (would be red). Patch P-07 gives the job to add once `supabase init` and a TAP conversion of the DO-block tests land (workstream D owns `pricing_rls.test.sql`). |
| F-08 | **Medium** | Public paths vs new routes | `src/proxy.ts:8` `PUBLIC_PATHS` | The gate is an allow-list. The overhaul adds `/work`, `/how-it-works`, `/services/[slug]` (covered by the `/services` prefix) and keeps `/portfolio` as a redirect. `/work` and `/how-it-works` are not in the list, so they would bounce anonymous visitors to `/login` the moment they ship. `/testimonials` is listed but no such route exists. | **Expected to be fixed by B** (proxy public paths are B's). Patch P-08. |
| F-09 | **Medium** | Order intake body cap | `src/app/api/orders/intake/route.ts:48` `if (text.length > MAX_BODY_BYTES)` | Counts UTF-16 units, not bytes, so a multi-byte body without `Content-Length` can be up to 3× the 64 KB cap before it is stored as `raw` evidence. `galleries/intake` and the MyFatoorah route already use `Buffer.byteLength`. | **Open.** Patch P-09 (one-line). |
| F-10 | **Medium** | Owner tooling | `src/lib/collaborator.ts:63-79`, `src/lib/actions/coverage.ts` `findUserByEmail` | Both resolve e-mails by paging `auth.admin.listUsers` (service role) up to 2 000 users. Correct today (owner-gated by `requireOwnedEvent` first), but it enumerates every auth user, including portal clients, in memory on each call. | **Open (scale/privacy hygiene).** Patch P-10: look up by e-mail with a `SECURITY DEFINER` RPC over `auth.users` filtered to studio profiles, or cache per request. |
| F-11 | **Medium** | Cron payments | `src/app/api/cron/payments/route.ts:39-40` | `isPaymentsEnabled()` is checked before `verifyCronSecret()`, so an unauthenticated caller learns whether payments are switched on (404 vs 401). Negligible, but the other three cron routes check the secret first. | **Open.** Patch P-11 (swap two lines). |
| F-12 | **Low** | Public booking → portal | `src/lib/people/match.ts:54-72` with `src/lib/client-portal/queries.ts:106-115` | A website submission matches an existing person by e-mail (trusted=false, no overwrite). Anyone can submit a booking with a third party's e-mail; the booking then appears in that person's portal and the "booking received" e-mail goes to them. No data is disclosed to the submitter. | **Accepted (spam only).** Optional: owner-side "mark as spam / unlink" and a note in the portal that bookings are requests, not commitments. |
| F-13 | **Low** | Logs | `src/lib/log.ts` | Redaction by key (`token\|secret\|…\|session\|phone\|email\|html\|body`) and by value shape works (`tests/log.test.ts`, 45 security-relevant tests pass). Residual: Postgres error messages (`error.message`) are logged verbatim by many actions and can contain column values from constraint violations; `x-request-id` is caller-supplied (charset-limited, 4–128 chars). | **Accepted.** Recommendation: pass `error.code` + a fixed message to logs where the message can carry row data (unique-violation details). |
| F-14 | **Low** | Error text to studio users | `src/lib/actions/{pricing,orders,studio,services,…}.ts` return `error.message` | Supabase/Postgres messages reach signed-in owner/staff screens. Public actions (`public.ts`, `pay.ts`, `sign.ts`, `client-auth.ts`) return fixed strings only — verified. | **Accepted** (studio only). |
| F-15 | **Low** | CI supply chain | `.github/workflows/ci.yml` agent job (`npm install --no-audit --no-fund`), actions pinned by tag (`@v4`) | `agent/` has no lockfile, so CI installs whatever resolves today; actions are tag-pinned, not SHA-pinned. | **Open.** `.github/dependabot.yml` added (npm `/`, `/worker`, `/agent`, github-actions, weekly, grouped). Patch P-15: commit `agent/package-lock.json` and switch the job to `npm ci`. |
| F-16 | **Low** | Vendored code | `.claude/vendor/21st/{LICENSE,SOURCE.md}` (Apache-2.0, upstream commit f76b07a), `.claude/skills/ui-ux-pro-max/{LICENSE,SOURCE.md,data/data-provenance.json}` (MIT, commit 477bcb2) | Provenance and licences are present. `.mcp.json` points the `21st` remote MCP server at `https://21st.dev/api/mcp` with `x-api-key: ${API_KEY_21ST}` (no secret committed) and `.claude/settings.json` pre-approves it for every contributor's Claude session. | **Informational.** Note in README: the server is opt-in via the env var; without `API_KEY_21ST` it is inert. Do not delete. |
| F-17 | **Low** | Hygiene | `git ls-files` | No `.pyc`, `.tsbuildinfo`, `.next/`, `.env`, `*-state.json` or `.pem` is tracked; `.gitignore` covers `__pycache__/`, `*.pyc`, `*.tsbuildinfo`, `.env*`, `pictime-state.json`, `*.storage-state.json`. `tsconfig.tsbuildinfo` exists on disk and is ignored. | **Closed.** |
| F-18 | **Low** | Dates | `src/components/public/PublicFooter.tsx:59` `new Date().getFullYear()` | Server-zone year (UTC on Vercel), not Asia/Qatar: wrong for three hours each New Year. Every customer-facing timestamp elsewhere goes through `src/lib/time.ts` with `Asia/Qatar` — verified (`formatDateTime`, `formatStamp`, `todayInZone`, `isEventDay` ±1 day in the event zone, `tests/time.test.ts`). | **Open (cosmetic).** Patch P-18. |
| F-19 | **Low** | Pricing isolation evidence | `supabase/migrations/20261007100000_pricing_references.sql`, `supabase/tests/pricing_rls.test.sql`, `tests/pricing-isolation.test.ts` | See §4: anon, client and staff cannot read `photo_price_references`/`photo_quotes`. The SQL test is a hand-run DO block (not in CI, see F-07); the vitest file forbids any import of `lib/pricing`/the table names from public, client, e-mail, documents and `src/app/api` surfaces and passes. | **Closed for the current migration**; D must keep the `photo_is_owner_user()` predicate on the new `*_pricing_intelligence.sql` tables and extend both tests. |
| F-20 | **Low** | Stale operational URLs | `README.md` (old), `agent/agent.env.example:6`, `worker/.env.example:26`, `docs/windows-agent.md:32` say `APP_URL=https://tournament-watcher.vercel.app`; `.env.example` (old) said `WATCHER_WORKER_URL=https://bbm-worker.up.railway.app` | The live site is `https://www.bluebeltmedia.com` and the worker default in `scripts/ops/prod-coherence.mjs` is `https://blue-belt-production.up.railway.app`. Mismatched examples lead to a misconfigured agent/worker. | **Partly closed**: README, `.env.example`, `worker/README.md`, `agent/README.md`, `docs/overhaul/INTEGRATIONS.md` now name the current values. Patch P-20 for `worker/.env.example`, `agent/agent.env.example`, `docs/windows-agent.md` (not F's files). |

### Verified safe (no finding)

- **Cron auth** — `src/lib/cron-auth.ts`: fail-closed when `CRON_SECRET` is unset, SHA-256 of both sides then `timingSafeEqual`; used by all four cron routes; per-route in-memory limit of 12/min.
- **MyFatoorah webhook route** — dark (404) unless flag + both secrets; per-IP limit; 64 KB cap by header and by bytes; JSON object check; V2 version header; constant-time signature compare; unverified deliveries recorded as hash only, never applied; 401 on mismatch; 500 only when the delivery could not be stored (provider retries). Idempotent by `provider_event_id`. Tests: `tests/payments/*`.
- **E-sign webhook** — dark until a webhook-capable provider **and** `ESIGN_WEBHOOK_SECRET`; HMAC-SHA256 over the raw body (DocuSign `X-DocuSign-Signature-N`, mock `X-Esign-Signature`), constant time; `mock` refused on `VERCEL_ENV=production`; event rows unique on (provider, event_id); envelope ids only from the verified body. Tests: `tests/esign-webhook.test.ts`, `tests/esign-providers.test.ts`.
- **Telegram webhook** — 404 unless enabled and a ≥ 8-char secret; `X-Telegram-Bot-Api-Secret-Token` compared in constant time before the body is read; update bodies never logged; link codes 8 chars, 15-min expiry, single use; order buttons carry HMAC-signed `callback_data` (key derived from the bot token, 30-day expiry) and are authorised against the linked chat's `user_id`.
- **Capability tokens** — signing `bbs_`, pay `bbp_`, order-pay `bbo_`, capture `bbmc_`, orders `bbmo_`: 40 base62 chars from `randomBytes` with rejection sampling, only SHA-256 hashes stored, shape-checked before any lookup, looked up by hash with a unique index. Expiry: pay/order links 30 days from `pay_token_created_at`/request `created_at` (missing timestamp = expired); signing links by `expires_at` and status (`isSignable`); capture credentials ≤ 14 days, orders credentials ≤ 365 days, revocable, kind-enforced server-side.
- **Signing** — body hash re-checked before the signature lands; guarded update (only `sent`/`viewed`); guardian releases must be typed by the named guardian; evidence (typed name, agreed sentence, IP, UA, body hash, token-hash prefix) stored on the immutable `signed` row.
- **Machine intake** — `authenticateIntake`: per-IP probe limit, hash lookup, expired/revoked/kind checks, per-credential limit; `/api/capture` enforces the allow-listed source host and the credential's source scope; owner identity never comes from the body (`tests/api-capture-route.test.ts`, `tests/api-orders-intake.test.ts`).
- **Signed-in API routes** — `/api/watch`, `/api/import`, `/api/brackets/extract` require a session; bodies go through `parseWatchRequest`/`parseImportRequest` (unknown-field, UUID, calendar-date, 3 MB cap) with 400 codes; `/api/import/receive` accepts only `Origin`s on the source hosts or the app and answers a nonce-CSP page that stores nothing server-side.
- **SSRF** — `src/lib/watchers/url-policy.ts`: https only, `ajptour.com`/`smoothcomp.com` and subdomains, no credentials, no custom ports; redirects re-validated per hop; worker mirrors it with `ALLOWED_HOSTS`.
- **Service-role boundary** — every `createServiceClient` caller is server-only (`import "server-only"` on the module) and falls into one of: cron (after `verifyCronSecret`), signature-verified webhooks, public reads that first load the single studio row with `public_booking=true` (`loadPublicStudio`), public submissions scoped to that owner, token-authenticated pages (`/sign`, `/pay`, `/api/documents/[id]/pdf`), credential-authenticated intake, owner-gated order actions that re-check `owner_id` explicitly (`orders.ts` `gate()`), the client-portal e-mail link (`loadMyPeople`, matches only the auth provider's verified e-mail), collaborator e-mail lookup after `requireOwnedEvent`, and the Telegram bot (link code / signed callback). See §3 for the full list.
- **Client portal** — reads go through `SECURITY DEFINER` views (`photo_client_people_v`, `photo_client_bookings_v`, `photo_client_galleries_v`, `photo_client_payments_v`, `photo_client_payment_requests_v`) that expose client-safe columns; `getMyBooking` adds an explicit `in("client_id", personIds)`; the only pay link offered is our own `/pay/bbp_…` (`isWebsitePayUrl`), never the provider URL. Tests: `tests/client-portal-access.test.ts`, `tests/client-portal.test.ts`.
- **Studio gate** — `src/app/(app)/layout.tsx` redirects non-studio roles to `/client`; every studio action calls `requireStudioUser()`/`requireOwner()` or `auth.getUser()` plus `.eq("owner_id", user.id)` (see §3 table); `danger.ts` requires the typed `DELETE`.
- **Money** — amounts are `numeric(10,2)` in QAR major units; `splitAmounts` rounds the deposit to fils and gives the balance the remainder (`tests/bookings-policy.test.ts`); provider calls send `InvoiceValue` in major units; `amountMismatch` tolerates 0.01 QAR; the pay page charges the **request row's** amount, never a browser value; Pic-Time approval compares integer minor units with safe-integer checks and re-asks the provider before dispatch.
- **State machines** — `BOOKING_TRANSITIONS`/`canTransitionBooking`, `DOCUMENT_TRANSITIONS` (`signed`, `declined`, `expired`, `void` terminal), `applyQuoteToBooking` and `transitionBooking` use optimistic `eq("booking_status", current)` guards; `photo_apply_payment_transition` is the single atomic path for provider payments.
- **Auth callback** — `safeNext` allows same-site paths only (no `//`, `\`, control chars); magic-link redirect is always the configured site, never the request Host.

---

## 2. Patch requests (for the integrator)

Each patch is written so it can be applied without re-reading this register. "Before" is the code as read on 15 Oct 2026.

### P-01 (F-01, Critical) — one `publicPrice()` decision for display, submission and agreement
File: `src/lib/actions/public.ts` (owner: A).

Before (inside `run()`):
```ts
const service = values.service_id ? services.find((s) => s.id === values.service_id) ?? null : null;
const quoteOnly = isClub || values.booking_type === "custom" || !service || service.price_qr === null;
const paymentMode: PaymentMode = quoteOnly ? "quote" : "link_later";
const amountQr = quoteOnly ? 0 : Number(service.price_qr);
```
After:
```ts
import { publicPrice } from "@/lib/services/pricing";
// …
const service = values.service_id ? services.find((s) => s.id === values.service_id) ?? null : null;
const price = service ? publicPrice(service) : null;
const quoteOnly = isClub || values.booking_type === "custom" || !service || price === null || price.mode === "quote";
const paymentMode: PaymentMode = quoteOnly ? "quote" : "link_later";
const amountQr = quoteOnly ? 0 : (price!.amount as number);
```
and in the Telegram lines replace `${service.price_qr === null ? " (quote)" : ""}` with `${quoteOnly ? " (quote)" : ""}`.
Rationale: `publicPrice()` is already the single source of truth for `/`, `/services` and JSON-LD; the submission must use the same decision or the site quotes while the booking charges. Regression test: a `quote`-mode service with `price_qr=350` must produce `amount_qr=0`, `payment_mode='quote'`, `booking_status='inquiry'`, `deposit_state='not_required'`.

### P-02 (F-02, High) — stop forwarding hidden prices to the browser
File: `src/app/(public)/book/page.tsx:34` and `src/app/(public)/book/BookingWizard.tsx:442,549`; type in `src/lib/bookings/public-form.ts:38` (owner: A).

Before:
```ts
const services = pub.services.map((s) => ({ id: s.id, name: s.name, booking_type: s.booking_type, price_qr: s.price_qr === null ? null : Number(s.price_qr), currency: s.currency, description: s.description }));
```
After:
```ts
const services = pub.services.map((s) => {
  const price = publicPrice(s);
  return { id: s.id, name: s.name, booking_type: s.booking_type, price_label: price.short, quote: price.mode === "quote", currency: s.currency, description: stripPlaceholder(s.description) };
});
```
`PublicServiceOption` becomes `{ id; name; booking_type; price_label: string; quote: boolean; currency; description? }`; the wizard renders `price_label` instead of `formatQr(price_qr)`. `stripPlaceholder` removes the "Set your price." sentence (CHECKPOINT #2) — A's catalog work may already provide it. Rationale: a `quote` package's internal `price_qr` is owner data; the RSC payload is public.

### P-03 (F-03, High) — security headers
File: `next.config.ts`.
```ts
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];
const nextConfig: NextConfig = {
  images: { /* unchanged */ },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Capability-token pages: never leak the token through Referer.
      { source: "/pay/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/sign/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};
```
Keep `frame-ancestors` as the only CSP directive for now (a full CSP needs nonces for the Umami script and the JSON-LD `<script>` tags; the import hand-over page already sets its own strict CSP per response). Verify the MyFatoorah card view still loads: it is embedded as a script in our page, not as a frame of ours, so `frame-ancestors 'none'` does not affect it.

### P-04 (F-04, Medium) — confirm the unsigned amount with the provider before `paid`
File: `src/lib/payments/myfatoorah/webhook.ts` (`processWebhook` deps) and `src/app/api/payments/myfatoorah/webhook/route.ts:74`.
Pass `provider: createMyFatoorahClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, timeoutMs: 5_000 })` into `processWebhook`'s deps; in `applyStatusToBooking`, when `mapping.kind === "apply"` and the target status is `paid` and `deps.provider` exists, call `getPaymentStatus({ key: mapping.invoiceId, keyType: "InvoiceId" })` and use the provider's `invoiceValue`/transaction currency for `amountMismatch`; fall back to the webhook body only when the provider call fails (log `payments.amount_unconfirmed`). The same helper already exists for the return-visit path; reuse it. Rationale: the booking's `paid` decision should rest on a value the secret covers or the provider confirms.

### P-06 (F-06, Medium, optional) — warn on ambiguous public studio
File: `src/lib/studio/queries.ts` `loadPublicStudioWith`. After the first query, when `STUDIO_OWNER_ID` is unset, run a `select owner_id … eq("public_booking", true) … limit(2)` and `log.warn("studio.public_ambiguous")` if two rows return. Operational fix is simply to set `STUDIO_OWNER_ID` (now documented in `.env.example`).

### P-07 (F-07, Medium) — pgTAP in CI (not added yet; prerequisites first)
1. `supabase init` (commits `supabase/config.toml`; keep `[db] major_version = 17` to match the hosted project).
2. Convert the nine `DO`-block tests to TAP (`begin; select plan(n); … select * from finish(); rollback;`) or move them to `supabase/tests/manual/` so `supabase test db` only sees TAP files.
3. Add to `.github/workflows/ci.yml`:
```yaml
  db:
    name: Database (pgTAP)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase db start
      - run: supabase test db
```
No secrets are needed (local Postgres in Docker). Until step 2 is done the job would be red, which is why it is not in the workflow.

### P-08 (F-08, Medium) — public paths for the new routes
File: `src/proxy.ts:8` (owner: B).
Before: `… "/services", "/book", "/contact", "/portfolio", "/testimonials", …`
After: `… "/services", "/book", "/contact", "/portfolio", "/work", "/how-it-works", …` (drop `/testimonials` unless B ships it). Add a test in `tests/seo*.test.ts` or a new `tests/proxy-public-paths.test.ts` that every path in `SITEMAP_PATHS` is public.

### P-09 (F-09, Medium) — byte-accurate cap on order intake
File: `src/app/api/orders/intake/route.ts:48`.
Before: `if (text.length > MAX_BODY_BYTES) return …`
After: `if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return …`

### P-10 (F-10, Medium) — stop enumerating auth users
Files: `src/lib/collaborator.ts` `emailsFor`, `src/lib/actions/coverage.ts` `findUserByEmail`. Add an RPC `photo_studio_user_by_email(p_email text) returns uuid` (`SECURITY DEFINER`, `set search_path = public`, granted to `authenticated` only, returns an id only when the target has a `photo_profiles` row with role owner/staff) and call it with the user client; for `emailsFor`, select `auth.users.email` for the given ids through a similar definer function instead of paging `listUsers`.

### P-11 (F-11, Medium) — check the secret before the flag
File: `src/app/api/cron/payments/route.ts:39-40`. Swap the two lines so `verifyCronSecret` runs first (as in `refresh`, `deliveries`, `ops-health`). The worker's scheduler treats 404 as "payments disabled" — keep returning 404 **after** authentication.

### P-15 (F-15, Low) — lockfile for the agent
Run `npm install --package-lock-only` in `agent/`, commit `agent/package-lock.json`, change the CI step to `npm ci` and add `cache-dependency-path: agent/package-lock.json` to its `setup-node` step. Dependabot (`.github/dependabot.yml`, added) then keeps all three npm roots and the actions current.

### P-18 (F-18, Low) — footer year in Qatar time
File: `src/components/public/PublicFooter.tsx:59`.
Before: `© {new Date().getFullYear()} {name}.`
After: `© {dateInZone(new Date(), DEFAULT_TIMEZONE).year} {name}.` (import from `@/lib/time`).

### P-20 (F-20, Low) — stale example URLs
Files: `worker/.env.example:26`, `agent/agent.env.example:6`, `docs/windows-agent.md:32`. Replace `https://tournament-watcher.vercel.app` with `https://www.bluebeltmedia.com` (the app origin) and add "see docs/overhaul/INTEGRATIONS.md". The worker's own public URL (`https://blue-belt-production.up.railway.app`) is what `WATCHER_WORKER_URL` on Vercel must point at.

---

## 3. Service-role callers (grep `createServiceClient`, 15 Oct 2026)

| Caller | Why no user session | Guard before the key is used |
|---|---|---|
| `src/app/api/cron/{refresh,deliveries,ops-health,payments}/route.ts` | scheduled jobs for every owner | `verifyCronSecret` (payments: after the flag, see F-11), `isServiceClientConfigured`, per-route limit |
| `src/app/api/payments/myfatoorah/webhook/route.ts` | provider → server | flag + secrets, per-IP limit, body cap, V2 signature |
| `src/app/api/esign/webhook/route.ts` | provider → server | provider ≠ internal, `ESIGN_WEBHOOK_SECRET`, HMAC, body cap |
| `src/app/api/documents/[id]/pdf/route.ts:73` | studio name for a PDF | only after the document was found by token hash **or** through the user client (RLS) |
| `src/app/(public)/pay/[token]/page.tsx`, `pay/order/[token]/page.tsx`, `src/lib/actions/pay.ts` | the token is the credential | token shape, per-IP limit, lookup by hash, 30-day TTL, amount from the request/order row |
| `src/lib/documents/sign-service.ts`, `src/lib/documents/queries.ts:getDocumentByTokenHash` | signing link | token shape + hash, status/expiry guards |
| `src/lib/studio/queries.ts:loadPublicStudio`, `src/lib/studio/public-events.ts` | anonymous website | reads only the studio row with `public_booking=true` (optionally pinned by `STUDIO_OWNER_ID`), active public services, and `id,name,event_date` of that owner's active events |
| `src/lib/actions/public.ts` (booking, contact) | anonymous website | per-IP limit, honeypot, `parsePublicBookingForm`, owner = the public studio row, idempotency key scoped by owner |
| `src/lib/client-portal/queries.ts:loadMyPeople` | link a verified e-mail to CRM people | only `photo_people` rows with `user_id is null` and `email_key = <auth user's e-mail>` |
| `src/lib/capture/intake.ts` → `/api/capture/*`, `/api/orders/intake`, `/api/galleries/intake` | machine credentials | per-IP probe limit, hash lookup, expiry/revocation/kind, per-credential limit, flag for orders/galleries |
| `src/lib/actions/orders.ts:gate()` | invoice services shared with Telegram/cron | `requireOwner`, per-user limit, explicit `owner_id === viewer.userId` re-check |
| `src/lib/actions/orders.ts:createTestOrder` | test order through the real path | `requireOwner`, sandbox or `ORDERS_TEST_ORDERS_ENABLED=1`, amount ≤ 1000 |
| `src/lib/collaborator.ts:emailsFor`, `src/lib/actions/coverage.ts:findUserByEmail` | resolve collaborator e-mails | `requireOwnedEvent` first; see F-10 |
| `src/lib/notifications/telegram/bot.ts`, `notifier.ts` (kick) | Telegram webhook / claim RPC granted to service role only | webhook secret; signed callbacks; kick limited to the owner whose rows were enqueued |
| `src/lib/payments/pictime-approval.ts` (via cron) | cron | flag, allow-list, provider re-check, lease |

Server actions without a service client all run through the user client (RLS) and, per module: `requireStudioUser()` (bookings, documents, galleries, leads, notifications, organizations, people, services, studio, featured-work), `requireOwner()` (pricing, telegram webhook registration, orders invoice actions), or `auth.getUser()` + `requireOwnedEvent/requireOwnedAthlete` or `.eq("owner_id", user.id)` (clients, corrections, coverage, danger, events, incidents, matches, settings, capture-credentials). `auth.ts`, `client-auth.ts`, `sign.ts`, `pay.ts` are the public ones and were reviewed above.

---

## 4. Pricing tables: who can read `photo_price_references` / `photo_quotes`

Read from `supabase/migrations/20261007100000_pricing_references.sql`:

- `photo_is_owner_user()` — `SECURITY DEFINER`, `stable`, `set search_path = public`; true only when `auth.uid()` has a `photo_profiles` row with `role = 'owner'`. `revoke execute … from public, anon; grant execute … to authenticated, service_role`.
- Both tables: `enable row level security`; one policy each, `for all using ((select auth.uid()) = owner_id and public.photo_is_owner_user()) with check (same)`. No other policy, no grant to `anon`.
- Consequences: **anon** → `auth.uid()` is null, and the policy's function call is refused (`insufficient_privilege`) or yields false: zero rows, no insert. **Client** (role `client`) → `photo_is_owner_user()` false: zero rows, insert refused. **Staff** → `photo_is_studio_user()` true but `photo_is_owner_user()` false: zero rows, update/insert refused. **Another owner** → `owner_id` mismatch: zero rows; inserting with a spoofed `owner_id` fails the `with check`. **service_role** bypasses RLS, and no service-role code path touches these tables (`tests/pricing-isolation.test.ts` fails the build-time scan if `src/app/api`, `(public)`, `(client)`, e-mail or documents code ever references `photo_price_references`, `photo_quotes` or `lib/pricing`).
- The app layer repeats the rule: `src/lib/actions/pricing.ts` starts every action with `requireOwner()`; `src/app/(app)/pricing/*` pages call `requireOwner()`.

Coverage: `supabase/tests/pricing_rls.test.sql` asserts all of the above (owner read/insert/update, cross-owner isolation, staff zero rows + failing insert/update, client zero rows + failing insert, anon zero rows and no execute on the function) — **it is a DO block run by hand against a disposable database (`ROLLBACK_OK`), not part of CI** (F-07). `tests/pricing-isolation.test.ts` and `tests/pricing-actions.test.ts` run in CI (`npm test`). Workstream D's `*_pricing_intelligence.sql` must reuse `photo_is_owner_user()` and extend `pricing_rls.test.sql`; the integrator should run that file once against a disposable database before merging.

---

## 5. Public projections: what reaches the browser

`loadPublicStudio()` returns the whole `photo_studio` row and whole `photo_services` rows **to Server Components**. Only what those components render (HTML) or pass as props to a `"use client"` component (RSC payload) leaves the server. Client components on the public site: `PublicHeader` (props: `accountLink`, `bookingOpen`, `galleryUrl`), `BookingWizard` (props: `events`, `services`, initial params), `PictimeTestimonials`, `Photo` wrappers, `CopyButton`. `PublicFooter`, `Testimonials`, the pages and the JSON-LD builders are server-only.

### `photo_studio` (14 columns)

| Column | Reaches the browser? | Where | Verdict |
|---|---|---|---|
| `owner_id` | no | — | correct (only used server-side to scope queries) |
| `business_name` | yes (HTML, JSON-LD, e-mails) | home, services, footer, pay/sign pages | fine |
| `tagline`, `about`, `city` | yes (HTML, JSON-LD) | home hero, footer | fine |
| `email` | yes (footer `mailto:`, JSON-LD) | footer; `/client` contact link | fine — owner chose it as public contact |
| `phone` | **no** | — | correct; `BUSINESS_CONTACT_PHONE` (env) is the public number |
| `whatsapp` | yes, **client portal only** (`wa.me/<digits>` link on `/client`) | `src/app/(client)/client/page.tsx:23` | acceptable (signed-in clients); flag for the owner that the portal exposes it |
| `instagram` | yes (footer link, JSON-LD `sameAs`) | footer, home | fine |
| `public_booking` | as a boolean only (`bookingOpen` prop) | header, pages | fine |
| `settings.pictimeGalleryUrl` | yes (validated https pic-time.com / galleries.bluebelt.media, `headless` stripped) | header/footer/home | fine |
| `settings.testimonials[].{quote,name,role}` | yes (HTML; capped 600/80/80, max 6) | home | fine; E adds a permission flag |
| `settings.galleryHosts`, `settings.orderInvoicing`, `settings.featuredWork` (decisions), anything else in `settings` | **no** (only the derived photo list renders) | — | correct |
| `created_at`, `updated_at` | no | — | correct |

### `photo_services` (18 columns incl. `price_mode`)

| Column | `/` and `/services` (HTML) | `/book` (RSC props to `BookingWizard`) | JSON-LD | Verdict |
|---|---|---|---|---|
| `id` | in `/book?service=<id>` links | yes | `@id` | fine |
| `name` | yes | yes | yes | fine |
| `booking_type` | grouping only | yes | `serviceType` | fine |
| `description` | yes | yes | yes | **flag**: "Set your price." placeholder reaches prospects (CHECKPOINT #2; A strips it) |
| `price_qr` | only through `publicPrice()` (hidden for `quote`) | **raw, including `quote`-mode rows (F-02)** | only when `publicPrice().amount` is set | **flag F-02** |
| `price_mode` | drives the label | **not forwarded** (so the wizard cannot hide the price) | drives `offers` | fix with F-02 |
| `currency` | in the label | yes | `priceCurrency` | fine |
| `deposit_qr` | no | no | no | correct (owner-internal) |
| `duration_minutes` | yes ("60 min") | no | no | fine |
| `includes_photo`, `includes_video` | yes (icons) | no | no | fine |
| `code`, `sort_order`, `active`, `public`, `owner_id`, `created_at`, `updated_at` | no | no | no | correct |

### `photo_events` on `/book`
`listPublicEvents` forwards `id`, `name`, `event_date` of every **active** event of the owner (including manual/local ones) to the wizard — intended, but the owner should know that an event becomes visible to the public the moment it is active.

### Client portal (`photo_client_bookings_v` etc.)
Forwards the signed-in client's own rows: no `notes`, `metadata`, `legal_acceptance`, `guardian`, assignments or provider ids; `payment_url` is in the view but the UI only links our `/pay/bbp_…` page. Documents keep the RLS policy (`status <> 'draft'`, own person only).

---

## 6. Cross-cutting checks

| Topic | Result |
|---|---|
| Tenant selectors (`.eq("owner_id", …)`) | Present on every write that runs with the service role in `public.ts` (`findByIdempotencyKey`, `upsertOrganization`, lead update, bookings insert carries `owner_id`), `orders.ts` gate, `galleries/intake`, `capture/jobs`, `pictime-approval` (every update also matches `owner_id`). User-client code relies on RLS plus explicit `.eq("owner_id", user.id)` and `count` checks (`authz.test.ts`, `bookings-actions.test.ts`). |
| Input schemas | `validation.ts` (watch/cron/import), `bookings/public-form.ts` (public wizard: honeypot, UUID idempotency key, calendar date ≥ today in Asia/Qatar, length caps, consent flags), `orders/contract.ts`, `galleries/intake-contract.ts`, `capture/envelope.ts`, `pricing/form.ts`, `services/form.ts`, `documents` forms. All server-side; browsers never send amounts. |
| Error leakage | Public: fixed strings. API: `{ error, code }` with no stack or SQL. Studio: Postgres messages (F-14). 404 for undiscoverable routes when a flag is off. |
| Log redaction | `redactValue` masks secret-ish keys and e-mail/phone/bearer shapes; page HTML never logged; `TELEGRAM_DRY_RUN`/`EMAIL_DRY_RUN` under tests. Residual in F-13. |
| Money | QAR major units, `numeric(10,2)`, round-half-up to fils in JS (`Math.round(x*100)/100`); deposit/balance split pinned by tests; tolerance 0.01; Pic-Time path in integer minor units. No float arithmetic on the DB side. |
| Asia/Qatar | `DEFAULT_TIMEZONE="Asia/Qatar"` (no DST); `todayInZone`, `isEventDay` (±1 day in the event's zone), `wallClockToIso`, `formatDateTime` default to it; `formatEventDate` is zone-free for `YYYY-MM-DD`. Only the footer year is UTC (F-18). |
| State transitions | Enumerated tables + optimistic guards (see "Verified safe"); `initialBookingStatus` depends on F-01's `paymentMode`. |
| Proxy / auth gate | Anon → `/login?next=` for non-public, non-API paths; API routes self-authenticate; `/login` bounces signed-in users to `/studio` (client role is then redirected to `/client` by the studio layout). F-08 for new routes. |
| Dependencies | `next 16.3.8`, `@supabase/ssr 0.12.x`, `grammy`, `pdf-lib`, `cheerio`, `sharp` (dev). No "stealth"/bypass packages (checked `package.json`, `worker/package.json`). Dependabot added. |

---

## 7. Open questions for the owner

1. Is `STUDIO_OWNER_ID` set on Vercel production? (F-06 — recommended regardless.)
2. Should the client portal keep showing the studio WhatsApp number (`photo_studio.whatsapp`) as the contact link, or should it use `BUSINESS_CONTACT_PHONE` like the public site?
3. Are MyFatoorah webhooks expected to arrive from fixed provider IPs? If MyFatoorah publishes them, an allow-list at the Vercel WAF would close F-04 without code.
4. May the integrator add `supabase/config.toml` (`supabase init`) so the pgTAP job can run in CI (F-07)?
5. The overhaul's `/work` page will index curated photographs; confirm the manifest/media-library flags (`minors`, `sensitive`, `third-party branding`) remain a hard block on publishing, not a warning.

## 8. Status after integration and independent review (15 Oct 2026, branch head)

An independent reviewer re-read the branch against `main` after all workstreams landed. Verdicts per finding above:

| Finding | Status on this branch |
| --- | --- |
| F-01 | **Fixed** — `bookableAmount()` in `src/lib/services/pricing.ts`; regression test in `tests/public-actions.test.ts` ("issue #10 regression"). |
| F-02 | **Fixed** — `/book` forwards `{ id, name, booking_type, price_label, quote, description }` only (`toPublicServiceOption`). |
| F-03 | **Fixed** — `next.config.ts` `headers()`: nosniff, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy` (`no-referrer` on `/pay/*`, `/sign/*`), Permissions-Policy. |
| F-04 | **Open** — webhook path unchanged; P-04 remains a recommended follow-up (owner question 3). |
| F-05 | **Open, accepted** — per-instance limiter; M-05 (Vercel WAF rules) recommended. |
| F-06 | **Open, configuration** — set `STUDIO_OWNER_ID` in production. |
| F-07 | **Open** — three more hand-run DO-block SQL tests were added (`public_submission`, `media_rls`, extended `pricing_rls`); the CI job in P-07 still needs `supabase init` + TAP conversion. |
| F-08 | **Fixed** — `/work`, `/how-it-works`, `/faq` redirect public; `/testimonials` removed. |
| F-09 | **Fixed** — `Buffer.byteLength`. |
| F-10 | **Open** — unchanged (owner tooling hygiene). |
| F-11 | **Fixed** — cron secret checked before the payments flag. |
| F-12/13/14 | Accepted, unchanged. |
| F-15 | **Fixed** — `agent/package-lock.json` committed, agent CI job uses `npm ci` with lockfile cache. |
| F-18 | **Fixed** — footer year in Asia/Qatar. |
| F-19 | **Honoured** — new pricing and media tables use `photo_is_owner_user()`; SQL and Vitest isolation tests extended. |
| F-20 | **Fixed** — stale `tournament-watcher.vercel.app` examples replaced. |

New findings from the independent review, all fixed on this branch before the PR left draft:

| # | Sev | Where | Fix |
| --- | --- | --- | --- |
| R-1 | High | Media library: derivatives were written to the public bucket at processing time and the bucket had an anon listing policy, so unpublished/review-flagged photos were downloadable and enumerable. | Derivatives are rendered into the private bucket; `publishMedia` copies them to the public bucket, `unpublishMedia`/`archiveMedia` remove them; the listing policy is gone; studio preview uses short-lived signed URLs; `supabase/tests/media_rls.test.sql` asserts anon/authenticated cannot list the public bucket. |
| R-2 | Medium | Idempotent replay of a public submission skipped the owner alert, client e-mail and pricing assessment. | Replay re-enqueues (alert keys make it idempotent); test inverted. |
| R-3 | Medium | Anonymous visitors could see the studio "preview" notice and lose the manifest fallback when a `ready` asset was placed. | `pending` is studio-only; empty library gallery returns null so the manifest fallback applies. |
| R-4 | Medium | Re-claiming an abandoned draft could sign an upload URL for a different key than the row. | Row key/mime updated before signing. |
| R-5 | Medium | Signed upload used `upsert: true` without an UPDATE storage policy. | Owner UPDATE policy added on the private bucket. |
| R-6 | Low | Concurrent pricing assessments with different fingerprints lost the newer one on the version index. | Version re-read + one retry; 23505 classified by index name. |
| R-7 | Low | `/book/done` showed a success page for any well-formed reference. | The page now verifies the reference against the studio's bookings (id + payment mode only). |
| R-8 | Low | `photo_studio.settings` read-modify-write from two pages could drop a key. | Optimistic `updated_at` guard in `website.ts` and `studio.ts`. |
| R-9 | Low | Money/website pages gated by the collaborator flag, not the role. | `requireOwner()` on `/studio/metrics` and `/website`. |
| R-10 | Low | Media search term, max decode size, Instagram normalisation in the RPC, worker tick field names, a11y/RTL nits (breadcrumb current page, region label, footer sentences, `ps-5`). | Fixed in the respective files. |
