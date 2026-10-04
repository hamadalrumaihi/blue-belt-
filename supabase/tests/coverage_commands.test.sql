-- Authorization / idempotency test for photo_apply_coverage_command (Phase C).
-- Paste the DO block into a psql session against a disposable database. It
-- seeds an event, athlete and coverage row, then checks as the owner: first
-- apply saves, a replay of the same command id is acknowledged without a
-- second flip, a stale version is a conflict unless forced; and as an
-- outsider: the call is refused. Everything rolls back:
--   ERROR: ROLLBACK_OK: all coverage command assertions passed
do $$
declare
  v_owner uuid;
  v_event uuid;
  v_athlete uuid;
  v_outsider uuid := '00000000-0000-4000-8000-0000000000cc';
  v_cmd uuid := gen_random_uuid();
  v_cmd2 uuid := gen_random_uuid();
  v_res jsonb;
  v_done timestamptz;
begin
  select owner_id into v_owner from public.photo_events limit 1;
  if v_owner is null then raise exception 'seed an event owner before running'; end if;
  insert into public.photo_events (owner_id, name, platform, timezone) values (v_owner, 'TEST EVENT (rollback)', 'AJP', 'Asia/Qatar') returning id into v_event;
  insert into public.photo_athletes (owner_id, event_id, name, platform, active) values (v_owner, v_event, 'Test Athlete', 'AJP', true) returning id into v_athlete;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- Owner, no coverage row yet: the command creates it and saves.
  v_res := public.photo_apply_coverage_command(v_cmd, v_athlete, 'photo', true, null, false);
  if (v_res->>'state') <> 'saved' then raise exception 'FAIL first apply: %', v_res; end if;
  v_done := (v_res->>'photos_done_at')::timestamptz;
  if v_done is null then raise exception 'FAIL photos_done_at not set'; end if;

  -- Replay of the same command id: acknowledged, nothing flips.
  v_res := public.photo_apply_coverage_command(v_cmd, v_athlete, 'photo', true, null, false);
  if (v_res->>'replayed') <> 'true' or (v_res->>'photos_done_at')::timestamptz <> v_done then raise exception 'FAIL replay: %', v_res; end if;

  -- A command based on a stale version (client saw "not done") asking for "not done" is a conflict...
  v_res := public.photo_apply_coverage_command(v_cmd2, v_athlete, 'photo', false, '2000-01-01T00:00:00Z'::timestamptz, false);
  if (v_res->>'state') <> 'conflict' then raise exception 'FAIL expected conflict: %', v_res; end if;
  -- ...and the same id replays as a conflict too (the log remembers the verdict).
  v_res := public.photo_apply_coverage_command(v_cmd2, v_athlete, 'photo', false, '2000-01-01T00:00:00Z'::timestamptz, false);
  if (v_res->>'state') <> 'conflict' or (v_res->>'replayed') <> 'true' then raise exception 'FAIL conflict replay: %', v_res; end if;
  -- Forced with a new id: applies.
  v_res := public.photo_apply_coverage_command(gen_random_uuid(), v_athlete, 'photo', false, v_done, true);
  if (v_res->>'state') <> 'saved' or v_res->>'photos_done_at' is not null then raise exception 'FAIL force: %', v_res; end if;

  -- Outsider: refused.
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  begin
    v_res := public.photo_apply_coverage_command(gen_random_uuid(), v_athlete, 'photo', true, null, false);
    raise exception 'FAIL outsider applied a coverage command';
  exception when sqlstate '42501' then null;
  end;

  raise exception 'ROLLBACK_OK: all coverage command assertions passed';
end $$;
