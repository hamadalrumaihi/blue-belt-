-- photo_find_studio_user_by_email / photo_studio_user_emails (F-10): only a
-- studio user may ask, only owner/staff profiles are ever returned, and
-- e-mails resolve only for people who share an event with the caller.
-- Ends with ERROR: ROLLBACK_OK so nothing is left behind (npm run test:db).
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-0000000000f1';
  v_staff uuid := '00000000-0000-4000-8000-0000000000f2';
  v_client uuid := '00000000-0000-4000-8000-0000000000f3';
  v_stranger uuid := '00000000-0000-4000-8000-0000000000f4';
  v_event uuid := '10000000-0000-4000-8000-0000000000f1';
  v_found uuid;
  v_count bigint;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@example.test'),
    (v_staff, 'Staff@Example.test'),
    (v_client, 'client@example.test'),
    (v_stranger, 'stranger-staff@example.test');
  insert into public.photo_profiles (user_id, role) values (v_owner, 'owner'), (v_staff, 'staff'), (v_client, 'client'), (v_stranger, 'staff')
    on conflict (user_id) do update set role = excluded.role;
  insert into public.photo_events (id, owner_id, name, platform) values (v_event, v_owner, 'Event', 'AJP');
  insert into public.photo_event_members (event_id, user_id, role) values (v_event, v_staff, 'photographer');

  -- Grants: anon never, authenticated yes (the function guards the role itself).
  if has_function_privilege('anon', 'public.photo_find_studio_user_by_email(text)', 'EXECUTE') then raise exception 'FAIL anon may execute photo_find_studio_user_by_email'; end if;
  if has_function_privilege('anon', 'public.photo_studio_user_emails(uuid[])', 'EXECUTE') then raise exception 'FAIL anon may execute photo_studio_user_emails'; end if;
  if not has_function_privilege('authenticated', 'public.photo_find_studio_user_by_email(text)', 'EXECUTE') then raise exception 'FAIL authenticated lost photo_find_studio_user_by_email'; end if;

  -- As the owner --------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  v_found := public.photo_find_studio_user_by_email('  staff@example.TEST ');
  if v_found is distinct from v_staff then raise exception 'FAIL owner could not find the staff account by e-mail (case/space-insensitive): %', v_found; end if;
  v_found := public.photo_find_studio_user_by_email('client@example.test');
  if v_found is not null then raise exception 'FAIL a client account was returned by the studio lookup'; end if;
  v_found := public.photo_find_studio_user_by_email('nobody@example.test');
  if v_found is not null then raise exception 'FAIL unknown e-mail returned an id'; end if;
  v_found := public.photo_find_studio_user_by_email('stranger-staff@example.test');
  if v_found is distinct from v_stranger then raise exception 'FAIL a staff account not yet on any event must still be findable for an invite'; end if;

  -- E-mails: own + team members only; a staff user on no shared event is not resolved.
  select count(*) into v_count from public.photo_studio_user_emails(array[v_owner, v_staff, v_client, v_stranger]) e where e.email is not null;
  if v_count <> 2 then raise exception 'FAIL owner resolved % e-mails, expected 2 (self + team member)', v_count; end if;
  select count(*) into v_count from public.photo_studio_user_emails(array[v_client]);
  if v_count <> 0 then raise exception 'FAIL a client e-mail was resolved'; end if;
  select count(*) into v_count from public.photo_studio_user_emails(array[v_stranger]);
  if v_count <> 0 then raise exception 'FAIL a staff account outside the caller''s events was resolved'; end if;
  select count(*) into v_count from public.photo_studio_user_emails(null);
  if v_count <> 0 then raise exception 'FAIL null ids resolved rows'; end if;

  -- As the staff member: may look up colleagues on the shared event, never clients.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.photo_studio_user_emails(array[v_owner, v_client]);
  if v_count <> 0 then raise exception 'FAIL staff resolved the owner (not a member row) or a client: %', v_count; end if;
  v_found := public.photo_find_studio_user_by_email('client@example.test');
  if v_found is not null then raise exception 'FAIL staff found a client account'; end if;

  -- As a client: refused outright.
  perform set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  begin
    perform public.photo_find_studio_user_by_email('owner@example.test');
    raise exception 'FAIL client may call photo_find_studio_user_by_email';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.photo_studio_user_emails(array[v_owner]);
    raise exception 'FAIL client may call photo_studio_user_emails';
  exception when insufficient_privilege then null;
  end;

  -- As anon: refused by the grant.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  begin
    perform public.photo_find_studio_user_by_email('owner@example.test');
    raise exception 'FAIL anon may call photo_find_studio_user_by_email';
  exception when insufficient_privilege then null;
  end;

  raise exception 'ROLLBACK_OK: studio user lookup assertions passed';
end $$;
