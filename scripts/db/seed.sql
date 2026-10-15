-- Fixture the SQL tests expect to find (they were first written against the
-- hosted project, where an owner, a studio row and an event already exist):
-- one studio owner with an owner profile, their studio row and one event.
-- Applied by scripts/db/sql-tests.mjs after the migrations, before the tests;
-- every test rolls its own writes back, so this stays the only data around.
-- Nothing here is real: fixed ids, an example.test address.
insert into auth.users (id, email, raw_app_meta_data, created_at)
values ('00000000-0000-4000-8000-00000000c0de', 'seed-owner@example.test', '{"role":"owner"}'::jsonb, now() - interval '1 day')
on conflict (id) do nothing;

insert into public.photo_profiles (user_id, role)
values ('00000000-0000-4000-8000-00000000c0de', 'owner')
on conflict (user_id) do update set role = excluded.role;

insert into public.photo_studio (owner_id, business_name, public_booking)
values ('00000000-0000-4000-8000-00000000c0de', 'Seed Studio', true)
on conflict (owner_id) do nothing;

insert into public.photo_events (id, owner_id, name, platform, event_date)
values ('10000000-0000-4000-8000-00000000c0de', '00000000-0000-4000-8000-00000000c0de', 'Seed Event', 'AJP', current_date + 30)
on conflict (id) do nothing;

-- A second account (client role): several tests need "any other auth.users row" as an outsider.
insert into auth.users (id, email, created_at)
values ('00000000-0000-4000-8000-00000000c0df', 'seed-other@example.test', now() - interval '12 hours')
on conflict (id) do nothing;
insert into public.photo_profiles (user_id, role)
values ('00000000-0000-4000-8000-00000000c0df', 'client')
on conflict (user_id) do update set role = excluded.role;
