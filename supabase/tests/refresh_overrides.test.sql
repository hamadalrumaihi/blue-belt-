-- Guards the manual-correction contract of photo_apply_refresh (added in
-- 20261004020000, lost by 20261004080000, restored by 20261005100000):
--   * a patch that carries override_* keys sets / clears them;
--   * a patch without those keys leaves an existing override untouched;
--   * the capture-ordering guard (STALE) still holds alongside.
-- Inserts a throwaway event/athlete/match and rolls everything back with
-- ROLLBACK_OK on success.

do $$
declare
  v_owner uuid; v_ev uuid := gen_random_uuid(); v_ath uuid := gen_random_uuid(); v_match uuid;
  r jsonb; v_om text; v_reason text; v_mat text; v_fail text := '';
begin
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then raise exception 'no auth.users row to own the fixture'; end if;

  insert into public.photo_events(id, owner_id, name, platform) values (v_ev, v_owner, 'override-test', 'AJP');
  insert into public.photo_athletes(id, owner_id, event_id, name) values (v_ath, v_owner, v_ev, 'Override Tester');
  insert into public.photo_matches(owner_id, athlete_id, external_match_id, mat, opponent, override_mat, override_reason, override_at)
    values (v_owner, v_ath, 'm1', 'Mat 1', 'X', 'Mat 3', 'owner correction', now()) returning id into v_match;

  -- (1) A live refresh whose patch does NOT mention overrides keeps the correction.
  r := public.photo_apply_refresh(v_ath, 0, now(), true, 'OK', 'MATCHES_FOUND', null, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('id', v_match, 'patch', jsonb_build_object('external_match_id', 'm1', 'mat', 'Mat 1', 'opponent', 'X'))),
    '[]'::jsonb, '[]'::jsonb, '{}'::uuid[]);
  select override_mat into v_om from public.photo_matches where id = v_match;
  if (r->>'ok')::boolean is not true then v_fail := v_fail || format('plain refresh failed: %s; ', r); end if;
  if v_om is distinct from 'Mat 3' then v_fail := v_fail || format('override lost by a patch without override keys (now %s); ', v_om); end if;

  -- (2) The source moves the match: the planner clears the superseded correction.
  r := public.photo_apply_refresh(v_ath, 1, now(), true, 'OK', 'MATCHES_FOUND', null, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('id', v_match, 'patch', jsonb_build_object(
      'external_match_id', 'm1', 'mat', 'Mat 5', 'opponent', 'X',
      'override_mat', null, 'override_scheduled_at', null, 'override_by', null,
      'override_at', null, 'override_reason', null, 'override_until', null))),
    '[]'::jsonb, '[]'::jsonb, '{}'::uuid[]);
  select override_mat, override_reason, mat into v_om, v_reason, v_mat from public.photo_matches where id = v_match;
  if (r->>'ok')::boolean is not true then v_fail := v_fail || format('clearing refresh failed: %s; ', r); end if;
  if v_mat is distinct from 'Mat 5' then v_fail := v_fail || format('mat not updated (%s); ', v_mat); end if;
  if v_om is not null or v_reason is not null then v_fail := v_fail || format('override not cleared (override_mat=%s, reason=%s); ', v_om, v_reason); end if;

  -- (3) Capture ordering still enforced next to it.
  r := public.photo_apply_refresh(v_ath, 2, now(), true, 'OK', 'MATCHES_FOUND', null, jsonb_build_object('captureAt', '2026-10-05T06:00:00Z'),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::uuid[]);
  r := public.photo_apply_refresh(v_ath, 3, now(), true, 'OK', 'MATCHES_FOUND', null, jsonb_build_object('captureAt', '2026-10-05T05:00:00Z'),
    jsonb_build_array(jsonb_build_object('id', v_match, 'patch', jsonb_build_object('external_match_id', 'm1', 'mat', 'Mat OLD', 'opponent', 'X'))),
    '[]'::jsonb, '[]'::jsonb, '{}'::uuid[]);
  select mat into v_mat from public.photo_matches where id = v_match;
  if (r->>'code') is distinct from 'STALE' or v_mat is distinct from 'Mat 5' then v_fail := v_fail || format('capture ordering broken (%s, mat=%s); ', r->>'code', v_mat); end if;

  if v_fail <> '' then raise exception 'REFRESH_OVERRIDES_FAIL: %', v_fail; end if;
  raise exception 'ROLLBACK_OK: override keys set/clear, absent keys preserve the correction, capture ordering intact';
end $$;
