-- Fix: coverage completion authorization with an UNASSIGNED kind.
-- `not (v_is_owner or v.photographer_id = auth.uid())` is NULL (not true) when
-- photographer_id is NULL, so `if NULL then raise` never fired and any
-- authenticated user who knew an athlete id could flip an unassigned kind.
-- Found by supabase/tests/coverage_commands.test.sql run against the live
-- database on 2026-10-04. Both functions now compare with IS NOT DISTINCT FROM.
create or replace function public.photo_set_coverage_done(p_athlete_id uuid, p_kind text, p_done boolean)
returns public.photo_coverage language plpgsql security definer set search_path = public as $$
declare v public.photo_coverage; v_is_owner boolean;
begin
  if p_kind not in ('photo','video') then raise exception 'invalid kind %', p_kind using errcode='22023'; end if;
  if auth.uid() is null then raise exception 'not signed in' using errcode='42501'; end if;
  select * into v from public.photo_coverage where athlete_id = p_athlete_id;
  if not found then raise exception 'no coverage for athlete' using errcode='P0002'; end if;
  v_is_owner := exists (select 1 from public.photo_events e where e.id = v.event_id and e.owner_id = auth.uid());
  if p_kind = 'photo' then
    if not (v_is_owner or (v.photographer_id is not distinct from auth.uid())) then raise exception 'not authorized for photo coverage' using errcode='42501'; end if;
    update public.photo_coverage set photos_done_at = case when p_done then now() else null end,
      photos_done_by = case when p_done then auth.uid() else null end, updated_at = now()
      where athlete_id = p_athlete_id returning * into v;
  else
    if not (v_is_owner or (v.videographer_id is not distinct from auth.uid())) then raise exception 'not authorized for video coverage' using errcode='42501'; end if;
    update public.photo_coverage set videos_done_at = case when p_done then now() else null end,
      videos_done_by = case when p_done then auth.uid() else null end, updated_at = now()
      where athlete_id = p_athlete_id returning * into v;
  end if;
  return v;
end; $$;

create or replace function public.photo_apply_coverage_command(
  p_command_id uuid,
  p_athlete_id uuid,
  p_kind text,
  p_done boolean,
  p_expected_done_at timestamptz,
  p_force boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.photo_coverage;
  v_owner uuid;
  v_is_owner boolean;
  v_current timestamptz;
  v_prev public.photo_coverage_commands;
begin
  if p_kind not in ('photo','video') then raise exception 'invalid kind %', p_kind using errcode = '22023'; end if;
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;

  select * into v from public.photo_coverage where athlete_id = p_athlete_id for update;
  if not found then
    select a.owner_id into v_owner from public.photo_athletes a where a.id = p_athlete_id and a.owner_id = auth.uid() and a.event_id is not null;
    if v_owner is null then raise exception 'no coverage for athlete' using errcode = 'P0002'; end if;
    insert into public.photo_coverage (owner_id, event_id, athlete_id)
      select a.owner_id, a.event_id, a.id from public.photo_athletes a where a.id = p_athlete_id
      on conflict (athlete_id) do nothing;
    select * into v from public.photo_coverage where athlete_id = p_athlete_id for update;
  end if;

  v_is_owner := exists (select 1 from public.photo_events e where e.id = v.event_id and e.owner_id = auth.uid());
  if p_kind = 'photo' and not (v_is_owner or (v.photographer_id is not distinct from auth.uid())) then raise exception 'not authorized for photo coverage' using errcode = '42501'; end if;
  if p_kind = 'video' and not (v_is_owner or (v.videographer_id is not distinct from auth.uid())) then raise exception 'not authorized for video coverage' using errcode = '42501'; end if;

  select * into v_prev from public.photo_coverage_commands c where c.owner_id = v.owner_id and c.command_id = p_command_id;
  if found then
    return jsonb_build_object('ok', v_prev.outcome <> 'conflict', 'state', case when v_prev.outcome = 'conflict' then 'conflict' else 'saved' end, 'replayed', true,
      'photos_done_at', v.photos_done_at, 'videos_done_at', v.videos_done_at);
  end if;

  v_current := case when p_kind = 'photo' then v.photos_done_at else v.videos_done_at end;

  if (v_current is not null) = p_done then
    insert into public.photo_coverage_commands (owner_id, command_id, actor_id, athlete_id, kind, done, outcome)
      values (v.owner_id, p_command_id, auth.uid(), p_athlete_id, p_kind, p_done, 'noop');
    return jsonb_build_object('ok', true, 'state', 'saved', 'noop', true, 'photos_done_at', v.photos_done_at, 'videos_done_at', v.videos_done_at);
  end if;

  if not p_force and (v_current is distinct from p_expected_done_at) then
    insert into public.photo_coverage_commands (owner_id, command_id, actor_id, athlete_id, kind, done, outcome)
      values (v.owner_id, p_command_id, auth.uid(), p_athlete_id, p_kind, p_done, 'conflict');
    return jsonb_build_object('ok', false, 'state', 'conflict', 'current_done_at', v_current, 'photos_done_at', v.photos_done_at, 'videos_done_at', v.videos_done_at);
  end if;

  if p_kind = 'photo' then
    update public.photo_coverage set photos_done_at = case when p_done then now() else null end,
      photos_done_by = case when p_done then auth.uid() else null end, updated_at = now()
      where athlete_id = p_athlete_id returning * into v;
  else
    update public.photo_coverage set videos_done_at = case when p_done then now() else null end,
      videos_done_by = case when p_done then auth.uid() else null end, updated_at = now()
      where athlete_id = p_athlete_id returning * into v;
  end if;
  insert into public.photo_coverage_commands (owner_id, command_id, actor_id, athlete_id, kind, done, outcome)
    values (v.owner_id, p_command_id, auth.uid(), p_athlete_id, p_kind, p_done, 'saved');
  return jsonb_build_object('ok', true, 'state', 'saved', 'photos_done_at', v.photos_done_at, 'videos_done_at', v.videos_done_at);
end; $$;
