-- Transaction semantics of photo_submit_public_booking (overhaul issue #11).
-- Paste the DO block into a psql session against a disposable database (or
-- the hosted project; it rolls back). It uses the first studio owner, submits
-- one request, replays the same idempotency key, submits a second request
-- for the same e-mail and club, checks the rows and grants, then rolls back:
--   ERROR: ROLLBACK_OK: public submission assertions passed
-- True concurrency (two sessions, same key at the same time) is serialised by
-- the advisory transaction lock inside the function: run two psql sessions by
-- hand, call it with the same key in both, commit the first, and the second
-- returns replay = true with the first booking's id.
do $$
declare
  v_owner uuid;
  v_key uuid := gen_random_uuid();
  v_key2 uuid := gen_random_uuid();
  v_first jsonb;
  v_replay jsonb;
  v_second jsonb;
  v_booking public.photo_bookings;
  v_lead public.photo_leads;
  v_people integer;
  v_orgs integer;
  v_audits integer;
  v_person_phone text;
  v_fail text := '';
  v_person jsonb := jsonb_build_object('full_name', 'Submission Test', 'email', 'Submission.Test@Example.com', 'phone', '+974 5555 0101', 'instagram', 'submission.test', 'kind', 'club_contact', 'source', 'website');
  v_org jsonb := jsonb_build_object('name', 'Submission Test Club', 'kind', 'club', 'email', 'submission.test@example.com', 'phone', '+974 5555 0101');
  v_lead_in jsonb := jsonb_build_object('booking_type', 'club', 'status', 'new', 'source', 'website', 'message', 'Two mats', 'details', jsonb_build_object('service_key', 'team_tournament', 'media_scope', 'photo'));
  v_booking_in jsonb := jsonb_build_object(
    'booking_type', 'club', 'athlete_name', 'Submission Test', 'customer_name', 'Submission Test', 'customer_email', 'submission.test@example.com', 'customer_phone', '+974 5555 0101',
    'academy', 'Submission Test Club', 'package_name', 'Custom', 'amount_qr', 0, 'currency', 'QAR', 'payment_mode', 'quote', 'booking_status', 'inquiry',
    'details', jsonb_build_object('service_key', 'team_tournament', 'service_kind', 'club_team_coverage', 'media_scope', 'photo'), 'notes', 'Two mats',
    'client_type', 'club_team', 'usage_type', 'club_team', 'subject_is_minor', false, 'legal_acceptance', jsonb_build_object('terms_version', 'test', 'privacy_version', 'test'),
    'requires_contract', true, 'requires_guardian_release', false, 'contract_state', 'required', 'deposit_percent', 50, 'deposit_qr', 0, 'balance_qr', 0, 'deposit_state', 'not_required');
  v_audit jsonb := jsonb_build_array(jsonb_build_object('action', 'booking.created', 'data', jsonb_build_object('source', 'website')), jsonb_build_object('action', 'legal.accepted', 'data', jsonb_build_object('terms_version', 'test')));
begin
  select owner_id into v_owner from public.photo_studio order by created_at limit 1;
  if v_owner is null then select owner_id into v_owner from public.photo_events limit 1; end if;
  if v_owner is null then raise exception 'seed a studio owner before running'; end if;
  if exists (select 1 from public.photo_people where owner_id = v_owner and email_key = 'submission.test@example.com') then raise exception 'leftover test person; clean up first'; end if;

  -- 1. First submission creates everything, linked both ways.
  v_first := public.photo_submit_public_booking(v_owner, v_key, v_person, v_org, v_lead_in, v_booking_in, v_audit);
  if (v_first->>'replay')::boolean then v_fail := v_fail || 'first call reported replay; '; end if;
  select * into v_booking from public.photo_bookings where id = (v_first->>'booking_id')::uuid;
  if not found then v_fail := v_fail || 'booking missing; '; end if;
  if v_booking.public_ref !~ '^BB-[A-HJ-NP-Z2-9]{6}$' or v_booking.public_ref <> v_first->>'public_ref' then v_fail := v_fail || 'bad public_ref ' || coalesce(v_booking.public_ref, 'null') || '; '; end if;
  if v_booking.idempotency_key <> v_key::text then v_fail := v_fail || 'idempotency key not stored; '; end if;
  if v_booking.owner_id <> v_owner or v_booking.amount_qr <> 0 or v_booking.payment_mode <> 'quote' or v_booking.booking_status <> 'inquiry' or v_booking.deposit_state <> 'not_required' then v_fail := v_fail || 'booking columns wrong; '; end if;
  if v_booking.client_id <> (v_first->>'person_id')::uuid or v_booking.lead_id <> (v_first->>'lead_id')::uuid then v_fail := v_fail || 'booking not linked to person/lead; '; end if;
  if v_booking.organization_id is null then v_fail := v_fail || 'organisation not linked; '; end if;
  select * into v_lead from public.photo_leads where id = v_booking.lead_id;
  if v_lead.booking_id is distinct from v_booking.id or v_lead.person_id is distinct from v_booking.client_id or v_lead.organization_id is distinct from v_booking.organization_id then v_fail := v_fail || 'lead not linked back; '; end if;
  select count(*) into v_audits from public.photo_audit_log where entity = 'booking' and entity_id = v_booking.id and actor_kind = 'public';
  if v_audits <> 2 then v_fail := v_fail || 'expected 2 audit rows, got ' || v_audits || '; '; end if;
  if not exists (select 1 from public.photo_audit_log where entity_id = v_booking.id and action = 'booking.created' and data->>'public_ref' = v_booking.public_ref and (data->>'lead_id')::uuid = v_lead.id) then v_fail := v_fail || 'creation audit lacks generated ids; '; end if;
  select phone into v_person_phone from public.photo_people where id = v_booking.client_id;
  if v_person_phone <> '+974 5555 0101' then v_fail := v_fail || 'person phone not stored; '; end if;
  if not exists (select 1 from public.photo_people where id = v_booking.client_id and email = 'submission.test@example.com' and phone_key = '55550101') then v_fail := v_fail || 'person e-mail/phone key wrong; '; end if;

  -- 2. Same key again: nothing new, the first booking comes back.
  v_replay := public.photo_submit_public_booking(v_owner, v_key, v_person, v_org, v_lead_in, v_booking_in, v_audit);
  if not (v_replay->>'replay')::boolean or (v_replay->>'booking_id')::uuid <> v_booking.id or v_replay->>'public_ref' <> v_booking.public_ref then v_fail := v_fail || 'replay did not return the first booking; '; end if;
  if (select count(*) from public.photo_bookings where owner_id = v_owner and idempotency_key = v_key::text) <> 1 then v_fail := v_fail || 'replay created a booking; '; end if;
  if (select count(*) from public.photo_leads where booking_id = v_booking.id) <> 1 then v_fail := v_fail || 'replay created a lead; '; end if;
  select count(*) into v_audits from public.photo_audit_log where entity_id = v_booking.id;
  if v_audits <> 2 then v_fail := v_fail || 'replay wrote audit rows; '; end if;

  -- 3. A second request from the same e-mail and club with a different phone: person and club reused, never rewritten.
  v_second := public.photo_submit_public_booking(v_owner, v_key2, v_person || jsonb_build_object('phone', '+974 5555 9999', 'full_name', 'Someone Else'), v_org || jsonb_build_object('name', 'SUBMISSION test club'), v_lead_in, v_booking_in, '[]'::jsonb);
  if (v_second->>'replay')::boolean then v_fail := v_fail || 'second key reported replay; '; end if;
  if (v_second->>'booking_id')::uuid = v_booking.id then v_fail := v_fail || 'second key reused the first booking; '; end if;
  if (v_second->>'person_id')::uuid <> v_booking.client_id then v_fail := v_fail || 'person not matched by e-mail; '; end if;
  select count(*) into v_people from public.photo_people where owner_id = v_owner and email_key = 'submission.test@example.com';
  if v_people <> 1 then v_fail := v_fail || 'duplicate person; '; end if;
  if not exists (select 1 from public.photo_people where id = v_booking.client_id and phone = '+974 5555 0101' and full_name = 'Submission Test') then v_fail := v_fail || 'existing person was rewritten; '; end if;
  select count(*) into v_orgs from public.photo_organizations where owner_id = v_owner and lower(name) = 'submission test club';
  if v_orgs <> 1 then v_fail := v_fail || 'duplicate organisation; '; end if;
  if (select organization_id from public.photo_bookings where id = (v_second->>'booking_id')::uuid) <> v_booking.organization_id then v_fail := v_fail || 'second booking not on the same club; '; end if;
  if (select public_ref from public.photo_bookings where id = (v_second->>'booking_id')::uuid) = v_booking.public_ref then v_fail := v_fail || 'public_ref reused; '; end if;

  -- 4. Guards: one booking per lead, service_role only.
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'photo_leads_booking_id_uidx') then v_fail := v_fail || 'photo_leads_booking_id_uidx missing; '; end if;
  begin
    update public.photo_leads set booking_id = v_booking.id where id = (v_second->>'lead_id')::uuid;
    v_fail := v_fail || 'two leads could link one booking; ';
  exception when unique_violation then
    null;
  end;
  if has_function_privilege('anon', 'public.photo_submit_public_booking(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.photo_submit_public_booking(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE') then
    v_fail := v_fail || 'photo_submit_public_booking reachable by anon/authenticated; ';
  end if;
  if not has_function_privilege('service_role', 'public.photo_submit_public_booking(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE') then
    v_fail := v_fail || 'service_role cannot execute photo_submit_public_booking; ';
  end if;

  if v_fail <> '' then raise exception 'PUBLIC_SUBMISSION_FAIL: %', v_fail; end if;
  raise exception 'ROLLBACK_OK: public submission assertions passed';
end $$;
