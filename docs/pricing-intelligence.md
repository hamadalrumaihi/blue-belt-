# Pricing intelligence (owner only)

How Blue Belt Media produces, reviews and approves a private price for a request. Nothing in this area ever reaches a client: no page under `(public)` or `(client)`, no e-mail template, no document and no analytics event imports `src/lib/pricing`, and the database refuses every non-owner role (`photo_is_owner_user()` RLS on `photo_price_references`, `photo_quotes`, `photo_pricing_assessments`; `tests/pricing-isolation.test.ts` and `supabase/tests/pricing_rls.test.sql` assert both).

## The three outputs, kept apart

An **assessment** (`photo_pricing_assessments`, one immutable row per version) holds three separate results for one request:

1. **Market comparison** (`src/lib/pricing/engine/market.ts`): which observed prices are genuinely comparable. A price is normalised only *within* one comparable scope and never across product types:

   | Scope | Unit | Typical evidence |
   |---|---|---|
   | `sports_event_athlete` | per athlete | BJJ / sports event, per competitor (none on file for Qatar) |
   | `event_coverage_hourly` | per hour | event / corporate / adjacent event photography by the hour |
   | `portrait_session` | per session (not scaled by the minute) | studio or on-location portrait sessions |
   | `content_package_images` | per edited image | commercial / gym content packages |
   | `video_production` | per hour | video shoots with stated deliverables |
   | `retainer_monthly`, `managed_social` | never a shoot comparable | kept as evidence, always excluded with a reason |

   Excluded references are listed with the reason (different scope, media mismatch, non-QAR, outside Qatar/GCC, superseded, owner exclusion). GCC evidence forms a separate group and is never merged into the Qatar range. Evidence that is `unverified`, from a `search_index`, older than 365 days or past its promotion date is listed under **needs re-verification** and never prices anything. The range reports low / high / median, the count and a confidence (`high` needs ≥ 2 verified and ≥ 3 verified-or-likely fresh observations).

2. **Cost floor** (`engine/cost-floor.ts`): what the job costs the studio, every component **once**, each line with its basis in words: shooting, prep, travel time and cost, culling and editing per expected image, video editing per deliverable (full-match filming, edited highlights and reels are costed differently, raw footage handled separately), admin, videographer partner / second photographers, allocated overhead, equipment allowance and a contingency. Every default (`DEFAULT_COST_ASSUMPTIONS`) is visible in the snapshot and marked `default` or `owner`. The payment fee is **not** a cost line; it is a share of the price (below).

3. **Recommendation** (`engine/recommend.ts`): low / target / high from the cost floor at three margins, reconciled against the market range.

   **Margin, not markup.** A margin *m* is profit as a share of the price; with a payment fee *f* (also a share of the price): `price = cost ÷ (1 − m − f)`. "Cost × 1.30" is a 30 % markup and only a 23 % margin. The legacy `/pricing/quote` suggestion (`suggest.ts`) still adds a markup on costs and says so; the assessment never does.

   Reconciliation never stacks costs on top of a market price: when the market median sits inside the cost-based band the target *is* the median; when every comparable advertises below the minimum-margin price the brief is flagged **unprofitable at market** and scope alternatives are offered (photos only, highlights instead of full matches, half the hours, fewer images, one photographer per mat), each re-costed. Capacity conflicts with confirmed bookings on the same date are a blocker (queried in `capacity.ts`, injected as data). Large teams are priced from event hours, mats, roster workload, staffing and output; the team total and the effective per-athlete figure are both shown, and the engine never assumes two fights per athlete (`matchesPerAthlete = 1`).

The engine (`src/lib/pricing/engine/*`) is pure: `now`, references and capacity are injected; `assess()` is deterministic and unit-tested (`tests/pricing-engine|market|cost-floor|recommend.test.ts`).

## What a request contains (public scope only)

`engine/extract.ts` reads a booking or lead into a `PricingRequest`: service, media, video deliverables, hours on site, days, athlete count, simultaneous mats, expected images, a location **kind** (derived from keywords; the text is never kept), usage type, the event date and a deadline. It never copies a name, e-mail, phone, venue string, note, handle or free-text request, and `pricingRequestFromJson` drops anything else when a snapshot is read back. Missing inputs are listed; `criticalMissing` (team size, hours for a team or event day, media for an event) makes the assessment **needs_detail**. Every assumed default is in `assumptions[]`. There is no model-based extraction from free text.

## Lifecycle

1. A website request is saved (workstream A) and calls `enqueuePricingAssessment(client, { ownerId, bookingId, leadId, reason })` (`assess-hook.ts`). It never throws: it fingerprints the public-scope request, skips when the same fingerprint already has a non-failed assessment for that booking/lead, inserts a `queued` row (version n+1) and computes it synchronously (no research is involved, so it is cheap). A compute failure leaves the row queued with its error; the cron job retries.
2. `POST /api/cron/pricing` (CRON_SECRET, service role) processes queued rows in bounded batches and reports counts only. It never fabricates research: see below.
3. The owner opens `/pricing/assessments/<id>`: the three outputs, missing inputs, assumptions, versions. Actions:
   - **Accept → quote draft**: creates (or refreshes) a `photo_quotes` draft linked to the booking with `assessment_id`; the existing *Apply to booking* flow sets the amount. Nothing is issued or sent.
   - **Edit inputs → new version**: overrides to the public-scope inputs, cost assumptions and margins create version n+1. Previous versions, and any quote drafted from them, are never modified.
   - **Re-assess / Re-extract**: a fresh version from the booking.
   - **Request missing details**: a prefilled owner follow-up **draft** to copy by hand. It is not sent from here.
4. **Issue quote** on the quote page sets `photo_quotes.issued_at` and nothing else; it records that the owner shared the price. No e-mail or message is ever sent by the pricing area.
5. Booking page (`QuoteFromPricing`) and leads list (`LeadAssessmentBadge`, when the page passes the badge) show the latest version's state: Queued / Researching / Ready / Needs detail / Failed.

## Research policy

- **Qatar first.** Evidence is observed by the owner on the provider's own page or post, recorded with the URL, the observation date, the source type and a confidence. GCC evidence is labelled `gcc` and shown separately; anything else is `other` and excluded.
- **Advertised ≠ sold.** Every observation is an advertised rate unless `source_type = private_quote`. Unknown stays unknown: a missing duration, image count or deliverable is left empty, never guessed, and such a reference falls back to a flat price with a visible note.
- **Exclusions** are explicit (`excluded`, `excluded_reason`) and shown on every assessment. Retainers and managed-social packages are never shoot comparables.
- **No contacting competitors**, no mystery shopping, no scraping.
- **History, never overwrite.** A re-observation is a new row (`Save as new observation`) and the old row gets `superseded_by`; `Save changes` is for typos only. Seeded rows are idempotent on `seed_key` per owner.
- **Re-verification.** `unverified`, `search_index`, > 365 days old or an expired promotion = "needs re-verification"; shown in orange on `/pricing`, never used for a range. The cron response counts them (`stale.needsReverification`).
- **No automated browsing in production.** `src/lib/pricing/research.ts` has an empty provider registry. The refresh job reports `research.status` as `disabled` (flag off), or `not_configured` (flag on but no key / no adapter) and refreshes nothing. A search-backed adapter, if one is ever added, must take public scope descriptions only (service, media, hours, athlete count, location kind) and must register under `PROVIDERS`; it still cannot write prices without an owner's confidence judgement.

### Seeded dataset (observed 15 Oct 2026, Doha)

`scripts/pricing/seed-references.json` holds 20 observations: Shutter Qatar (×2, unverified: suspicious footer links), Panoramaworks (×2), DT Produqtion (×2, Setmore listing), Litrato Qatar (×2, unverified: old page), Glown (×6: four content packages, two retainers excluded), Share Agency (×2), Ghassen Oueslati (×3, `search_index`, unverified: direct retrieval failed) and AMOON (managed social, excluded). No defensible public Qatar BJJ per-athlete price exists, so none is seeded and the engine says so.

## Environment

| Variable | Purpose |
|---|---|
| `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | `POST /api/cron/pricing` (already used by the other cron routes). |
| `PRICING_RESEARCH_ENABLED` | `1` allows a research refresh **if** a provider is configured; anything else = disabled. |
| `PRICING_RESEARCH_API_KEY` | The provider's key. Unset in production; the job then reports `not_configured`. |
| `PRICING_RESEARCH_PROVIDER` | The adapter name. None is registered in this build. |
| `PRICING_OWNER_ID` | Owner `auth.users` id for the seed script (or pass `--owner`). |

## Owner workflow

1. **Seed once**: `SUPABASE_SERVICE_ROLE_KEY=… NEXT_PUBLIC_SUPABASE_URL=… node scripts/pricing/import-references.mjs --owner <uuid> [--dry-run]`, or paste the JSON into `/pricing/references/import` (Check → Import). Both skip existing `seed_key`s.
2. **Re-verify** the orange rows on `/pricing` (open → confirm on the provider's page → *Save as new observation* with today's date and `verified`).
3. A request arrives → open the booking → *Open assessment*. Read the three outputs. Edit inputs if the request was thin; use the follow-up draft to ask the client.
4. *Accept → quote draft* → *Apply this amount to the booking* → share the price yourself → *Issue quote (record only)*.
5. Add every price you observe while quoting (`/pricing/references/new`); the next assessment uses it.

## Patch requests for other workstreams

- Worker scheduler (`worker/src/scheduler.mjs`, `config.mjs`): add a `PRICING_SECONDS` tick to `POST /api/cron/pricing` (hourly is plenty).
- `src/lib/jobs/heartbeat.ts`: add `pricing: "pricing"` to `JOB_NAMES` so the route can record a heartbeat (not called today).
- Leads page (`src/app/(app)/leads/page.tsx`): call `latestAssessmentsForLeads(leads)` from `src/lib/pricing/queries.ts` for owners and pass `assessment={map.get(l.id)}` to `LeadControls`.
- Public submission (`src/lib/actions/public.ts`, workstream A): call `enqueuePricingAssessment(serviceClient, { ownerId, bookingId, leadId, reason: "public_submission" })` after the durable save, inside the existing non-fatal path.
