-- Claim semantics test for photo_claim_notification_deliveries (Phase D).
-- Paste the DO block into a psql session against a disposable database. It
-- seeds four rows for one owner (due, not due yet, terminal-failed, and a
-- sending row with an expired lease), claims with a limit of 2, checks what
-- was claimed and that a second claim gets the remainder but never the same
-- rows, then rolls back:
--   ERROR: ROLLBACK_OK: all delivery claim assertions passed
-- (True concurrency — two sessions claiming at once — is guaranteed by
-- FOR UPDATE SKIP LOCKED; run two psql sessions by hand to observe it.)
do $$
declare
  v_owner uuid;
  v_ids bigint[];
  v_second bigint[];
begin
  select owner_id into v_owner from public.photo_events limit 1;
  if v_owner is null then raise exception 'seed an event owner before running'; end if;

  insert into public.photo_notification_deliveries (owner_id, channel, alert_key, kind, status, attempts, next_attempt_at, created_at)
  values
    (v_owner, 'telegram', 'claim-test-due-1', 'GO_TO_MAT', 'pending', 0, now() - interval '1 minute', now() - interval '4 minute'),
    (v_owner, 'telegram', 'claim-test-due-2', 'GO_TO_MAT', 'failed', 1, now() - interval '1 second', now() - interval '3 minute'),
    (v_owner, 'telegram', 'claim-test-later', 'GO_TO_MAT', 'pending', 0, now() + interval '10 minute', now() - interval '2 minute'),
    (v_owner, 'telegram', 'claim-test-terminal', 'GO_TO_MAT', 'failed', 3, null, now() - interval '5 minute');
  insert into public.photo_notification_deliveries (owner_id, channel, alert_key, kind, status, attempts, next_attempt_at, leased_until, lease_owner, created_at)
  values (v_owner, 'telegram', 'claim-test-expired-lease', 'GO_TO_MAT', 'sending', 1, null, now() - interval '1 second', 'dead-runner', now() - interval '1 minute');

  -- Oldest due first, limit 2: terminal and not-yet-due rows are never claimed.
  select array_agg(id order by created_at) into v_ids from public.photo_claim_notification_deliveries('telegram', 2, 60, 'test-1', v_owner);
  if coalesce(array_length(v_ids, 1), 0) <> 2 then raise exception 'FAIL first claim size %', coalesce(array_length(v_ids, 1), 0); end if;
  if exists (select 1 from public.photo_notification_deliveries where id = any(v_ids) and alert_key in ('claim-test-later', 'claim-test-terminal')) then raise exception 'FAIL claimed an ineligible row'; end if;
  if exists (select 1 from public.photo_notification_deliveries where id = any(v_ids) and (status <> 'sending' or lease_owner <> 'test-1' or leased_until <= now())) then raise exception 'FAIL claimed rows not leased'; end if;

  -- Second claim: the remaining due row (the expired lease), never the first two.
  select array_agg(id) into v_second from public.photo_claim_notification_deliveries('telegram', 10, 60, 'test-2', v_owner);
  if coalesce(array_length(v_second, 1), 0) <> 1 then raise exception 'FAIL second claim size %', coalesce(array_length(v_second, 1), 0); end if;
  if v_second && v_ids then raise exception 'FAIL second claim overlapped the first'; end if;
  if not exists (select 1 from public.photo_notification_deliveries where id = any(v_second) and alert_key = 'claim-test-expired-lease' and attempts = 2) then raise exception 'FAIL expired lease not reclaimed with attempt counted'; end if;

  -- Nothing left.
  if exists (select 1 from public.photo_claim_notification_deliveries('telegram', 10, 60, 'test-3', v_owner)) then raise exception 'FAIL third claim found rows'; end if;

  raise exception 'ROLLBACK_OK: all delivery claim assertions passed';
end $$;
