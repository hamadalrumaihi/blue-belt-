-- =============================================================================
-- Tournament Watcher v2: source health, atomic refresh, settings, collaboration
-- foundation, Telegram notifications, payment preparation.
-- Additive and idempotent. Owner isolation is unchanged: no policy here lets a
-- user read or write another owner's rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Athlete source health: attempts vs successes, failure streaks, diagnostics
-- -----------------------------------------------------------------------------
alter table public.photo_athletes
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists last_watch_code text,
  add column if not exists last_watch_strategy text,
  add column if not exists last_source_status integer,
  add column if not exists last_final_url text,
  add column if not exists last_elapsed_ms integer,
  add column if not exists refresh_version integer not null default 0,
  add column if not exists name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored;

-- Duplicate-client detection: same normalised name inside one event.
create index if not exists photo_athletes_owner_event_name_key_idx
  on public.photo_athletes (owner_id, event_id, name_key);
-- Scheduled refresh scans active, watchable athletes ordered by last attempt.
create index if not exists photo_athletes_refresh_queue_idx
  on public.photo_athletes (event_id, last_attempt_at nulls first, id)
  where active and source_url is not null;

-- Match identity confidence: exact (external id / match number), probable
-- (single fallback candidate), ambiguous (several candidates; row kept apart).
alter table public.photo_matches
  add column if not exists identity_confidence text not null default 'exact';
alter table public.photo_matches drop constraint if exists photo_matches_identity_confidence_check;
alter table public.photo_matches add constraint photo_matches_identity_confidence_check
  check (identity_confidence in ('exact', 'probable', 'ambiguous'));
alter table public.photo_matches drop constraint if exists photo_matches_status_check;
alter table public.photo_matches add constraint photo_matches_status_check
  check (status in ('scheduled', 'on_mat', 'complete', 'delayed', 'unknown'));

-- Cursor pagination on the activity feed: (detected_at desc, id desc).
create index if not exists photo_match_history_owner_cursor_idx
  on public.photo_match_history (owner_id, detected_at desc, id desc);
create index if not exists photo_match_history_match_idx
  on public.photo_match_history (match_id, detected_at desc);

-- -----------------------------------------------------------------------------
-- 2. Atomic, idempotent refresh persistence
-- -----------------------------------------------------------------------------
-- The app computes the diff (which rows to update / insert, which history rows
-- to write) against the match rows it read together with refresh_version.
-- This function applies that plan in ONE transaction under a per-athlete
-- advisory lock and refuses it when the version moved: two concurrent
-- refreshes of the same athlete can never both insert the same match or
-- duplicate history. SECURITY INVOKER, so RLS applies exactly as for the
-- caller (owner session or service role).
create or replace function public.photo_apply_refresh(
  p_athlete_id uuid,
  p_expected_version integer,
  p_checked_at timestamptz,
  p_ok boolean,
  p_status text,
  p_code text,
  p_message text,
  p_diag jsonb default '{}'::jsonb,
  p_updates jsonb default '[]'::jsonb,
  p_inserts jsonb default '[]'::jsonb,
  p_history jsonb default '[]'::jsonb,
  p_touch_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_athlete public.photo_athletes%rowtype;
  v_row jsonb;
  v_patch jsonb;
  v_new_id uuid;
  v_new_ids uuid[] := '{}'::uuid[];
  v_match_id uuid;
  v_matches jsonb;
  v_diag jsonb := coalesce(p_diag, '{}'::jsonb);
begin
  perform pg_advisory_xact_lock(hashtext('photo_refresh:' || p_athlete_id::text));

  select * into v_athlete from public.photo_athletes where id = p_athlete_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_athlete.refresh_version <> p_expected_version then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.match_order nulls last, m.scheduled_at nulls last, m.created_at), '[]'::jsonb)
      into v_matches from public.photo_matches m where m.athlete_id = p_athlete_id;
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'version', v_athlete.refresh_version, 'matches', v_matches);
  end if;

  if p_ok then
    for v_row in select value from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) loop
      v_patch := v_row->'patch';
      update public.photo_matches set
        external_match_id = v_patch->>'external_match_id',
        opponent = v_patch->>'opponent',
        mat = v_patch->>'mat',
        scheduled_at = nullif(v_patch->>'scheduled_at', '')::timestamptz,
        estimated_at = nullif(v_patch->>'estimated_at', '')::timestamptz,
        status = coalesce(v_patch->>'status', status),
        match_order = nullif(v_patch->>'match_order', '')::integer,
        source_url = coalesce(v_patch->>'source_url', source_url),
        last_checked_at = coalesce(nullif(v_patch->>'last_checked_at', '')::timestamptz, p_checked_at),
        last_changed_at = nullif(v_patch->>'last_changed_at', '')::timestamptz,
        raw_snapshot = coalesce(v_patch->'raw_snapshot', raw_snapshot),
        identity_confidence = coalesce(v_patch->>'identity_confidence', identity_confidence)
      where id = (v_row->>'id')::uuid and athlete_id = p_athlete_id;
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_inserts, '[]'::jsonb)) loop
      insert into public.photo_matches (
        owner_id, athlete_id, external_match_id, opponent, mat, scheduled_at, estimated_at, status,
        match_order, source_url, last_checked_at, last_changed_at, raw_snapshot, identity_confidence
      ) values (
        v_athlete.owner_id, p_athlete_id, v_row->>'external_match_id', v_row->>'opponent', v_row->>'mat',
        nullif(v_row->>'scheduled_at', '')::timestamptz, nullif(v_row->>'estimated_at', '')::timestamptz,
        coalesce(v_row->>'status', 'scheduled'), nullif(v_row->>'match_order', '')::integer, v_row->>'source_url',
        coalesce(nullif(v_row->>'last_checked_at', '')::timestamptz, p_checked_at),
        coalesce(nullif(v_row->>'last_changed_at', '')::timestamptz, p_checked_at),
        coalesce(v_row->'raw_snapshot', '{}'::jsonb), coalesce(v_row->>'identity_confidence', 'exact')
      )
      on conflict (athlete_id, external_match_id) where external_match_id is not null do update set
        opponent = excluded.opponent, mat = excluded.mat, scheduled_at = excluded.scheduled_at,
        estimated_at = excluded.estimated_at, status = excluded.status, match_order = excluded.match_order,
        source_url = excluded.source_url, last_checked_at = excluded.last_checked_at,
        raw_snapshot = excluded.raw_snapshot
      returning id into v_new_id;
      v_new_ids := array_append(v_new_ids, v_new_id);
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_history, '[]'::jsonb)) loop
      if v_row ? 'match_ref' then
        v_match_id := v_new_ids[(v_row->>'match_ref')::integer + 1];
      else
        v_match_id := (v_row->>'match_id')::uuid;
      end if;
      if v_match_id is null then continue; end if;
      insert into public.photo_match_history (owner_id, match_id, change_type, old_value, new_value, detected_at)
      values (v_athlete.owner_id, v_match_id, v_row->>'change_type', v_row->'old_value', v_row->'new_value', p_checked_at);
    end loop;

    if coalesce(array_length(p_touch_ids, 1), 0) > 0 then
      update public.photo_matches set last_checked_at = p_checked_at
      where athlete_id = p_athlete_id and id = any (p_touch_ids);
    end if;

    update public.photo_athletes set
      last_checked_at = p_checked_at,
      last_attempt_at = p_checked_at,
      last_success_at = p_checked_at,
      consecutive_failures = 0,
      last_watch_status = p_status,
      last_watch_code = p_code,
      last_watch_message = p_message,
      last_watch_strategy = v_diag->>'strategy',
      last_source_status = nullif(v_diag->>'sourceStatus', '')::integer,
      last_final_url = v_diag->>'finalUrl',
      last_elapsed_ms = nullif(v_diag->>'elapsedMs', '')::integer,
      refresh_version = refresh_version + 1
    where id = p_athlete_id;
  else
    update public.photo_athletes set
      last_checked_at = p_checked_at,
      last_attempt_at = p_checked_at,
      consecutive_failures = consecutive_failures + 1,
      last_watch_status = p_status,
      last_watch_code = p_code,
      last_watch_message = p_message,
      last_watch_strategy = v_diag->>'strategy',
      last_source_status = nullif(v_diag->>'sourceStatus', '')::integer,
      last_final_url = v_diag->>'finalUrl',
      last_elapsed_ms = nullif(v_diag->>'elapsedMs', '')::integer
    where id = p_athlete_id;
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.match_order nulls last, m.scheduled_at nulls last, m.created_at), '[]'::jsonb)
    into v_matches from public.photo_matches m where m.athlete_id = p_athlete_id;
  select refresh_version into v_athlete.refresh_version from public.photo_athletes where id = p_athlete_id;

  return jsonb_build_object('ok', true, 'version', v_athlete.refresh_version, 'matches', v_matches, 'inserted_ids', to_jsonb(v_new_ids));
end $$;

revoke all on function public.photo_apply_refresh(uuid, integer, timestamptz, boolean, text, text, text, jsonb, jsonb, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.photo_apply_refresh(uuid, integer, timestamptz, boolean, text, text, text, jsonb, jsonb, jsonb, jsonb, uuid[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Persisted settings (account + event). localStorage stays the cache.
-- -----------------------------------------------------------------------------
create table if not exists public.photo_user_settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.photo_event_settings (
  event_id uuid primary key references public.photo_events (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.photo_ensure_owner_policies('photo_user_settings');
select public.photo_ensure_owner_policies('photo_event_settings');

-- -----------------------------------------------------------------------------
-- 4. Collaboration foundation (NOT yet widening access)
-- -----------------------------------------------------------------------------
-- Memberships are recorded so a later release can let assistants read an
-- event. Only the event owner can manage rows; members can see their own
-- membership. No policy on events/athletes/matches/history consults this
-- table yet: owner isolation is unchanged until RLS tests cover the widening.
create table if not exists public.photo_event_members (
  event_id uuid not null references public.photo_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'photographer', 'assistant')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.photo_event_members enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_event_members' and policyname = 'photo_event_members_owner_all') then
    create policy photo_event_members_owner_all on public.photo_event_members
      for all
      using (exists (select 1 from public.photo_events e where e.id = event_id and e.owner_id = (select auth.uid())))
      with check (exists (select 1 from public.photo_events e where e.id = event_id and e.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_event_members' and policyname = 'photo_event_members_self_select') then
    create policy photo_event_members_self_select on public.photo_event_members
      for select using (user_id = (select auth.uid()));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Telegram notifications
-- -----------------------------------------------------------------------------
-- Bot token never lives in the database (TELEGRAM_BOT_TOKEN, server-only).
create table if not exists public.photo_telegram_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chat_id bigint,
  chat_title text,
  link_code text,
  link_code_expires_at timestamptz,
  linked_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists photo_telegram_links_code_uidx on public.photo_telegram_links (link_code) where link_code is not null;
create unique index if not exists photo_telegram_links_owner_chat_uidx on public.photo_telegram_links (owner_id, chat_id) where chat_id is not null;
select public.photo_ensure_owner_policies('photo_telegram_links');

create table if not exists public.photo_notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id uuid references public.photo_events (id) on delete cascade,
  channel text not null check (channel in ('telegram')),
  kinds text[] not null default array['GO_TO_MAT', 'ON_MAT', 'MAT_CHANGE', 'MOVED_EARLIER', 'MOVED_LATER'],
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists photo_notification_subscriptions_scope_uidx
  on public.photo_notification_subscriptions (owner_id, channel, coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid));
select public.photo_ensure_owner_policies('photo_notification_subscriptions');

create table if not exists public.photo_notification_deliveries (
  id bigint generated by default as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel text not null,
  alert_key text not null,
  kind text not null,
  athlete_id uuid references public.photo_athletes (id) on delete set null,
  match_id uuid references public.photo_matches (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One delivery per alert per channel per owner: the dedupe guarantee.
create unique index if not exists photo_notification_deliveries_dedupe_uidx
  on public.photo_notification_deliveries (owner_id, channel, alert_key);
create index if not exists photo_notification_deliveries_pending_idx
  on public.photo_notification_deliveries (status, next_attempt_at) where status in ('pending', 'failed');
select public.photo_ensure_owner_policies('photo_notification_deliveries');

-- -----------------------------------------------------------------------------
-- 6. Payment preparation (MyFatoorah; feature-flagged, outside the watcher path)
-- -----------------------------------------------------------------------------
alter table public.photo_bookings drop constraint if exists photo_bookings_status_check;
alter table public.photo_bookings add constraint photo_bookings_status_check
  check (status in ('pending', 'paid', 'failed', 'refunded', 'disputed', 'cancelled'));
alter table public.photo_bookings
  add column if not exists payment_status_updated_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists disputed_at timestamptz;
create unique index if not exists photo_bookings_provider_invoice_uidx
  on public.photo_bookings (provider, provider_invoice_id) where provider_invoice_id is not null;

create table if not exists public.photo_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  booking_id uuid references public.photo_bookings (id) on delete cascade,
  provider text not null default 'MYFATOORAH',
  provider_invoice_id text,
  provider_payment_id text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded', 'disputed', 'cancelled')),
  amount numeric not null default 0 check (amount >= 0),
  currency text not null default 'QAR',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists photo_payment_attempts_provider_payment_uidx
  on public.photo_payment_attempts (provider, provider_payment_id) where provider_payment_id is not null;
create index if not exists photo_payment_attempts_booking_idx on public.photo_payment_attempts (booking_id);
select public.photo_ensure_owner_policies('photo_payment_attempts');

-- Webhook deliveries: one row per provider event id (idempotency), with the
-- signature verdict and the processing outcome.
alter table public.photo_payment_events
  add column if not exists booking_id uuid references public.photo_bookings (id) on delete set null,
  add column if not exists signature_valid boolean,
  add column if not exists processed_at timestamptz,
  add column if not exists processing_result text,
  add column if not exists attempts integer not null default 1;
create unique index if not exists photo_payment_events_provider_event_uidx
  on public.photo_payment_events (provider, provider_event_id) where provider_event_id is not null;
create index if not exists photo_payment_events_booking_idx on public.photo_payment_events (booking_id);

-- updated_at triggers for the new tables
do $$
declare t text;
begin
  foreach t in array array['photo_user_settings', 'photo_event_settings', 'photo_telegram_links', 'photo_notification_subscriptions', 'photo_notification_deliveries', 'photo_payment_attempts'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.photo_set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;
