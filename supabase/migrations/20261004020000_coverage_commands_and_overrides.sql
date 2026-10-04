-- Phase C: offline-safe coverage commands and owner manual corrections.
-- Additive and idempotent. Owner isolation unchanged.

-- -----------------------------------------------------------------------------
-- 1. Coverage completion as idempotent commands
-- -----------------------------------------------------------------------------
-- Every applied command is logged by its client-generated id, so a replay from
-- a phone that lost the ack is acknowledged without flipping the state again.
create table if not exists public.photo_coverage_commands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  command_id uuid not null,
  actor_id uuid not null,
  athlete_id uuid not null references public.photo_athletes(id) on delete cascade,
  kind text not null check (kind in ('photo','video')),
  done boolean not null,
  outcome text not null check (outcome in ('saved','conflict','noop')),
  applied_at timestamptz not null default now(),
  unique (owner_id, command_id)
);
create index if not exists photo_coverage_commands_athlete_idx on public.photo_coverage_commands (athlete_id, applied_at desc);
alter table public.photo_coverage_commands enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'photo_coverage_commands' and policyname = 'photo_coverage_commands_owner_select') then
    create policy photo_coverage_commands_owner_select on public.photo_coverage_commands
      for select using ((select auth.uid()) = owner_id);
  end if;
end $$;

-- Applies one desired-state command. SECURITY DEFINER with the same
-- authorization as photo_set_coverage_done (owner or the assigned collaborator
-- for that kind). Version check: p_expected_done_at is the done_at the client
-- saw for that kind; when it differs AND the current state differs from the
-- desired one, the answer is a conflict (unless p_force). Replays by command
-- id return the earlier outcome.
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
    -- Owner toggling before any assignment: create the row (owner only).
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

  -- Replay: the same command id was already applied for this owner.
  select * into v_prev from public.photo_coverage_commands c where c.owner_id = v.owner_id and c.command_id = p_command_id;
  if found then
    return jsonb_build_object('ok', v_prev.outcome <> 'conflict', 'state', case when v_prev.outcome = 'conflict' then 'conflict' else 'saved' end, 'replayed', true,
      'photos_done_at', v.photos_done_at, 'videos_done_at', v.videos_done_at);
  end if;

  v_current := case when p_kind = 'photo' then v.photos_done_at else v.videos_done_at end;

  -- Already in the desired state: acknowledge without touching who/when.
  if (v_current is not null) = p_done then
    insert into public.photo_coverage_commands (owner_id, command_id, actor_id, athlete_id, kind, done, outcome)
      values (v.owner_id, p_command_id, auth.uid(), p_athlete_id, p_kind, p_done, 'noop');
    return jsonb_build_object('ok', true, 'state', 'saved', 'noop', true, 'photos_done_at', v.photos_done_at, 'videos_done_at', v.videos_done_at);
  end if;

  -- Someone else changed it since the client looked, and the client did not force.
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

revoke all on function public.photo_apply_coverage_command(uuid, uuid, text, boolean, timestamptz, boolean) from public;
grant execute on function public.photo_apply_coverage_command(uuid, uuid, text, boolean, timestamptz, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Owner manual corrections of mat / time (provenance kept; source untouched)
-- -----------------------------------------------------------------------------
alter table public.photo_matches
  add column if not exists override_mat text,
  add column if not exists override_scheduled_at timestamptz,
  add column if not exists override_by uuid,
  add column if not exists override_at timestamptz,
  add column if not exists override_reason text,
  add column if not exists override_until timestamptz;

-- photo_apply_refresh: same signature and body as watcher_v2, plus the override
-- columns, which a refresh touches ONLY when the plan says so (a superseded
-- correction is cleared explicitly, never silently overwritten).
create or replace function public.photo_apply_refresh(
  p_athlete_id uuid,
  p_expected_version integer,
  p_checked_at timestamptz,
  p_ok boolean,
  p_status text,
  p_code text,
  p_message text,
  p_diag jsonb default '{}'::jsonb,
  p_updates jsonb default '[]'::jsonb,
  p_inserts jsonb default '[]'::jsonb,
  p_history jsonb default '[]'::jsonb,
  p_touch_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_athlete public.photo_athletes%rowtype;
  v_row jsonb;
  v_patch jsonb;
  v_new_id uuid;
  v_new_ids uuid[] := '{}'::uuid[];
  v_match_id uuid;
  v_matches jsonb;
  v_diag jsonb := coalesce(p_diag, '{}'::jsonb);
begin
  perform pg_advisory_xact_lock(hashtext('photo_refresh:' || p_athlete_id::text));

  select * into v_athlete from public.photo_athletes where id = p_athlete_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_athlete.refresh_version <> p_expected_version then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.match_order nulls last, m.scheduled_at nulls last, m.created_at), '[]'::jsonb)
      into v_matches from public.photo_matches m where m.athlete_id = p_athlete_id;
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'version', v_athlete.refresh_version, 'matches', v_matches);
  end if;

  if p_ok then
    for v_row in select value from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) loop
      v_patch := v_row->'patch';
      update public.photo_matches set
        external_match_id = v_patch->>'external_match_id',
        opponent = v_patch->>'opponent',
        mat = v_patch->>'mat',
        scheduled_at = nullif(v_patch->>'scheduled_at', '')::timestamptz,
        estimated_at = nullif(v_patch->>'estimated_at', '')::timestamptz,
        status = coalesce(v_patch->>'status', status),
        match_order = nullif(v_patch->>'match_order', '')::integer,
        source_url = coalesce(v_patch->>'source_url', source_url),
        last_checked_at = coalesce(nullif(v_patch->>'last_checked_at', '')::timestamptz, p_checked_at),
        last_changed_at = nullif(v_patch->>'last_changed_at', '')::timestamptz,
        raw_snapshot = coalesce(v_patch->'raw_snapshot', raw_snapshot),
        identity_confidence = coalesce(v_patch->>'identity_confidence', identity_confidence),
        override_mat = case when v_patch ? 'override_mat' then v_patch->>'override_mat' else override_mat end,
        override_scheduled_at = case when v_patch ? 'override_scheduled_at' then nullif(v_patch->>'override_scheduled_at', '')::timestamptz else override_scheduled_at end,
        override_by = case when v_patch ? 'override_by' then nullif(v_patch->>'override_by', '')::uuid else override_by end,
        override_at = case when v_patch ? 'override_at' then nullif(v_patch->>'override_at', '')::timestamptz else override_at end,
        override_reason = case when v_patch ? 'override_reason' then v_patch->>'override_reason' else override_reason end,
        override_until = case when v_patch ? 'override_until' then nullif(v_patch->>'override_until', '')::timestamptz else override_until end
      where id = (v_row->>'id')::uuid and athlete_id = p_athlete_id;
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_inserts, '[]'::jsonb)) loop
      insert into public.photo_matches (
        owner_id, athlete_id, external_match_id, opponent, mat, scheduled_at, estimated_at, status,
        match_order, source_url, last_checked_at, last_changed_at, raw_snapshot, identity_confidence
      ) values (
        v_athlete.owner_id, p_athlete_id, v_row->>'external_match_id', v_row->>'opponent', v_row->>'mat',
        nullif(v_row->>'scheduled_at', '')::timestamptz, nullif(v_row->>'estimated_at', '')::timestamptz,
        coalesce(v_row->>'status', 'scheduled'), nullif(v_row->>'match_order', '')::integer, v_row->>'source_url',
        coalesce(nullif(v_row->>'last_checked_at', '')::timestamptz, p_checked_at),
        coalesce(nullif(v_row->>'last_changed_at', '')::timestamptz, p_checked_at),
        coalesce(v_row->'raw_snapshot', '{}'::jsonb), coalesce(v_row->>'identity_confidence', 'exact')
      )
      on conflict (athlete_id, external_match_id) where external_match_id is not null do update set
        opponent = excluded.opponent, mat = excluded.mat, scheduled_at = excluded.scheduled_at,
        estimated_at = excluded.estimated_at, status = excluded.status, match_order = excluded.match_order,
        source_url = excluded.source_url, last_checked_at = excluded.last_checked_at,
        raw_snapshot = excluded.raw_snapshot
      returning id into v_new_id;
      v_new_ids := array_append(v_new_ids, v_new_id);
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_history, '[]'::jsonb)) loop
      if v_row ? 'match_ref' then
        v_match_id := v_new_ids[(v_row->>'match_ref')::integer + 1];
      else
        v_match_id := (v_row->>'match_id')::uuid;
      end if;
      if v_match_id is null then continue; end if;
      insert into public.photo_match_history (owner_id, match_id, change_type, old_value, new_value, detected_at)
      values (v_athlete.owner_id, v_match_id, v_row->>'change_type', v_row->'old_value', v_row->'new_value', p_checked_at);
    end loop;

    if coalesce(array_length(p_touch_ids, 1), 0) > 0 then
      update public.photo_matches set last_checked_at = p_checked_at
      where athlete_id = p_athlete_id and id = any (p_touch_ids);
    end if;

    update public.photo_athletes set
      last_checked_at = p_checked_at,
      last_attempt_at = p_checked_at,
      last_success_at = p_checked_at,
      consecutive_failures = 0,
      last_watch_status = p_status,
      last_watch_code = p_code,
      last_watch_message = p_message,
      last_watch_strategy = v_diag->>'strategy',
      last_source_status = nullif(v_diag->>'sourceStatus', '')::integer,
      last_final_url = v_diag->>'finalUrl',
      last_elapsed_ms = nullif(v_diag->>'elapsedMs', '')::integer,
      refresh_version = refresh_version + 1
    where id = p_athlete_id;
  else
    update public.photo_athletes set
      last_checked_at = p_checked_at,
      last_attempt_at = p_checked_at,
      consecutive_failures = consecutive_failures + 1,
      last_watch_status = p_status,
      last_watch_code = p_code,
      last_watch_message = p_message,
      last_watch_strategy = v_diag->>'strategy',
      last_source_status = nullif(v_diag->>'sourceStatus', '')::integer,
      last_final_url = v_diag->>'finalUrl',
      last_elapsed_ms = nullif(v_diag->>'elapsedMs', '')::integer
    where id = p_athlete_id;
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.match_order nulls last, m.scheduled_at nulls last, m.created_at), '[]'::jsonb)
    into v_matches from public.photo_matches m where m.athlete_id = p_athlete_id;
  select refresh_version into v_athlete.refresh_version from public.photo_athletes where id = p_athlete_id;

  return jsonb_build_object('ok', true, 'version', v_athlete.refresh_version, 'matches', v_matches, 'inserted_ids', to_jsonb(v_new_ids));
end $$;
