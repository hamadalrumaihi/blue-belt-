-- pgTAP row-level-security tests for the Tournament Watcher tables.
-- Run locally with the Supabase CLI:  supabase start && supabase test db
-- (requires Docker). These tests assert the owner-isolation invariant that
-- every policy in supabase/migrations depends on; widen access (event
-- members) only after extending this file and seeing it pass.
begin;
select plan(14);

create extension if not exists pgtap with schema extensions;

-- Two users -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner-a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'owner-b@example.test');

-- Seed as service role (bypasses RLS) ----------------------------------------
insert into public.photo_events (id, owner_id, name, platform) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Event A', 'AJP'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Event B', 'AJP');
insert into public.photo_athletes (id, owner_id, event_id, name, platform, source_url) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Athlete A', 'AJP', 'https://ajptour.com/a'),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Athlete B', 'AJP', 'https://ajptour.com/b');
insert into public.photo_matches (id, owner_id, athlete_id, mat) values
  ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Mat 1'),
  ('30000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Mat 2');
insert into public.photo_match_history (owner_id, match_id, change_type) values
  ('00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'MATCH_FOUND'),
  ('00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'MATCH_FOUND');
insert into public.photo_event_members (event_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'assistant');

-- Act as owner A -------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is((select count(*) from public.photo_events), 1::bigint, 'owner A sees only their event');
select is((select count(*) from public.photo_athletes), 1::bigint, 'owner A sees only their athlete');
select is((select count(*) from public.photo_matches), 1::bigint, 'owner A sees only their match');
select is((select count(*) from public.photo_match_history), 1::bigint, 'owner A sees only their history');

-- Writes against another owner's rows affect nothing.
update public.photo_athletes set name = 'hijack' where id = '20000000-0000-0000-0000-00000000000b';
select is((select count(*) from public.photo_athletes where name = 'hijack'), 0::bigint, 'owner A cannot update owner B athlete');
delete from public.photo_matches where id = '30000000-0000-0000-0000-00000000000b';
select is((select count(*) from public.photo_matches), 1::bigint, 'owner A delete of owner B match is a no-op');

select throws_ok(
  $$ insert into public.photo_matches (owner_id, athlete_id, mat) values ('00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Mat 9') $$,
  '42501',
  null,
  'owner A cannot insert a match owned by B'
);

-- The refresh RPC respects RLS (SECURITY INVOKER): another owner's athlete is NOT_FOUND.
select is(
  (public.photo_apply_refresh('20000000-0000-0000-0000-00000000000b', 0, now(), false, 'FETCH_ERROR', 'SOURCE_TIMEOUT', 'x'))->>'code',
  'NOT_FOUND',
  'RPC cannot touch another owner''s athlete'
);
select is(
  (public.photo_apply_refresh('20000000-0000-0000-0000-00000000000a', 0, now(), false, 'FETCH_ERROR', 'SOURCE_TIMEOUT', 'x'))->>'ok',
  'true',
  'RPC records a failure on the caller''s own athlete'
);
select is((select consecutive_failures from public.photo_athletes where id = '20000000-0000-0000-0000-00000000000a'), 1, 'failure streak incremented');

-- Membership foundation: the owner manages rows; membership does not (yet) open the event itself.
select is((select count(*) from public.photo_event_members), 1::bigint, 'owner A sees members of their event');

-- Act as owner B (an assistant on event A) ------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select count(*) from public.photo_event_members), 1::bigint, 'member sees their own membership row');
select is((select count(*) from public.photo_events where id = '10000000-0000-0000-0000-00000000000a'), 0::bigint, 'membership does not yet grant event access (owner isolation unchanged)');
select is((select count(*) from public.photo_athletes where event_id = '10000000-0000-0000-0000-00000000000a'), 0::bigint, 'membership does not yet grant athlete access');

select * from finish();
rollback;
