-- Pricing intelligence (Blue Belt Media), owner only. Additive and idempotent.
--
--   1. photo_price_references gains observation columns (what was seen, where,
--      when, how confident, which comparable scope) and a history chain:
--      a re-observation INSERTS a new row and points the old one's
--      superseded_by at it. Rows are never overwritten by the research flow.
--   2. photo_pricing_assessments: one immutable snapshot per version of a
--      private price assessment for a booking or lead (request snapshot in
--      PUBLIC scope only: service, media, hours, athlete count, location kind;
--      never names, e-mails, phones or notes).
--   3. photo_quotes gains assessment_id (which assessment the draft came from)
--      and issued_at (set only by the owner's explicit "Issue quote").
--
-- RLS: photo_is_owner_user() on every table, as in 20261007100000. The
-- service role (public-submission hook, cron) bypasses RLS by design; anon
-- gets no grant at all on the assessments table.

-- 1. Reference observations -----------------------------------------------------
alter table public.photo_price_references
  add column if not exists observed_on date,
  add column if not exists source_type text,
  add column if not exists confidence text,
  add column if not exists region text not null default 'qatar',
  add column if not exists media_type text,
  add column if not exists duration_hours numeric(6, 2),
  add column if not exists staffing_count int,
  add column if not exists athlete_count int,
  add column if not exists deliverables text,
  add column if not exists editing_revisions text,
  add column if not exists usage_rights text,
  add column if not exists travel_tax_notes text,
  add column if not exists promotion_expires_on date,
  add column if not exists excluded boolean not null default false,
  add column if not exists excluded_reason text,
  add column if not exists comparable_scope text,
  add column if not exists superseded_by uuid references public.photo_price_references (id) on delete set null,
  add column if not exists seed_key text;

-- Existing rows: the hand-checked date is the observation date; confidence unknown until re-verified.
update public.photo_price_references set observed_on = checked_on where observed_on is null;
update public.photo_price_references set confidence = 'unverified' where confidence is null;
update public.photo_price_references set source_type = 'other' where source_type is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'photo_price_references_source_type_check') then
    alter table public.photo_price_references add constraint photo_price_references_source_type_check
      check (source_type is null or source_type in ('provider_site', 'social_post', 'search_index', 'marketplace', 'directory', 'private_quote', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'photo_price_references_confidence_check') then
    alter table public.photo_price_references add constraint photo_price_references_confidence_check
      check (confidence is null or confidence in ('verified', 'likely', 'unverified'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'photo_price_references_region_check') then
    alter table public.photo_price_references add constraint photo_price_references_region_check
      check (region in ('qatar', 'gcc', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'photo_price_references_media_type_check') then
    alter table public.photo_price_references add constraint photo_price_references_media_type_check
      check (media_type is null or media_type in ('photo', 'video', 'photo_video', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'photo_price_references_duration_check') then
    alter table public.photo_price_references add constraint photo_price_references_duration_check
      check (duration_hours is null or duration_hours >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'photo_price_references_counts_check') then
    alter table public.photo_price_references add constraint photo_price_references_counts_check
      check ((staffing_count is null or staffing_count >= 0) and (athlete_count is null or athlete_count >= 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'photo_price_references_excluded_reason_check') then
    alter table public.photo_price_references add constraint photo_price_references_excluded_reason_check
      check (excluded = false or excluded_reason is not null);
  end if;
end $$;

-- Idempotent seeding: one seed_key per owner.
create unique index if not exists photo_price_references_owner_seed_key_idx
  on public.photo_price_references (owner_id, seed_key) where seed_key is not null;
create index if not exists photo_price_references_owner_scope_idx
  on public.photo_price_references (owner_id, comparable_scope) where superseded_by is null and excluded = false;

-- 2. Assessments ----------------------------------------------------------------------
create table if not exists public.photo_pricing_assessments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  booking_id uuid references public.photo_bookings (id) on delete cascade,
  lead_id uuid references public.photo_leads (id) on delete cascade,
  version int not null default 1 check (version >= 1),
  status text not null default 'queued' check (status in ('queued', 'researching', 'ready', 'needs_detail', 'failed')),
  request_fingerprint text not null,
  -- PUBLIC scope only (service, media, hours, athlete count, location kind). Validated in the app.
  request_snapshot jsonb not null default '{}'::jsonb,
  reference_ids uuid[] not null default '{}'::uuid[],
  cost_assumptions jsonb not null default '{}'::jsonb,
  market jsonb not null default '{}'::jsonb,
  cost_floor jsonb not null default '{}'::jsonb,
  recommendation jsonb not null default '{}'::jsonb,
  missing_inputs text[] not null default '{}'::text[],
  confidence text check (confidence is null or confidence in ('low', 'medium', 'high')),
  error text,
  trigger_reason text,
  created_at timestamptz not null default now(),
  computed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (booking_id is not null or lead_id is not null)
);
-- One version number per booking (or per lead when there is no booking yet).
create unique index if not exists photo_pricing_assessments_booking_version_idx
  on public.photo_pricing_assessments (owner_id, booking_id, version) where booking_id is not null;
create unique index if not exists photo_pricing_assessments_lead_version_idx
  on public.photo_pricing_assessments (owner_id, lead_id, version) where booking_id is null and lead_id is not null;
-- Dedupe queued work: the same request for the same booking is queued once.
create unique index if not exists photo_pricing_assessments_queued_fingerprint_idx
  on public.photo_pricing_assessments (owner_id, booking_id, request_fingerprint) where booking_id is not null and status in ('queued', 'researching');
create unique index if not exists photo_pricing_assessments_lead_queued_fingerprint_idx
  on public.photo_pricing_assessments (owner_id, lead_id, request_fingerprint) where booking_id is null and lead_id is not null and status in ('queued', 'researching');
create index if not exists photo_pricing_assessments_queue_idx
  on public.photo_pricing_assessments (created_at) where status = 'queued';
create index if not exists photo_pricing_assessments_owner_booking_idx
  on public.photo_pricing_assessments (owner_id, booking_id, version desc);
create index if not exists photo_pricing_assessments_owner_lead_idx
  on public.photo_pricing_assessments (owner_id, lead_id, version desc);

-- 3. Quotes link back to the assessment they came from; issued_at is explicit. -----
alter table public.photo_quotes
  add column if not exists assessment_id uuid references public.photo_pricing_assessments (id) on delete set null,
  add column if not exists issued_at timestamptz;
create index if not exists photo_quotes_assessment_idx on public.photo_quotes (assessment_id) where assessment_id is not null;

-- RLS ------------------------------------------------------------------------------------
alter table public.photo_pricing_assessments enable row level security;
revoke all on table public.photo_pricing_assessments from anon;
grant select, insert, update, delete on table public.photo_pricing_assessments to authenticated;
grant all on table public.photo_pricing_assessments to service_role;

drop policy if exists photo_pricing_assessments_owner_all on public.photo_pricing_assessments;
create policy photo_pricing_assessments_owner_all on public.photo_pricing_assessments
  for all
  using ((select auth.uid()) = owner_id and public.photo_is_owner_user())
  with check ((select auth.uid()) = owner_id and public.photo_is_owner_user());

-- updated_at trigger ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'photo_pricing_assessments_set_updated_at') then
    create trigger photo_pricing_assessments_set_updated_at before update on public.photo_pricing_assessments
      for each row execute function public.photo_set_updated_at();
  end if;
end $$;
