-- RLS / authorization test for Phase 4 coverage + collaboration.
-- Run against a disposable test database (e.g. `supabase db test`) or paste the
-- DO block into a psql session. It seeds a temp event/athlete/coverage, checks
-- the SECURITY DEFINER surface as the owner/assignee and as an outsider, then
-- RAISEs to roll everything back. A successful run ends with:
--   ERROR: ROLLBACK_OK: all coverage RLS assertions passed
-- Any other error is a real failure.
do $$
declare
  v_owner uuid;
  v_event uuid;
  v_athlete uuid;
  v_board int;
  v_outsider uuid := '00000000-0000-4000-8000-0000000000aa';
  v_cov public.photo_coverage;
begin
  select owner_id into v_owner from public.photo_events limit 1;
  if v_owner is null then raise exception 'seed an event owner before running'; end if;

  insert into public.photo_events (owner_id, name, platform, timezone)
    values (v_owner, 'TEST EVENT (rollback)', 'AJP', 'Asia/Qatar') returning id into v_event;
  insert into public.photo_athletes (owner_id, event_id, name, platform, active)
    values (v_owner, v_event, 'Test Athlete', 'AJP', true) returning id into v_athlete;
  insert into public.photo_coverage (owner_id, event_id, athlete_id, photographer_id)
    values (v_owner, v_event, v_athlete, v_owner);

  -- Owner / assigned photographer: sees the board, can mark done.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select count(*) into v_board from public.photo_collaborator_board(v_event);
  if v_board <> 1 then raise exception 'FAIL owner board=% expected 1', v_board; end if;
  v_cov := public.photo_set_coverage_done(v_athlete, 'photo', true);
  if v_cov.photos_done_at is null then raise exception 'FAIL owner could not complete'; end if;

  -- Outsider: no rows, cannot complete.
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  select count(*) into v_board from public.photo_collaborator_board(v_event);
  if v_board <> 0 then raise exception 'FAIL outsider board=% expected 0', v_board; end if;
  begin
    v_cov := public.photo_set_coverage_done(v_athlete, 'photo', true);
    raise exception 'FAIL outsider completed coverage';
  exception when sqlstate '42501' then null;
  end;

  raise exception 'ROLLBACK_OK: all coverage RLS assertions passed';
end $$;
