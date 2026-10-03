-- RLS / isolation test for the Phase A capture ledger (photo_captures).
-- Run against a disposable test database or paste the DO block into a psql
-- session. It seeds two owners' captures, checks that each owner sees only
-- their own rows, that the same capture_id is allowed per owner but not twice
-- for one owner (23505), and that an outsider can neither read nor update
-- another owner's capture; then RAISEs to roll everything back:
--   ERROR: ROLLBACK_OK: all capture RLS assertions passed
do $$
declare
  v_owner uuid;
  v_other uuid := '00000000-0000-4000-8000-0000000000bb';
  v_count int;
  v_id uuid;
begin
  select owner_id into v_owner from public.photo_events limit 1;
  if v_owner is null then raise exception 'seed an event owner before running'; end if;

  insert into public.photo_captures (owner_id, capture_id, source_key, source_url, captured_at, content_hash, bytes, status)
    values (v_owner, 'cap-rls-1', 'ajptour.com|/event/1/bracket/2', 'https://ajptour.com/en/event/1/bracket/2', now(), 'h1', 10, 'applied')
    returning id into v_id;
  -- Same capture id, other owner: allowed (ids are owner-scoped).
  insert into public.photo_captures (owner_id, capture_id, source_key, source_url, captured_at, content_hash, bytes)
    values (v_other, 'cap-rls-1', 'ajptour.com|/event/1/bracket/2', 'https://ajptour.com/en/event/1/bracket/2', now(), 'h1', 10);
  -- Same capture id, same owner: refused.
  begin
    insert into public.photo_captures (owner_id, capture_id, source_key, source_url, captured_at, content_hash, bytes)
      values (v_owner, 'cap-rls-1', 'ajptour.com|/event/1/bracket/2', 'https://ajptour.com/en/event/1/bracket/2', now(), 'h2', 11);
    raise exception 'FAIL duplicate capture_id accepted for one owner';
  exception when unique_violation then null;
  end;

  -- Owner sees exactly their row.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.photo_captures where capture_id = 'cap-rls-1';
  if v_count <> 1 then raise exception 'FAIL owner sees % captures, expected 1', v_count; end if;

  -- Outsider: no rows, and an update touches nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.photo_captures where id = v_id;
  if v_count <> 0 then raise exception 'FAIL outsider can read another owner''s capture'; end if;
  update public.photo_captures set status = 'rejected', reject_code = 'HACK' where id = v_id;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL outsider updated another owner''s capture'; end if;

  raise exception 'ROLLBACK_OK: all capture RLS assertions passed';
end $$;
