-- Local competitions: events that use their own age groups / weight divisions,
-- may have no public bracket URL, and are tracked by hand.
--
-- Additive only. Existing rows keep working: tracking_mode defaults to
-- 'watcher', division_rules is null (platform defaults apply), and the new
-- athlete / match columns are nullable or default off.

-- 1. Platform 'LOCAL' alongside AJP / SMOOTHCOMP / OTHER.
alter table public.photo_events drop constraint if exists photo_events_platform_check;
alter table public.photo_events add constraint photo_events_platform_check
  check (platform = any (array['AJP'::text, 'SMOOTHCOMP'::text, 'LOCAL'::text, 'OTHER'::text]));
alter table public.photo_athletes drop constraint if exists photo_athletes_platform_check;
alter table public.photo_athletes add constraint photo_athletes_platform_check
  check (platform = any (array['AJP'::text, 'SMOOTHCOMP'::text, 'LOCAL'::text, 'OTHER'::text]));

-- 2. How an event is tracked, and its own division chart (null = platform defaults).
alter table public.photo_events
  add column if not exists tracking_mode text not null default 'watcher',
  add column if not exists division_rules jsonb;
alter table public.photo_events drop constraint if exists photo_events_tracking_mode_check;
alter table public.photo_events add constraint photo_events_tracking_mode_check
  check (tracking_mode in ('watcher', 'manual'));

-- 3. What local divisions are checked against: real age on the event date, real weight.
alter table public.photo_athletes
  add column if not exists birth_date date,
  add column if not exists birth_year smallint,
  add column if not exists weight_kg numeric(5,2);
alter table public.photo_athletes drop constraint if exists photo_athletes_weight_kg_check;
alter table public.photo_athletes add constraint photo_athletes_weight_kg_check
  check (weight_kg is null or (weight_kg > 0 and weight_kg < 400));
alter table public.photo_athletes drop constraint if exists photo_athletes_birth_year_check;
alter table public.photo_athletes add constraint photo_athletes_birth_year_check
  check (birth_year is null or (birth_year >= 1900 and birth_year <= 2100));

-- 4. Matches entered by hand: round, result and next-round notes. The watcher
--    never touches rows it did not create (photo_apply_refresh only upserts by
--    external_match_id and never deletes), so manual rows survive a later
--    source link.
alter table public.photo_matches
  add column if not exists is_manual boolean not null default false,
  add column if not exists round text,
  add column if not exists result text,
  add column if not exists next_round text;
