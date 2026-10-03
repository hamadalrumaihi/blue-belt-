-- Phase 4: photo/video collaboration + per-client completion.
-- Additive only. Existing table policies are NOT changed; collaborators reach
-- data exclusively through the SECURITY DEFINER functions below, which return a
-- narrow operational board (no contact/payment fields) and flip only their own
-- completion. Owner isolation on existing tables is therefore unchanged.
-- Applied to project nuujdewnkovtdvlbfzdx on 2026-10-03.

create table if not exists public.photo_coverage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id uuid not null references public.photo_events(id) on delete cascade,
  athlete_id uuid not null references public.photo_athletes(id) on delete cascade,
  photographer_id uuid references auth.users(id) on delete set null,
  videographer_id uuid references auth.users(id) on delete set null,
  photos_done_at timestamptz,
  photos_done_by uuid references auth.users(id) on delete set null,
  videos_done_at timestamptz,
  videos_done_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id)
);
create index if not exists photo_coverage_event_idx on public.photo_coverage (event_id);
create index if not exists photo_coverage_photographer_idx on public.photo_coverage (photographer_id);
create index if not exists photo_coverage_videographer_idx on public.photo_coverage (videographer_id);

alter table public.photo_coverage enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'photo_coverage' and policyname = 'photo_coverage_owner_all') then
    create policy photo_coverage_owner_all on public.photo_coverage
      for all using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
end $$;

create or replace function public.photo_is_event_member(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.photo_events e where e.id = p_event_id and e.owner_id = auth.uid())
      or exists (select 1 from public.photo_event_members m where m.event_id = p_event_id and m.user_id = auth.uid());
$$;

create or replace function public.photo_collaborator_events()
returns table (event_id uuid, name text, venue text, event_date date, timezone text, platform text, role text)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.venue, e.event_date, e.timezone, e.platform, m.role
  from public.photo_event_members m
  join public.photo_events e on e.id = m.event_id
  where m.user_id = auth.uid();
$$;

create or replace function public.photo_collaborator_board(p_event_id uuid)
returns table (
  athlete_id uuid, athlete_name text, division text, belt text, source_url text,
  assigned_photo boolean, assigned_video boolean, photos_done_at timestamptz, videos_done_at timestamptz,
  match_id uuid, mat text, opponent text, scheduled_at timestamptz, estimated_at timestamptz, status text, match_order integer
)
language sql stable security definer set search_path = public as $$
  select a.id, a.name, a.division, a.belt, a.source_url,
    (c.photographer_id = auth.uid()), (c.videographer_id = auth.uid()),
    c.photos_done_at, c.videos_done_at,
    mt.id, mt.mat, mt.opponent, mt.scheduled_at, mt.estimated_at, mt.status, mt.match_order
  from public.photo_coverage c
  join public.photo_athletes a on a.id = c.athlete_id
  left join public.photo_matches mt on mt.athlete_id = a.id
  where c.event_id = p_event_id and a.active
    and (c.photographer_id = auth.uid() or c.videographer_id = auth.uid())
    and public.photo_is_event_member(p_event_id)
  order by mt.match_order nulls last, mt.scheduled_at nulls last;
$$;

create or replace function public.photo_set_coverage_done(p_athlete_id uuid, p_kind text, p_done boolean)
returns public.photo_coverage language plpgsql security definer set search_path = public as $$
declare v public.photo_coverage; v_is_owner boolean;
begin
  if p_kind not in ('photo','video') then raise exception 'invalid kind %', p_kind using errcode='22023'; end if;
  select * into v from public.photo_coverage where athlete_id = p_athlete_id;
  if not found then raise exception 'no coverage for athlete' using errcode='P0002'; end if;
  v_is_owner := exists (select 1 from public.photo_events e where e.id = v.event_id and e.owner_id = auth.uid());
  if p_kind = 'photo' then
    if not (v_is_owner or v.photographer_id = auth.uid()) then raise exception 'not authorized for photo coverage' using errcode='42501'; end if;
    update public.photo_coverage set photos_done_at = case when p_done then now() else null end,
      photos_done_by = case when p_done then auth.uid() else null end, updated_at = now()
      where athlete_id = p_athlete_id returning * into v;
  else
    if not (v_is_owner or v.videographer_id = auth.uid()) then raise exception 'not authorized for video coverage' using errcode='42501'; end if;
    update public.photo_coverage set videos_done_at = case when p_done then now() else null end,
      videos_done_by = case when p_done then auth.uid() else null end, updated_at = now()
      where athlete_id = p_athlete_id returning * into v;
  end if;
  return v;
end; $$;

revoke all on function public.photo_is_event_member(uuid) from public;
revoke all on function public.photo_collaborator_events() from public;
revoke all on function public.photo_collaborator_board(uuid) from public;
revoke all on function public.photo_set_coverage_done(uuid, text, boolean) from public;
grant execute on function public.photo_is_event_member(uuid) to authenticated;
grant execute on function public.photo_collaborator_events() to authenticated;
grant execute on function public.photo_collaborator_board(uuid) to authenticated;
grant execute on function public.photo_set_coverage_done(uuid, text, boolean) to authenticated;

create or replace function public.photo_coverage_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'photo_coverage_touch_trg') then
    create trigger photo_coverage_touch_trg before update on public.photo_coverage
      for each row execute function public.photo_coverage_touch();
  end if;
end $$;
