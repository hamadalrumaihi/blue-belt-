-- Row-level-security isolation for the Tournament Watcher tables: every policy
-- in supabase/migrations depends on the owner-isolation invariant asserted
-- here; widen access (event members) only after extending this file.
--
-- Same convention as the other files in this folder: one DO block, every
-- assertion raises on failure, and the block ends with
--   ERROR: ROLLBACK_OK: watcher RLS assertions passed
-- so nothing is left behind. Run all of them with `npm run test:db`
-- (scripts/db/sql-tests.mjs) or paste the block into psql against a
-- disposable database.
do $$
declare
  v_a uuid := '00000000-0000-0000-0000-00000000000a';
  v_b uuid := '00000000-0000-0000-0000-00000000000b';
  v_event_a uuid := '10000000-0000-0000-0000-00000000000a';
  v_event_b uuid := '10000000-0000-0000-0000-00000000000b';
  v_ath_a uuid := '20000000-0000-0000-0000-00000000000a';
  v_ath_b uuid := '20000000-0000-0000-0000-00000000000b';
  v_match_a uuid := '30000000-0000-0000-0000-00000000000a';
  v_match_b uuid := '30000000-0000-0000-0000-00000000000b';
  v_count bigint;
  v_json jsonb;
begin
  -- Two users, seeded as the superuser (bypasses RLS) ----------------------
  insert into auth.users (id, email) values (v_a, 'owner-a@example.test'), (v_b, 'owner-b@example.test');
  -- Studio RLS (photo_is_studio_user) only admits owner/staff profiles; the auth trigger would make them clients.
  insert into public.photo_profiles (user_id, role) values (v_a, 'owner'), (v_b, 'owner') on conflict (user_id) do update set role = excluded.role;
  insert into public.photo_events (id, owner_id, name, platform) values (v_event_a, v_a, 'Event A', 'AJP'), (v_event_b, v_b, 'Event B', 'AJP');
  insert into public.photo_athletes (id, owner_id, event_id, name, platform, source_url) values
    (v_ath_a, v_a, v_event_a, 'Athlete A', 'AJP', 'https://ajptour.com/a'),
    (v_ath_b, v_b, v_event_b, 'Athlete B', 'AJP', 'https://ajptour.com/b');
  insert into public.photo_matches (id, owner_id, athlete_id, mat) values (v_match_a, v_a, v_ath_a, 'Mat 1'), (v_match_b, v_b, v_ath_b, 'Mat 2');
  insert into public.photo_match_history (owner_id, match_id, change_type) values (v_a, v_match_a, 'MATCH_FOUND'), (v_b, v_match_b, 'MATCH_FOUND');
  insert into public.photo_event_members (event_id, user_id, role) values (v_event_a, v_b, 'assistant');

  -- Act as owner A ---------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count from public.photo_events;
  if v_count <> 1 then raise exception 'FAIL owner A sees % events, expected 1', v_count; end if;
  select count(*) into v_count from public.photo_athletes;
  if v_count <> 1 then raise exception 'FAIL owner A sees % athletes, expected 1', v_count; end if;
  select count(*) into v_count from public.photo_matches;
  if v_count <> 1 then raise exception 'FAIL owner A sees % matches, expected 1', v_count; end if;
  select count(*) into v_count from public.photo_match_history;
  if v_count <> 1 then raise exception 'FAIL owner A sees % history rows, expected 1', v_count; end if;

  -- Writes against another owner's rows affect nothing.
  update public.photo_athletes set name = 'hijack' where id = v_ath_b;
  select count(*) into v_count from public.photo_athletes where name = 'hijack';
  if v_count <> 0 then raise exception 'FAIL owner A updated owner B athlete'; end if;
  delete from public.photo_matches where id = v_match_b;
  select count(*) into v_count from public.photo_matches;
  if v_count <> 1 then raise exception 'FAIL owner A delete of owner B match was not a no-op'; end if;

  begin
    insert into public.photo_matches (owner_id, athlete_id, mat) values (v_b, v_ath_b, 'Mat 9');
    raise exception 'FAIL owner A inserted a match owned by B';
  exception when insufficient_privilege then null;
  end;

  -- The refresh RPC respects RLS (SECURITY INVOKER): another owner's athlete is NOT_FOUND.
  v_json := public.photo_apply_refresh(v_ath_b, 0, now(), false, 'FETCH_ERROR', 'SOURCE_TIMEOUT', 'x');
  if coalesce(v_json ->> 'code', '') <> 'NOT_FOUND' then raise exception 'FAIL RPC touched another owner''s athlete: %', v_json; end if;
  v_json := public.photo_apply_refresh(v_ath_a, 0, now(), false, 'FETCH_ERROR', 'SOURCE_TIMEOUT', 'x');
  if coalesce(v_json ->> 'ok', '') <> 'true' then raise exception 'FAIL RPC did not record a failure on the caller''s own athlete: %', v_json; end if;
  select consecutive_failures into v_count from public.photo_athletes where id = v_ath_a;
  if v_count <> 1 then raise exception 'FAIL failure streak is %, expected 1', v_count; end if;

  -- Membership foundation: the owner manages rows; membership does not (yet) open the event itself.
  select count(*) into v_count from public.photo_event_members;
  if v_count <> 1 then raise exception 'FAIL owner A sees % member rows, expected 1', v_count; end if;

  -- Act as owner B (an assistant on event A) -------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.photo_event_members;
  if v_count <> 1 then raise exception 'FAIL member sees % membership rows, expected their own 1', v_count; end if;
  select count(*) into v_count from public.photo_events where id = v_event_a;
  if v_count <> 0 then raise exception 'FAIL membership granted event access (owner isolation broken)'; end if;
  select count(*) into v_count from public.photo_athletes where event_id = v_event_a;
  if v_count <> 0 then raise exception 'FAIL membership granted athlete access (owner isolation broken)'; end if;

  raise exception 'ROLLBACK_OK: watcher RLS assertions passed';
end $$;
