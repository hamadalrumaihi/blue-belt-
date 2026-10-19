-- Isolation and constraints for photo_inquiries (20261019100000_inquiries):
-- a studio user reads and updates their own owner's inquiries only; a client
-- profile and anon get nothing and cannot insert, whatever owner_id they
-- claim; the reference and the idempotency key are unique per owner; the
-- category and status checks refuse unknown values.
--
-- Same convention as the other files in this folder: one DO block, every
-- assertion raises on failure, and the block ends with
--   ERROR: ROLLBACK_OK: inquiries RLS assertions passed
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-00000000bb01';
  v_other uuid := '00000000-0000-4000-8000-00000000bb02';
  v_client uuid := '00000000-0000-4000-8000-00000000bb03';
  v_id uuid;
  v_count int;
  v_updated timestamptz;
begin
  -- Seed as the superuser / service role (bypasses RLS) -----------------------
  insert into auth.users (id, email) values
    (v_owner, 'inquiries-owner@example.test'),
    (v_other, 'inquiries-other@example.test'),
    (v_client, 'inquiries-client@example.test');
  insert into public.photo_profiles (user_id, role) values (v_owner, 'owner'), (v_other, 'owner'), (v_client, 'client')
    on conflict (user_id) do update set role = excluded.role;

  -- The public form writes with the service role: owner_id is explicit.
  insert into public.photo_inquiries (owner_id, reference, full_name, email, category, subject, message, booking_reference, source_page, idempotency_key)
    values (v_owner, 'IQ-TEST01', 'Website Visitor', 'visitor@example.test', 'photography', 'Portrait shoot', 'Can we book a session?', null, '/services', 'key-1')
    returning id into v_id;
  insert into public.photo_inquiries (owner_id, reference, full_name, email, category, subject, message)
    values (v_other, 'IQ-TEST02', 'Other Visitor', 'other@example.test', 'general', 'Hello', 'A message for the other studio.');

  -- Constraints ----------------------------------------------------------------
  begin
    insert into public.photo_inquiries (owner_id, reference, full_name, email, category, subject, message) values (v_owner, 'IQ-TEST01', 'Dup', 'dup@example.test', 'general', 's', 'm');
    raise exception 'FAIL duplicate reference accepted for the same owner';
  exception when unique_violation then null;
  end;
  begin
    insert into public.photo_inquiries (owner_id, reference, full_name, email, category, subject, message, idempotency_key) values (v_owner, 'IQ-TEST03', 'Dup', 'dup@example.test', 'general', 's', 'm', 'key-1');
    raise exception 'FAIL duplicate idempotency key accepted for the same owner';
  exception when unique_violation then null;
  end;
  begin
    insert into public.photo_inquiries (owner_id, reference, full_name, email, category, subject, message) values (v_owner, 'IQ-TEST04', 'Bad', 'bad@example.test', 'not-a-category', 's', 'm');
    raise exception 'FAIL unknown category accepted';
  exception when check_violation then null;
  end;
  begin
    update public.photo_inquiries set status = 'done' where id = v_id;
    raise exception 'FAIL unknown status accepted';
  exception when check_violation then null;
  end;
  -- The other owner may reuse a reference: uniqueness is per owner.
  insert into public.photo_inquiries (owner_id, reference, full_name, email, category, subject, message) values (v_other, 'IQ-TEST01', 'Other', 'o@example.test', 'general', 's', 'm');

  -- Back-date the row with the trigger off (superuser) so the owner's update below proves the trigger fires;
  -- now() is fixed for the whole transaction, so comparing two in-transaction stamps would never move.
  alter table public.photo_inquiries disable trigger photo_inquiries_set_updated_at;
  update public.photo_inquiries set updated_at = now() - interval '1 day' where id = v_id;
  alter table public.photo_inquiries enable trigger photo_inquiries_set_updated_at;
  select updated_at into v_updated from public.photo_inquiries where id = v_id;

  -- Owner: sees and updates own rows only ---------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.photo_inquiries;
  if v_count <> 1 then raise exception 'FAIL owner sees % inquiries, expected 1', v_count; end if;
  update public.photo_inquiries set status = 'in_progress', notes = '[{"text":"Called back"}]'::jsonb where id = v_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL owner cannot update own inquiry'; end if;
  if (select updated_at from public.photo_inquiries where id = v_id) <= v_updated then raise exception 'FAIL updated_at trigger did not fire'; end if;
  update public.photo_inquiries set status = 'closed' where owner_id = v_other;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL owner updated another owner''s inquiry'; end if;
  begin
    insert into public.photo_inquiries (owner_id, reference, full_name, email, category, subject, message) values (v_other, 'IQ-TEST05', 'Spoof', 's@example.test', 'general', 's', 'm');
    raise exception 'FAIL owner inserted a row for another owner';
  exception when insufficient_privilege then null;
  end;

  -- Client profile: nothing ----------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.photo_inquiries;
  if v_count <> 0 then raise exception 'FAIL client sees % inquiries', v_count; end if;
  begin
    insert into public.photo_inquiries (owner_id, reference, full_name, email, category, subject, message) values (v_client, 'IQ-TEST06', 'Client', 'c@example.test', 'general', 's', 'm');
    raise exception 'FAIL client profile inserted an inquiry';
  exception when insufficient_privilege then null;
  end;

  -- Anon: nothing --------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  begin
    select count(*) into v_count from public.photo_inquiries;
    if v_count <> 0 then raise exception 'FAIL anon sees % inquiries', v_count; end if;
  exception when insufficient_privilege then null;
  end;

  raise exception 'ROLLBACK_OK: inquiries RLS assertions passed';
end $$;
