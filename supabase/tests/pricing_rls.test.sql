-- Isolation test for the pricing tables (photo_price_references, photo_quotes):
-- only an OWNER-role profile reads or writes its own rows. A staff profile
-- (studio user, but not owner), a client profile and anon get nothing and
-- cannot insert, whatever owner_id they claim. The policies depend on
-- public.photo_is_owner_user(); this test fails if they ever fall back to
-- photo_is_studio_user() or plain owner_id = auth.uid().
--
-- Paste the DO block into a psql session against a disposable database:
--   ERROR: ROLLBACK_OK: all pricing RLS assertions passed
-- (The exception at the end rolls everything back, including the test users.)
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-00000000aa01';
  v_staff uuid := '00000000-0000-4000-8000-00000000aa02';
  v_client uuid := '00000000-0000-4000-8000-00000000aa03';
  v_other uuid := '00000000-0000-4000-8000-00000000aa04';
  v_ref uuid;
  v_quote uuid;
  v_count int;
begin
  -- Seed as the superuser / service role (bypasses RLS) -----------------------
  insert into auth.users (id, email) values
    (v_owner, 'pricing-owner@example.test'),
    (v_staff, 'pricing-staff@example.test'),
    (v_client, 'pricing-client@example.test'),
    (v_other, 'pricing-other-owner@example.test');
  -- The auth trigger creates client profiles; set the roles under test.
  insert into public.photo_profiles (user_id, role) values (v_owner, 'owner'), (v_staff, 'staff'), (v_client, 'client'), (v_other, 'owner')
    on conflict (user_id) do update set role = excluded.role;

  -- Owner: insert + select ---------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if not public.photo_is_owner_user() then raise exception 'FAIL photo_is_owner_user() is false for an owner profile'; end if;

  insert into public.photo_price_references (provider, service_type, price_from, price_to, includes)
    values ('RLS test provider', 'tournament_athlete', 400, 600, '{"hours": 2}'::jsonb) returning id into v_ref;
  select count(*) into v_count from public.photo_price_references where id = v_ref and owner_id = v_owner;
  if v_count <> 1 then raise exception 'FAIL owner cannot read own reference (owner_id default = auth.uid())'; end if;

  insert into public.photo_quotes (inputs, calculation, suggested_from, suggested_to)
    values ('{"service_type": "tournament_athlete"}'::jsonb, '{}'::jsonb, 600, 900) returning id into v_quote;
  select count(*) into v_count from public.photo_quotes where id = v_quote and owner_id = v_owner and status = 'draft';
  if v_count <> 1 then raise exception 'FAIL owner cannot read own quote'; end if;

  update public.photo_quotes set status = 'applied', chosen_amount_qr = 750 where id = v_quote;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL owner cannot update own quote'; end if;

  -- An owner cannot claim another owner's id on insert.
  begin
    insert into public.photo_price_references (owner_id, provider, service_type, price_from) values (v_other, 'Spoof', 'club', 1);
    raise exception 'FAIL owner inserted a reference for another owner';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- Another owner sees none of these rows.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.photo_price_references where id = v_ref;
  if v_count <> 0 then raise exception 'FAIL another owner can read the reference'; end if;
  select count(*) into v_count from public.photo_quotes where id = v_quote;
  if v_count <> 0 then raise exception 'FAIL another owner can read the quote'; end if;

  -- Staff: zero rows, failing insert, no update ---------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  if public.photo_is_owner_user() then raise exception 'FAIL photo_is_owner_user() is true for a staff profile'; end if;
  if not public.photo_is_studio_user() then raise exception 'FAIL precondition: staff should still be a studio user'; end if;
  select count(*) into v_count from public.photo_price_references;
  if v_count <> 0 then raise exception 'FAIL staff can read reference prices'; end if;
  select count(*) into v_count from public.photo_quotes;
  if v_count <> 0 then raise exception 'FAIL staff can read quotes'; end if;
  update public.photo_quotes set status = 'discarded' where id = v_quote;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL staff updated a quote'; end if;
  begin
    insert into public.photo_price_references (provider, service_type, price_from) values ('Staff spoof', 'club', 1);
    raise exception 'FAIL staff inserted a reference (own owner_id)';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into public.photo_price_references (owner_id, provider, service_type, price_from) values (v_owner, 'Staff spoof', 'club', 1);
    raise exception 'FAIL staff inserted a reference for the owner';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into public.photo_quotes (inputs, calculation) values ('{}'::jsonb, '{}'::jsonb);
    raise exception 'FAIL staff inserted a quote';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- Client: zero rows, failing insert ------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  if public.photo_is_owner_user() then raise exception 'FAIL photo_is_owner_user() is true for a client profile'; end if;
  select count(*) into v_count from public.photo_price_references;
  if v_count <> 0 then raise exception 'FAIL client can read reference prices'; end if;
  select count(*) into v_count from public.photo_quotes;
  if v_count <> 0 then raise exception 'FAIL client can read quotes'; end if;
  begin
    insert into public.photo_price_references (provider, service_type, price_from) values ('Client spoof', 'club', 1);
    raise exception 'FAIL client inserted a reference';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into public.photo_quotes (inputs, calculation) values ('{}'::jsonb, '{}'::jsonb);
    raise exception 'FAIL client inserted a quote';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- Anon: nothing at all ---------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  begin
    select count(*) into v_count from public.photo_price_references;
    if v_count <> 0 then raise exception 'FAIL anon can read reference prices'; end if;
    select count(*) into v_count from public.photo_quotes;
    if v_count <> 0 then raise exception 'FAIL anon can read quotes'; end if;
  exception when insufficient_privilege then null; -- no grant at all is also fine
  end;
  begin
    insert into public.photo_price_references (provider, service_type, price_from) values ('Anon spoof', 'club', 1);
    raise exception 'FAIL anon inserted a reference';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    perform public.photo_is_owner_user();
    raise exception 'FAIL anon may execute photo_is_owner_user()';
  exception when insufficient_privilege then null;
  end;

  raise exception 'ROLLBACK_OK: all pricing RLS assertions passed';
end $$;
