-- Public request submission in ONE transaction (overhaul issue #11).
--
-- Before: the website action wrote person → organisation → lead → booking →
-- lead.booking_id as five separate statements. A failure between the lead
-- and the booking left an orphan lead, two bookings could share a lead, and a
-- retried submission could race its twin. Now `photo_submit_public_booking`
-- does the whole thing atomically, serialised per idempotency key, and a
-- replayed key returns the booking that already exists.
--
-- Additive: no column, enum or existing function changes. The unique index on
-- photo_bookings (owner_id, idempotency_key) from 20261008100000 stays the
-- replay guard; this adds the one-booking-per-lead guard on photo_leads.

-- 1. One lead links to at most one booking --------------------------------------
-- Refuses loudly (instead of silently rewriting history) if production ever
-- holds two leads on one booking; resolve by hand, then re-run.
do $$
declare v_dupes integer;
begin
  select count(*) into v_dupes from (
    select booking_id from public.photo_leads where booking_id is not null group by booking_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'photo_leads: % booking(s) are linked from more than one lead; clear the duplicate links before creating photo_leads_booking_id_uidx', v_dupes;
  end if;
end $$;

create unique index if not exists photo_leads_booking_id_uidx on public.photo_leads (booking_id) where booking_id is not null;

-- 2. Short public reference, same alphabet as src/lib/bookings/state.ts ------------
-- (no 0/O/1/I so it reads well over the phone). Uniqueness is enforced by
-- photo_bookings_public_ref_uidx; the submit function retries on collision.
create or replace function public.photo_make_public_ref() returns text
language sql volatile set search_path = public as $$
  select 'BB-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;
revoke all on function public.photo_make_public_ref() from public, anon, authenticated;
grant execute on function public.photo_make_public_ref() to service_role;

-- 3. The submission ----------------------------------------------------------------
-- Person matching mirrors src/lib/people/match.ts for an untrusted (public)
-- submitter: find by e-mail only, never by phone, and never write the
-- submitter's details onto an existing person. Organisations are matched by
-- case-insensitive name under an advisory lock so two concurrent club
-- requests cannot create the same club twice.
create or replace function public.photo_submit_public_booking(
  p_owner_id uuid,
  p_idempotency_key uuid,
  p_person jsonb,
  p_organization jsonb,
  p_lead jsonb,
  p_booking jsonb,
  p_audit jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key text := p_idempotency_key::text;
  v_existing public.photo_bookings;
  v_email text;
  v_phone text;
  v_person_id uuid;
  v_org_name text;
  v_org_id uuid;
  v_lead_id uuid;
  v_booking_id uuid;
  v_ref text;
  v_attempt integer := 0;
  v_constraint text;
  v_row jsonb;
begin
  if p_owner_id is null then raise exception 'owner required' using errcode = '22023'; end if;
  if p_idempotency_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  if p_person is null or coalesce(p_person->>'email', '') = '' or coalesce(p_person->>'full_name', '') = '' then
    raise exception 'person e-mail and name required' using errcode = '22023';
  end if;
  if p_booking is null or coalesce(p_booking->>'booking_type', '') = '' then
    raise exception 'booking type required' using errcode = '22023';
  end if;

  -- Serialise concurrent submits of the same wizard session: the second
  -- waits for the first to commit, then sees its booking below.
  perform pg_advisory_xact_lock(hashtext('photo_submit_public_booking'), hashtext(p_owner_id::text || ':' || v_key));

  select * into v_existing from public.photo_bookings where owner_id = p_owner_id and idempotency_key = v_key limit 1;
  if found then
    return jsonb_build_object('booking_id', v_existing.id, 'lead_id', v_existing.lead_id, 'person_id', v_existing.client_id, 'public_ref', v_existing.public_ref, 'replay', true);
  end if;

  -- Person: e-mail match only; an existing person is reused untouched.
  v_email := lower(btrim(p_person->>'email'));
  v_phone := nullif(btrim(coalesce(p_person->>'phone', '')), '');
  select id into v_person_id from public.photo_people where owner_id = p_owner_id and email_key = v_email limit 1;
  if v_person_id is null then
    insert into public.photo_people (owner_id, full_name, email, phone, phone_key, instagram, kind, source)
    values (
      p_owner_id,
      btrim(p_person->>'full_name'),
      v_email,
      v_phone,
      case when length(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g')) >= 8 then right(regexp_replace(v_phone, '\D', '', 'g'), 8) else null end,
      nullif(btrim(coalesce(p_person->>'instagram', '')), ''),
      coalesce(nullif(p_person->>'kind', ''), 'person'),
      coalesce(nullif(p_person->>'source', ''), 'website')
    )
    on conflict (owner_id, email_key) where email_key is not null do nothing
    returning id into v_person_id;
    if v_person_id is null then
      select id into v_person_id from public.photo_people where owner_id = p_owner_id and email_key = v_email limit 1;
    end if;
  end if;
  if v_person_id is null then raise exception 'could not resolve person' using errcode = 'P0001'; end if;

  -- Organisation (clubs): case-insensitive name match, else create.
  v_org_name := nullif(btrim(coalesce(p_organization->>'name', '')), '');
  if v_org_name is not null then
    perform pg_advisory_xact_lock(hashtext('photo_organizations'), hashtext(p_owner_id::text || ':' || lower(v_org_name)));
    select id into v_org_id from public.photo_organizations where owner_id = p_owner_id and lower(name) = lower(v_org_name) order by created_at asc limit 1;
    if v_org_id is null then
      insert into public.photo_organizations (owner_id, name, kind, primary_contact_id, email, phone, instagram)
      values (p_owner_id, v_org_name, coalesce(nullif(p_organization->>'kind', ''), 'club'), v_person_id, nullif(p_organization->>'email', ''), nullif(p_organization->>'phone', ''), nullif(p_organization->>'instagram', ''))
      returning id into v_org_id;
    end if;
  end if;

  -- Lead.
  insert into public.photo_leads (owner_id, person_id, organization_id, event_id, booking_type, status, source, message, details)
  values (
    p_owner_id, v_person_id, v_org_id,
    nullif(p_lead->>'event_id', '')::uuid,
    nullif(p_lead->>'booking_type', ''),
    coalesce(nullif(p_lead->>'status', ''), 'new'),
    coalesce(nullif(p_lead->>'source', ''), 'website'),
    nullif(p_lead->>'message', ''),
    coalesce(p_lead->'details', '{}'::jsonb)
  )
  returning id into v_lead_id;

  -- Booking, retrying only a public_ref collision.
  loop
    v_attempt := v_attempt + 1;
    v_ref := public.photo_make_public_ref();
    begin
      insert into public.photo_bookings (
        owner_id, client_id, organization_id, service_id, lead_id, event_id, booking_type,
        athlete_name, customer_name, customer_email, customer_phone, academy, division, location,
        package_name, amount_qr, currency, payment_mode, booking_status, details, notes,
        client_type, usage_type, subject_is_minor, guardian, legal_acceptance, idempotency_key,
        requires_contract, requires_guardian_release, contract_state,
        deposit_percent, deposit_qr, balance_qr, deposit_state, public_ref
      ) values (
        p_owner_id, v_person_id, v_org_id,
        nullif(p_booking->>'service_id', '')::uuid,
        v_lead_id,
        nullif(p_booking->>'event_id', '')::uuid,
        p_booking->>'booking_type',
        p_booking->>'athlete_name',
        p_booking->>'customer_name',
        p_booking->>'customer_email',
        p_booking->>'customer_phone',
        nullif(p_booking->>'academy', ''),
        nullif(p_booking->>'division', ''),
        nullif(p_booking->>'location', ''),
        coalesce(nullif(p_booking->>'package_name', ''), 'Custom'),
        coalesce((p_booking->>'amount_qr')::numeric, 0),
        coalesce(nullif(p_booking->>'currency', ''), 'QAR'),
        coalesce(nullif(p_booking->>'payment_mode', ''), 'quote'),
        coalesce(nullif(p_booking->>'booking_status', ''), 'inquiry'),
        coalesce(p_booking->'details', '{}'::jsonb),
        nullif(p_booking->>'notes', ''),
        nullif(p_booking->>'client_type', ''),
        nullif(p_booking->>'usage_type', ''),
        coalesce((p_booking->>'subject_is_minor')::boolean, false),
        case when p_booking ? 'guardian' and jsonb_typeof(p_booking->'guardian') = 'object' then p_booking->'guardian' else null end,
        case when p_booking ? 'legal_acceptance' and jsonb_typeof(p_booking->'legal_acceptance') = 'object' then p_booking->'legal_acceptance' else null end,
        v_key,
        coalesce((p_booking->>'requires_contract')::boolean, true),
        coalesce((p_booking->>'requires_guardian_release')::boolean, false),
        coalesce(nullif(p_booking->>'contract_state', ''), 'required'),
        coalesce((p_booking->>'deposit_percent')::numeric, 50),
        coalesce((p_booking->>'deposit_qr')::numeric, 0),
        coalesce((p_booking->>'balance_qr')::numeric, 0),
        coalesce(nullif(p_booking->>'deposit_state', ''), 'pending'),
        v_ref
      )
      returning id into v_booking_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'photo_bookings_public_ref_uidx' or v_attempt >= 10 then
        raise;
      end if;
    end;
  end loop;

  update public.photo_leads set booking_id = v_booking_id where id = v_lead_id;

  -- Audit rows as the public actor; the creation row learns the generated ids.
  if p_audit is not null and jsonb_typeof(p_audit) = 'array' then
    for v_row in select value from jsonb_array_elements(p_audit) loop
      insert into public.photo_audit_log (owner_id, actor_id, actor_kind, entity, entity_id, action, data)
      values (
        p_owner_id, null, 'public', coalesce(nullif(v_row->>'entity', ''), 'booking'), v_booking_id,
        coalesce(nullif(v_row->>'action', ''), 'booking.created'),
        coalesce(v_row->'data', '{}'::jsonb) || case when coalesce(v_row->>'action', 'booking.created') = 'booking.created' then jsonb_build_object('lead_id', v_lead_id, 'public_ref', v_ref) else '{}'::jsonb end
      );
    end loop;
  end if;

  return jsonb_build_object('booking_id', v_booking_id, 'lead_id', v_lead_id, 'person_id', v_person_id, 'public_ref', v_ref, 'replay', false);
end; $$;

revoke all on function public.photo_submit_public_booking(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.photo_submit_public_booking(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
