-- HOTFIX for 20261004080000_capture_ordering.sql.
--
-- That migration re-created photo_apply_refresh from the watcher_v2 body and
-- so silently dropped the manual-correction handling added in
-- 20261004020000_coverage_commands_and_overrides.sql: the six
-- `override_* = case when v_patch ? 'override_*' ...` assignments. The planner
-- clears a superseded correction by sending those keys in the patch; without
-- them the stale override stayed and kept being shown to the photographer.
--
-- This restores them on top of the capture-ordering logic. Same 12-argument
-- signature, so `create or replace` keeps the existing grants and needs no drop.
-- Verified against both earlier bodies: the only differences from
-- 20261004020000 are the capture-ordering additions (v_capture_at, the STALE
-- guard, last_capture_at) — see supabase/tests/refresh_overrides.test.sql.

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
  -- Capture time (ISO) when this apply carries a capture; null for live refreshes.
  v_capture_at timestamptz := nullif(v_diag->>'captureAt', '')::timestamptz;
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

  -- Capture ordering: a capture older than the newest already applied to this
  -- athlete never overwrites it. Only enforced when a capture time is supplied
  -- (imports / machine intake); live refreshes send none and skip this.
  if v_capture_at is not null and v_athlete.last_capture_at is not null and v_capture_at < v_athlete.last_capture_at then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.match_order nulls last, m.scheduled_at nulls last, m.created_at), '[]'::jsonb)
      into v_matches from public.photo_matches m where m.athlete_id = p_athlete_id;
    return jsonb_build_object('ok', false, 'code', 'STALE', 'version', v_athlete.refresh_version, 'matches', v_matches);
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
      last_capture_at = case when v_capture_at is not null then greatest(coalesce(last_capture_at, v_capture_at), v_capture_at) else last_capture_at end,
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

