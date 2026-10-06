-- Proves the capture-ordering guarantee from 20261004080000_capture_ordering.sql:
-- the newest capture of a source always wins, and an older capture that arrives
-- later never overwrites it (it is refused as STALE), regardless of arrival
-- order. Read-mostly: inserts a throwaway event/athlete, exercises the RPC,
-- then rolls everything back with ROLLBACK_OK on success.
--
-- Run against a disposable database, or against the hosted project inside a
-- transaction (the final raise aborts and discards all inserts).

do $$
declare
  v_owner uuid; v_ev uuid := gen_random_uuid(); v_ath uuid := gen_random_uuid();
  r_new jsonb; r_old jsonb; v_mat text; v_lastcap timestamptz; v_fail text := '';
begin
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then raise exception 'no auth.users row to own the fixture'; end if;

  insert into public.photo_events(id, owner_id, name, platform) values (v_ev, v_owner, 'capture-ordering-test', 'AJP');
  insert into public.photo_athletes(id, owner_id, event_id, name) values (v_ath, v_owner, v_ev, 'Ordering Tester');

  -- Newer capture (06:00) applies and inserts a match on "Mat NEW".
  r_new := public.photo_apply_refresh(v_ath, 0, now(), true, 'OK', 'MATCHES_FOUND', null,
    jsonb_build_object('captureAt', '2026-10-05T06:00:00Z'),
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('external_match_id', 'm1', 'mat', 'Mat NEW', 'opponent', 'X')),
    '[]'::jsonb, '{}'::uuid[]);

  -- Older capture (05:00) arrives afterwards at the fresh version: must be STALE
  -- and must not overwrite the newer data.
  r_old := public.photo_apply_refresh(v_ath, 1, now(), true, 'OK', 'MATCHES_FOUND', null,
    jsonb_build_object('captureAt', '2026-10-05T05:00:00Z'),
    jsonb_build_array(jsonb_build_object('id', (select id from public.photo_matches where athlete_id = v_ath limit 1),
      'patch', jsonb_build_object('external_match_id', 'm1', 'mat', 'Mat OLD', 'opponent', 'X'))),
    '[]'::jsonb, '[]'::jsonb, '{}'::uuid[]);

  select mat into v_mat from public.photo_matches where athlete_id = v_ath limit 1;
  select last_capture_at into v_lastcap from public.photo_athletes where id = v_ath;

  if (r_new->>'ok')::boolean is not true then v_fail := v_fail || 'newer capture did not apply; '; end if;
  if (r_old->>'code') is distinct from 'STALE' then v_fail := v_fail || format('older capture expected STALE, got %s; ', r_old); end if;
  if v_mat is distinct from 'Mat NEW' then v_fail := v_fail || format('older capture overwrote the mat to %s; ', v_mat); end if;
  if v_lastcap is distinct from '2026-10-05T06:00:00Z'::timestamptz then v_fail := v_fail || format('last_capture_at is %s, expected the newer time; ', v_lastcap); end if;

  if v_fail <> '' then raise exception 'CAPTURE_ORDERING_FAIL: %', v_fail; end if;
  raise exception 'ROLLBACK_OK: newest capture wins; an older capture arriving later is refused STALE and changes nothing';
end $$;
