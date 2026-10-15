-- Isolation test for the pricing tables (photo_price_references, photo_quotes,
-- photo_pricing_assessments): only an OWNER-role profile reads or writes its own rows. A staff profile
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
  v_ref2 uuid;
  v_quote uuid;
  v_booking uuid;
  v_assessment uuid;
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
  -- A booking to assess (seeded with RLS bypassed; the assessment rows below go through RLS).
  insert into public.photo_bookings (owner_id, athlete_name, customer_name, customer_email, customer_phone, package_name, amount_qr, booking_type, booking_status)
    values (v_owner, 'A', 'C', 'c@example.test', '+97400000000', 'Quote', 0, 'club', 'inquiry') returning id into v_booking;

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

  -- Observation columns + history chain (20261015120000_pricing_intelligence) ----
  insert into public.photo_price_references (provider, service_type, price_from, observed_on, source_type, confidence, region, media_type, comparable_scope, seed_key)
    values ('RLS test provider', 'tournament_athlete', 450, current_date, 'provider_site', 'likely', 'qatar', 'photo', 'sports_event_athlete', 'rls-seed-1') returning id into v_ref2;
  update public.photo_price_references set superseded_by = v_ref2 where id = v_ref;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL owner cannot supersede own reference'; end if;
  begin
    insert into public.photo_price_references (provider, service_type, price_from, seed_key) values ('Dup seed', 'club', 1, 'rls-seed-1');
    raise exception 'FAIL duplicate seed_key accepted for the same owner';
  exception when unique_violation then null;
  end;
  begin
    insert into public.photo_price_references (provider, service_type, price_from, excluded) values ('No reason', 'club', 1, true);
    raise exception 'FAIL excluded reference accepted without a reason';
  exception when check_violation then null;
  end;
  begin
    insert into public.photo_price_references (provider, service_type, price_from, confidence) values ('Bad confidence', 'club', 1, 'certain');
    raise exception 'FAIL bad confidence accepted';
  exception when check_violation then null;
  end;

  -- Assessments: owner inserts, reads and updates own rows; constraints hold ------
  begin
    insert into public.photo_pricing_assessments (owner_id, version, status, request_fingerprint) values (v_owner, 1, 'queued', 'fp-0');
    raise exception 'FAIL an assessment without a booking or lead was accepted';
  exception when check_violation then null;
  end;
  insert into public.photo_pricing_assessments (owner_id, booking_id, version, status, request_fingerprint, request_snapshot)
    values (v_owner, v_booking, 1, 'queued', 'fp-1', '{"service":"team_tournament"}'::jsonb) returning id into v_assessment;
  select count(*) into v_count from public.photo_pricing_assessments where id = v_assessment;
  if v_count <> 1 then raise exception 'FAIL owner cannot read own assessment'; end if;
  update public.photo_pricing_assessments set status = 'ready', computed_at = now() where id = v_assessment;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL owner cannot update own assessment'; end if;
  begin
    insert into public.photo_pricing_assessments (owner_id, booking_id, version, status, request_fingerprint) values (v_owner, v_booking, 1, 'queued', 'fp-2');
    raise exception 'FAIL duplicate (owner, booking, version) accepted';
  exception when unique_violation then null;
  end;
  insert into public.photo_pricing_assessments (owner_id, booking_id, version, status, request_fingerprint) values (v_owner, v_booking, 2, 'queued', 'fp-2');
  begin
    insert into public.photo_pricing_assessments (owner_id, booking_id, version, status, request_fingerprint) values (v_owner, v_booking, 3, 'queued', 'fp-2');
    raise exception 'FAIL the same fingerprint was queued twice for one booking';
  exception when unique_violation then null;
  end;
  begin
    insert into public.photo_pricing_assessments (owner_id, booking_id, version, status, request_fingerprint) values (v_other, v_booking, 9, 'queued', 'fp-9');
    raise exception 'FAIL owner inserted an assessment for another owner';
  exception when insufficient_privilege or check_violation then null;
  end;
  -- A quote may point at the assessment; issued_at starts null.
  update public.photo_quotes set assessment_id = v_assessment where id = v_quote;
  select count(*) into v_count from public.photo_quotes where id = v_quote and assessment_id = v_assessment and issued_at is null;
  if v_count <> 1 then raise exception 'FAIL quote -> assessment link not stored'; end if;

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
  select count(*) into v_count from public.photo_pricing_assessments;
  if v_count <> 0 then raise exception 'FAIL another owner can read assessments'; end if;

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
  select count(*) into v_count from public.photo_pricing_assessments;
  if v_count <> 0 then raise exception 'FAIL staff can read assessments'; end if;
  update public.photo_pricing_assessments set status = 'failed' where id = v_assessment;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL staff updated an assessment'; end if;
  begin
    insert into public.photo_pricing_assessments (owner_id, booking_id, version, status, request_fingerprint) values (v_owner, v_booking, 7, 'queued', 'fp-7');
    raise exception 'FAIL staff inserted an assessment';
  exception when insufficient_privilege or check_violation then null;
  end;
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
  select count(*) into v_count from public.photo_pricing_assessments;
  if v_count <> 0 then raise exception 'FAIL client can read assessments'; end if;
  begin
    insert into public.photo_pricing_assessments (owner_id, booking_id, version, status, request_fingerprint) values (v_client, v_booking, 1, 'queued', 'fp-c');
    raise exception 'FAIL client inserted an assessment';
  exception when insufficient_privilege or check_violation then null;
  end;
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
    select count(*) into v_count from public.photo_pricing_assessments;
    if v_count <> 0 then raise exception 'FAIL anon can read assessments'; end if;
  exception when insufficient_privilege then null; -- the migration revokes the anon grant
  end;
  begin
    insert into public.photo_pricing_assessments (owner_id, booking_id, version, status, request_fingerprint) values (v_owner, v_booking, 8, 'queued', 'fp-8');
    raise exception 'FAIL anon inserted an assessment';
  exception when insufficient_privilege or check_violation then null;
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
