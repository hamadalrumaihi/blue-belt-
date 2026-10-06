-- Studio platform (Blue Belt Media): roles, CRM, bookings lifecycle, documents,
-- galleries, payment records, client notifications, audit log.
--
-- Additive only. Every watcher table and RPC is untouched; photo_bookings and
-- photo_orders only gain nullable / defaulted columns. Re-running is safe.
--
-- Roles ----------------------------------------------------------------------
-- photo_profiles.role: 'owner' (the studio), 'staff' (invited collaborator),
-- 'client' (signs in to the client portal only). Existing auth users are
-- trusted and become owners (member-only users become staff); every user
-- created from now on is a client unless app metadata says otherwise.

create table if not exists public.photo_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'client' check (role in ('owner', 'staff', 'client')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.photo_profiles (user_id, role)
select u.id,
       case
         when exists (select 1 from public.photo_events e where e.owner_id = u.id) then 'owner'
         when exists (select 1 from public.photo_event_members m where m.user_id = u.id) then 'staff'
         else 'owner'
       end
from auth.users u
on conflict (user_id) do nothing;

alter table public.photo_profiles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_profiles' and policyname = 'photo_profiles_self_select') then
    create policy photo_profiles_self_select on public.photo_profiles for select using ((select auth.uid()) = user_id);
  end if;
end $$;

-- Studio (single tenant): which owner the public site books for, and what it shows.
create table if not exists public.photo_studio (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  business_name text not null default 'Blue Belt Media',
  tagline text,
  about text,
  city text default 'Doha, Qatar',
  email text,
  phone text,
  whatsapp text,
  instagram text,
  public_booking boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CRM --------------------------------------------------------------------------
create table if not exists public.photo_people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  full_name text not null,
  email text,
  email_key text generated always as (lower(btrim(email))) stored,
  phone text,
  phone_key text,
  instagram text,
  whatsapp text,
  kind text not null default 'person' check (kind in ('person', 'parent', 'coach', 'club_contact')),
  source text not null default 'manual',
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists photo_people_owner_email_uidx on public.photo_people (owner_id, email_key) where email_key is not null;
create index if not exists photo_people_owner_idx on public.photo_people (owner_id, created_at desc);
create index if not exists photo_people_user_idx on public.photo_people (user_id) where user_id is not null;
create index if not exists photo_people_phone_idx on public.photo_people (owner_id, phone_key) where phone_key is not null;

create table if not exists public.photo_organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'club' check (kind in ('club', 'academy', 'team', 'federation', 'other')),
  primary_contact_id uuid references public.photo_people (id) on delete set null,
  email text,
  phone text,
  instagram text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists photo_organizations_owner_idx on public.photo_organizations (owner_id, name);

create table if not exists public.photo_services (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code text not null,
  name text not null,
  booking_type text not null check (booking_type in ('tournament_athlete', 'club', 'training_session', 'private_session', 'custom')),
  description text,
  price_qr numeric(10, 2) check (price_qr is null or price_qr >= 0),
  deposit_qr numeric(10, 2) check (deposit_qr is null or deposit_qr >= 0),
  currency text not null default 'QAR',
  duration_minutes int check (duration_minutes is null or duration_minutes > 0),
  includes_photo boolean not null default true,
  includes_video boolean not null default false,
  active boolean not null default true,
  public boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, code)
);

create table if not exists public.photo_leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id uuid references public.photo_people (id) on delete set null,
  organization_id uuid references public.photo_organizations (id) on delete set null,
  event_id uuid references public.photo_events (id) on delete set null,
  booking_type text check (booking_type is null or booking_type in ('tournament_athlete', 'club', 'training_session', 'private_session', 'custom')),
  status text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'converted', 'lost')),
  source text not null default 'website',
  message text,
  details jsonb not null default '{}'::jsonb,
  booking_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists photo_leads_owner_status_idx on public.photo_leads (owner_id, status, created_at desc);

-- Documents --------------------------------------------------------------------
create table if not exists public.photo_document_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('services_agreement', 'event_agreement', 'session_agreement', 'print_release', 'model_release', 'club_agreement', 'custom')),
  name text not null,
  body text not null,
  version int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists photo_document_templates_owner_idx on public.photo_document_templates (owner_id, kind);

create table if not exists public.photo_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_id uuid references public.photo_document_templates (id) on delete set null,
  template_version int,
  kind text not null,
  title text not null,
  booking_id uuid references public.photo_bookings (id) on delete set null,
  client_id uuid references public.photo_people (id) on delete set null,
  organization_id uuid references public.photo_organizations (id) on delete set null,
  body text not null,
  body_hash text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'viewed', 'signed', 'declined', 'expired')),
  access_token_hash text,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  expires_at timestamptz,
  signer_name text,
  signer_email text,
  signer_phone text,
  signature_evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists photo_documents_token_uidx on public.photo_documents (access_token_hash) where access_token_hash is not null;
create index if not exists photo_documents_owner_status_idx on public.photo_documents (owner_id, status, created_at desc);
create index if not exists photo_documents_booking_idx on public.photo_documents (booking_id) where booking_id is not null;

-- Galleries (Pic-Time stays the gallery engine; this is the link + lifecycle) ----
create table if not exists public.photo_galleries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  booking_id uuid references public.photo_bookings (id) on delete set null,
  client_id uuid references public.photo_people (id) on delete set null,
  event_id uuid references public.photo_events (id) on delete set null,
  name text not null,
  pictime_url text,
  pictime_project_id text,
  status text not null default 'pending' check (status in ('pending', 'created', 'ready', 'delivered')),
  created_in_pictime_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  notified_at timestamptz,
  visitor_count int not null default 0,
  last_visitor_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists photo_galleries_owner_status_idx on public.photo_galleries (owner_id, status, created_at desc);
create index if not exists photo_galleries_booking_idx on public.photo_galleries (booking_id) where booking_id is not null;

-- Bookings lifecycle -------------------------------------------------------------
-- photo_bookings.status stays the PROVIDER payment status (MyFatoorah webhook
-- state machine). booking_status is the business lifecycle.
alter table public.photo_bookings
  add column if not exists booking_type text not null default 'tournament_athlete',
  add column if not exists booking_status text not null default 'inquiry',
  add column if not exists client_id uuid references public.photo_people (id) on delete set null,
  add column if not exists organization_id uuid references public.photo_organizations (id) on delete set null,
  add column if not exists service_id uuid references public.photo_services (id) on delete set null,
  add column if not exists lead_id uuid references public.photo_leads (id) on delete set null,
  add column if not exists session_at timestamptz,
  add column if not exists session_end_at timestamptz,
  add column if not exists location text,
  add column if not exists payment_mode text not null default 'link_later',
  add column if not exists payment_method text,
  add column if not exists amount_paid_qr numeric(10, 2) not null default 0,
  add column if not exists manual_paid_at timestamptz,
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists contract_document_id uuid references public.photo_documents (id) on delete set null,
  add column if not exists gallery_id uuid references public.photo_galleries (id) on delete set null,
  add column if not exists assigned_photographer_id uuid references auth.users (id) on delete set null,
  add column if not exists assigned_videographer_id uuid references auth.users (id) on delete set null,
  add column if not exists quoted_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists coverage_done_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists public_ref text;

alter table public.photo_bookings drop constraint if exists photo_bookings_booking_type_check;
alter table public.photo_bookings add constraint photo_bookings_booking_type_check
  check (booking_type in ('tournament_athlete', 'club', 'training_session', 'private_session', 'custom'));
alter table public.photo_bookings drop constraint if exists photo_bookings_booking_status_check;
alter table public.photo_bookings add constraint photo_bookings_booking_status_check
  check (booking_status in ('inquiry', 'quoted', 'awaiting_contract', 'awaiting_payment', 'confirmed', 'in_progress', 'delivered', 'completed', 'cancelled'));
alter table public.photo_bookings drop constraint if exists photo_bookings_payment_mode_check;
alter table public.photo_bookings add constraint photo_bookings_payment_mode_check
  check (payment_mode in ('instant', 'link_later', 'manual', 'quote'));
alter table public.photo_bookings drop constraint if exists photo_bookings_payment_method_check;
alter table public.photo_bookings add constraint photo_bookings_payment_method_check
  check (payment_method is null or payment_method in ('myfatoorah', 'cash', 'bank_transfer', 'fawran', 'other'));
alter table public.photo_bookings drop constraint if exists photo_bookings_amount_paid_check;
alter table public.photo_bookings add constraint photo_bookings_amount_paid_check check (amount_paid_qr >= 0);
create unique index if not exists photo_bookings_public_ref_uidx on public.photo_bookings (public_ref) where public_ref is not null;
create index if not exists photo_bookings_owner_idx on public.photo_bookings (owner_id, created_at desc);
create index if not exists photo_bookings_owner_status_idx on public.photo_bookings (owner_id, booking_status);
create index if not exists photo_bookings_client_idx on public.photo_bookings (client_id) where client_id is not null;
create index if not exists photo_bookings_session_idx on public.photo_bookings (owner_id, session_at) where session_at is not null;

alter table public.photo_leads drop constraint if exists photo_leads_booking_fk;
alter table public.photo_leads add constraint photo_leads_booking_fk foreign key (booking_id) references public.photo_bookings (id) on delete set null;

-- Orders: optional links to the CRM person and the gallery; a status check at last.
alter table public.photo_orders
  add column if not exists client_id uuid references public.photo_people (id) on delete set null,
  add column if not exists gallery_id uuid references public.photo_galleries (id) on delete set null;
update public.photo_orders set status = 'placed' where status = 'pending';
alter table public.photo_orders drop constraint if exists photo_orders_status_check;
alter table public.photo_orders add constraint photo_orders_status_check check (status in ('placed', 'fulfilled', 'cancelled'));
alter table public.photo_orders alter column status set default 'placed';
create index if not exists photo_orders_owner_idx on public.photo_orders (owner_id, created_at desc);

-- Payment records: every payment the business counts, provider or manual.
-- A manual record never touches a provider-verified photo_bookings.status.
create table if not exists public.photo_payment_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  booking_id uuid references public.photo_bookings (id) on delete cascade,
  order_id uuid references public.photo_orders (id) on delete cascade,
  kind text not null check (kind in ('provider', 'manual')),
  method text not null check (method in ('myfatoorah', 'cash', 'bank_transfer', 'fawran', 'other')),
  amount_qr numeric(10, 2) not null check (amount_qr >= 0),
  currency text not null default 'QAR',
  paid_at timestamptz not null default now(),
  note text,
  recorded_by uuid references auth.users (id) on delete set null,
  provider text,
  provider_payment_id text,
  created_at timestamptz not null default now(),
  constraint photo_payment_records_target_check check (booking_id is not null or order_id is not null)
);
create index if not exists photo_payment_records_owner_idx on public.photo_payment_records (owner_id, paid_at desc);
create index if not exists photo_payment_records_booking_idx on public.photo_payment_records (booking_id) where booking_id is not null;
create unique index if not exists photo_payment_records_provider_uidx on public.photo_payment_records (provider, provider_payment_id) where provider_payment_id is not null;

-- Client notification preferences (owner switches a kind off for everyone).
create table if not exists public.photo_client_notification_prefs (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (owner_id, kind)
);

-- Audit log: who did what to which record (manual payments, signatures, status changes).
create table if not exists public.photo_audit_log (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid,
  actor_kind text not null default 'owner' check (actor_kind in ('owner', 'staff', 'client', 'system', 'public')),
  entity text not null,
  entity_id uuid,
  action text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists photo_audit_log_owner_idx on public.photo_audit_log (owner_id, created_at desc);
create index if not exists photo_audit_log_entity_idx on public.photo_audit_log (entity, entity_id);

-- RLS ---------------------------------------------------------------------------
select public.photo_ensure_owner_policies('photo_studio');
select public.photo_ensure_owner_policies('photo_people');
select public.photo_ensure_owner_policies('photo_organizations');
select public.photo_ensure_owner_policies('photo_services');
select public.photo_ensure_owner_policies('photo_leads');
select public.photo_ensure_owner_policies('photo_document_templates');
select public.photo_ensure_owner_policies('photo_documents');
select public.photo_ensure_owner_policies('photo_galleries');
select public.photo_ensure_owner_policies('photo_payment_records');
select public.photo_ensure_owner_policies('photo_client_notification_prefs');

alter table public.photo_audit_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_audit_log' and policyname = 'photo_audit_log_owner_select') then
    create policy photo_audit_log_owner_select on public.photo_audit_log for select using ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_audit_log' and policyname = 'photo_audit_log_owner_insert') then
    create policy photo_audit_log_owner_insert on public.photo_audit_log for insert with check ((select auth.uid()) = owner_id and actor_id = (select auth.uid()));
  end if;
end $$;

-- Client portal: a signed-in client sees rows linked to their own person record only.
create or replace function public.photo_is_my_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.photo_people p
    where p.id = p_person_id and p.user_id = auth.uid() and auth.uid() is not null
  );
$$;
revoke execute on function public.photo_is_my_person(uuid) from public, anon;
grant execute on function public.photo_is_my_person(uuid) to authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_people' and policyname = 'photo_people_self_select') then
    create policy photo_people_self_select on public.photo_people for select using (user_id is not null and user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_bookings' and policyname = 'photo_bookings_client_select') then
    create policy photo_bookings_client_select on public.photo_bookings for select using (client_id is not null and public.photo_is_my_person(client_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_documents' and policyname = 'photo_documents_client_select') then
    create policy photo_documents_client_select on public.photo_documents for select using (client_id is not null and public.photo_is_my_person(client_id) and status <> 'draft');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_galleries' and policyname = 'photo_galleries_client_select') then
    create policy photo_galleries_client_select on public.photo_galleries for select using (client_id is not null and public.photo_is_my_person(client_id) and status in ('ready', 'delivered'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_payment_records' and policyname = 'photo_payment_records_client_select') then
    create policy photo_payment_records_client_select on public.photo_payment_records for select
      using (booking_id is not null and exists (select 1 from public.photo_bookings b where b.id = booking_id and b.client_id is not null and public.photo_is_my_person(b.client_id)));
  end if;
end $$;

-- updated_at triggers ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['photo_profiles', 'photo_studio', 'photo_people', 'photo_organizations', 'photo_services', 'photo_leads', 'photo_document_templates', 'photo_documents', 'photo_galleries'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_set_updated_at') then
      execute format('create trigger %I before update on public.%I for each row execute function public.photo_set_updated_at()', t || '_set_updated_at', t);
    end if;
  end loop;
end $$;

-- New auth users: profile row (role from app metadata, default client) and
-- link the CRM person with the same e-mail so the portal shows their bookings.
create or replace function public.photo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  v_role := coalesce(new.raw_app_meta_data->>'role', 'client');
  if v_role not in ('owner', 'staff', 'client') then v_role := 'client'; end if;
  insert into public.photo_profiles (user_id, role) values (new.id, v_role) on conflict (user_id) do nothing;
  if new.email is not null then
    update public.photo_people set user_id = new.id, updated_at = now()
    where user_id is null and email_key = lower(btrim(new.email));
  end if;
  return new;
end;
$$;
revoke execute on function public.photo_handle_new_user() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'photo_on_auth_user_created') then
    create trigger photo_on_auth_user_created after insert on auth.users for each row execute function public.photo_handle_new_user();
  end if;
end $$;

-- Current role of the caller (used by layouts; never trusted from the browser).
create or replace function public.photo_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.photo_profiles where user_id = auth.uid()),
    case
      when exists (select 1 from public.photo_events e where e.owner_id = auth.uid()) then 'owner'
      when exists (select 1 from public.photo_event_members m where m.user_id = auth.uid()) then 'staff'
      else 'client'
    end);
$$;
revoke execute on function public.photo_my_role() from public, anon;
grant execute on function public.photo_my_role() to authenticated, service_role;
