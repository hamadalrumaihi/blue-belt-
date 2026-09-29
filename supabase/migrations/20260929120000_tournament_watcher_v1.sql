-- Blue Belt Media Tournament Watcher: additive changes on top of the existing
-- photo_events / photo_athletes / photo_matches / photo_match_history tables.
-- Safe to re-run.

alter table public.photo_events
  add column if not exists country text;

alter table public.photo_athletes
  add column if not exists platform text not null default 'AJP',
  add column if not exists belt text,
  add column if not exists weight text,
  add column if not exists gender text,
  add column if not exists age_category text,
  add column if not exists package_name text,
  add column if not exists internal_notes text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_watch_status text,
  add column if not exists last_watch_message text;

-- Same convention as photo_events.platform.
alter table public.photo_athletes drop constraint if exists photo_athletes_platform_check;
alter table public.photo_athletes add constraint photo_athletes_platform_check
  check (platform = any (array['AJP'::text, 'SMOOTHCOMP'::text, 'OTHER'::text]));

-- Allow owners to delete their own history rows (Delete Match Data / Delete Everything).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'photo_match_history'
      and policyname = 'photo_match_history_owner_delete'
  ) then
    create policy photo_match_history_owner_delete on public.photo_match_history
      for delete using ((select auth.uid()) = owner_id);
  end if;
end $$;

-- Keep updated_at fresh.
create or replace function public.photo_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists photo_events_set_updated_at on public.photo_events;
create trigger photo_events_set_updated_at before update on public.photo_events
  for each row execute function public.photo_set_updated_at();

drop trigger if exists photo_athletes_set_updated_at on public.photo_athletes;
create trigger photo_athletes_set_updated_at before update on public.photo_athletes
  for each row execute function public.photo_set_updated_at();

drop trigger if exists photo_matches_set_updated_at on public.photo_matches;
create trigger photo_matches_set_updated_at before update on public.photo_matches
  for each row execute function public.photo_set_updated_at();

-- One row per athlete + external match id so the watcher can upsert.
create unique index if not exists photo_matches_athlete_external_uidx
  on public.photo_matches (athlete_id, external_match_id)
  where external_match_id is not null;

create index if not exists photo_match_history_owner_detected_idx
  on public.photo_match_history (owner_id, detected_at desc);
create index if not exists photo_athletes_owner_idx on public.photo_athletes (owner_id);
create index if not exists photo_matches_owner_idx on public.photo_matches (owner_id);
create index if not exists photo_events_owner_idx on public.photo_events (owner_id);
