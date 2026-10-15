# Blue Belt Media overhaul — implementation checkpoint

Durable record so work resumes across sessions. Update when a workstream lands.

## Baseline
- Branch `claude/overhaul-2026-10` from `main` @ `349677c8f5529711932c89ecf28ecacea7f04d5e` (clean tree, no uncommitted work).
- `npm run typecheck` ✓, `npm run lint` ✓ (3 warnings), `vitest` 1216/1217 — **pre-existing failure** `tests/payments/cron-route.test.ts` ("asks the provider about old pending bookings": scanned 0 vs 1), unrelated to this work.
- Live: `bluebeltmedia.com` 308 → `www.bluebeltmedia.com` (Vercel, iad1). Verified copy on 15 Oct 2026: `/services` shows "Set your price" ×8 and "Quote on request" ×12; `/book` shows "Set your price" ×4; `/` has no hero image; `/portfolio` is the noindex gallery signpost.
- Supabase project **sahp-rbac** (`nuujdewnkovtdvlbfzdx`, us-east-1) is the Blue Belt database (photo_* tables present; migrations applied through `pictime_approval_jobs` = repo HEAD). It is shared with another app's tables (`officers`, `roster_seed`, `app_config`), so every new object is prefixed `photo_` / `bbm-`. **No storage buckets exist yet.** All 6 `photo_services` rows are `price_mode='quote'`, `price_qr=null`, descriptions end with "Set your price.".
- Vercel API via the session proxy is scoped to a personal account that cannot list the `bluebeltmedia` team project (403); `npm run ops:coherence` therefore cannot be run from this container. Worker URL defaults live in `scripts/ops/prod-coherence.mjs`.

## Verified issue register (severity, journey, location, acceptance)
| # | Sev | Journey | Where | Finding | Acceptance |
|---|---|---|---|---|---|
| 10 | **Critical** | Public request → booking amount | `src/lib/actions/public.ts` `quoteOnly = … service.price_qr === null` | `price_mode` ignored: a `quote`-mode service with a numeric price yields a non-zero `amount_qr`, deposit split and `awaiting_contract` status while the site shows "Quote on request". | Regression test; display, submission, agreement use one `publicPrice()` decision. |
| 11 | High | Public request; lead conversion | `public.ts`, `leads.ts` | Person → org → lead → booking → lead.update are separate writes; a failure between lead and booking leaves an orphan lead; `convertLeadToBooking` races on `booking_id`. | Transactional RPC with idempotency key; unique index on leads(booking_id); concurrent-retry test. |
| 2 | High | Services/book copy | DB `photo_services.description` + `DEFAULT_SERVICES` | "Set your price." published to prospects. | Placeholder stripped on public read + seed defaults cleaned; owner-visible warning. |
| 3 | High | Home/book copy | `page.tsx`, `book/page.tsx` | "everything else has its price…", "Prices are on the services page" contradict quote-only configuration. | Copy derives from catalog + actual price modes. |
| 1 | High | Home/services visuals | `public/photos/manifest.json` empty | No hero/photos. | Media library + Work page; compact photo-free layouts until assets are published. |
| 4 | Medium | Portfolio | `(public)/portfolio/page.tsx` | noindex signpost, not a showcase. | Indexable `/work` with curated categories; `/portfolio` redirects; Find my photos separate. |
| 5 | Medium | Home | `Testimonials.tsx` | Empty state asks for a review in the sales section. | Hidden when none; owner-managed testimonials with permission flag. |
| 6 | Medium | All sales surfaces | `PUBLIC_BOOKING_TYPES`, `SERVICE_KINDS`, services cards | Three different taxonomies. | One catalog (`src/lib/catalog`) with audience × service × media. |
| 7 | Medium | Owner media | `featured-work.ts` | Selection only, validated against committed manifest. | Media library in Supabase Storage; manifest remains a fallback source. |
| 8/9 | Medium | Pricing | `suggest.ts` | Manual references; cost double-count on inclusive baselines; "margin" is markup. | Separate market comparison / cost floor / recommendation; margin formula `price = cost / (1 − m − fee)`. |
| 12 | Low | Docs | README | "No service-role key exists anywhere" is false. | README/docs describe real trust boundaries. |
| H1 | Low | Hygiene | `.claude/skills/ui-ux-pro-max/scripts/__pycache__` | Tracked bytecode. | Untracked + ignored (done). |

## Workstreams and file ownership
- **A Catalog/submission** (`src/lib/catalog/index.ts`, `src/lib/bookings/public-form.ts`, `src/lib/actions/public.ts`, `src/lib/actions/leads.ts`, `src/lib/services/*`, `src/app/(public)/book/**`, new migration `*_public_submission_rpc.sql`, `tests/public-*`, `tests/services-*`, `tests/bookings-*`).
- **B Public site** (`src/app/(public)/**` except `book/`, `src/components/public/**`, `src/app/globals.css`, `src/lib/seo.ts`, `src/lib/i18n/**`, `src/lib/catalog/copy.ts`, `src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/layout.tsx`, `src/proxy.ts` (public paths only), `tests/seo*`, `tests/site-content*`, `tests/copy-style*`).
- **C Media** (`src/lib/media/**`, `src/app/(app)/media/**`, `src/app/api/media/**`, `scripts/photos/import.mjs`, `photos/README.md`, migration `*_media_library.sql`, `tests/media-*`).
- **D Pricing** (`src/lib/pricing/**`, `src/app/(app)/pricing/**`, `src/app/(app)/bookings/[id]/QuoteFromPricing.tsx`, migration `*_pricing_intelligence.sql`, `docs/pricing-intelligence.md`, `tests/pricing-*`, `supabase/tests/pricing_rls.test.sql`, `scripts/pricing/**`).
- **E Workspace** (`src/components/nav.ts`, `DesktopSidebar.tsx`, `MobileBottomNav.tsx`, `src/app/(app)/more/**`, `src/app/(app)/studio/**`, `src/app/(app)/website/**`, `src/app/(app)/production/**`, `src/lib/studio/site-content.ts`, `src/lib/studio/dashboard.ts`, `src/lib/actions/studio.ts`, `src/lib/bookings/brief.ts`, `tests/nav*`, `tests/studio-*`).
- **F Audit/docs** (`README.md`, `docs/*.md` except overhaul/ and pricing-intelligence.md, `.github/dependabot.yml`, `.env.example`, `docs/overhaul/SECURITY-REGISTER.md`, `docs/overhaul/INTEGRATIONS.md`).

## Shared contracts (written before implementation)
- `src/lib/catalog/index.ts` — audiences, services, media scopes, video deliverables, legacy `type`/`kind` mapping.
- `src/lib/i18n/locale.ts` — `Locale`, cookie `bbm_lang`, query `lang`, `localized()`.
- `src/lib/media/public.ts` — `PublicMediaItem`, `loadPublicMedia()` (stub until C lands).
- `src/lib/pricing/assess-hook.ts` — `enqueuePricingAssessment()` (stub until D lands; A calls it after save).
- Route names agreed: `/work` (public showcase), `/media` (owner media manager), `/website/*` (owner content), `/production` (board), `/pricing/*` (owner-only), `/book` (unchanged; legacy params preserved).

## Status
- [x] Baseline, branch, contracts, pycache hygiene
- [ ] A  - [ ] B  - [ ] C  - [ ] D  - [ ] E  - [ ] F
- [ ] Integration: `npm run check`, `npm run build`, browser QA, review, PR
