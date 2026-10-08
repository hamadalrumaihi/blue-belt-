-- Round 3: 50% deposit before confirmation, 50% balance after delivery,
-- one payment request per booking stage, provider-neutral e-signature
-- records, legal acceptance evidence on public bookings.
--
-- Additive and idempotent. No existing column is dropped or renamed; the
-- provider payment status on photo_bookings.status and the MyFatoorah /
-- Pic-Time integrations are untouched.

-- 1. Bookings: deposit, balance, contract and legal evidence ------------------
alter table public.photo_bookings
  add column if not exists client_type text check (client_type is null or client_type in ('individual', 'parent_guardian', 'club_team', 'company_brand', 'event_organiser')),
  add column if not exists usage_type text check (usage_type is null or usage_type in ('personal', 'club_team', 'commercial')),
  add column if not exists subject_is_minor boolean not null default false,
  -- {name, email, phone, consent_at}; internal only, never read by the client views.
  add column if not exists guardian jsonb,
  -- {terms_version, privacy_version, accepted_at, ip, user_agent, consents: {...}}
  add column if not exists legal_acceptance jsonb,
  add column if not exists idempotency_key text,
  add column if not exists requires_contract boolean not null default true,
  add column if not exists requires_guardian_release boolean not null default false,
  add column if not exists contract_state text not null default 'required' check (contract_state in ('not_required', 'required', 'sent', 'signed', 'declined', 'void')),
  add column if not exists deposit_percent numeric(5, 2) not null default 50 check (deposit_percent >= 0 and deposit_percent <= 100),
  add column if not exists deposit_qr numeric(10, 2) not null default 0 check (deposit_qr >= 0),
  add column if not exists balance_qr numeric(10, 2) not null default 0 check (balance_qr >= 0),
  add column if not exists deposit_state text not null default 'pending' check (deposit_state in ('not_required', 'pending', 'paid', 'waived')),
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists balance_state text not null default 'not_due' check (balance_state in ('not_due', 'due', 'paid', 'waived')),
  add column if not exists balance_due_at timestamptz,
  add column if not exists balance_paid_at timestamptz,
  add column if not exists gallery_delivered_at timestamptz;

create unique index if not exists photo_bookings_idempotency_uidx on public.photo_bookings (owner_id, idempotency_key) where idempotency_key is not null;

-- Backfill: split any priced booking 50/50 once; bookings already paid in
-- full through the provider count as deposit paid and balance paid.
update public.photo_bookings
   set deposit_qr = round(amount_qr * deposit_percent / 100, 2),
       balance_qr = amount_qr - round(amount_qr * deposit_percent / 100, 2)
 where amount_qr > 0 and deposit_qr = 0 and balance_qr = 0;
update public.photo_bookings
   set deposit_state = 'not_required', balance_state = 'not_due'
 where amount_qr = 0 and deposit_state = 'pending';
update public.photo_bookings
   set deposit_state = 'paid', deposit_paid_at = coalesce(paid_at, manual_paid_at, now()),
       balance_state = 'paid', balance_paid_at = coalesce(paid_at, manual_paid_at, now())
 where status = 'paid' and deposit_state = 'pending';
update public.photo_bookings
   set contract_state = case when contract_document_id is null then 'required' else 'sent' end
 where contract_state = 'required' and contract_document_id is not null;

-- 2. Payment requests: one active request per booking and stage ----------------
create table if not exists public.photo_booking_payment_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  booking_id uuid not null references public.photo_bookings (id) on delete cascade,
  stage text not null check (stage in ('deposit', 'balance')),
  amount_qr numeric(10, 2) not null check (amount_qr > 0),
  currency text not null default 'QAR',
  -- MYFATOORAH (API), MANUAL_LINK (owner pasted a link), WEBSITE (our /pay page)
  provider text not null default 'WEBSITE',
  provider_invoice_id text,
  provider_payment_id text,
  provider_reference text,
  payment_url text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  idempotency_key text not null,
  generation int not null default 1 check (generation >= 1),
  pay_token_hash text,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists photo_booking_payment_requests_active_uidx on public.photo_booking_payment_requests (booking_id, stage) where status = 'pending';
create unique index if not exists photo_booking_payment_requests_idem_uidx on public.photo_booking_payment_requests (owner_id, idempotency_key);
create unique index if not exists photo_booking_payment_requests_invoice_uidx on public.photo_booking_payment_requests (provider, provider_invoice_id) where provider_invoice_id is not null;
create unique index if not exists photo_booking_payment_requests_token_uidx on public.photo_booking_payment_requests (pay_token_hash) where pay_token_hash is not null;
create index if not exists photo_booking_payment_requests_booking_idx on public.photo_booking_payment_requests (booking_id, created_at desc);

alter table public.photo_booking_payment_requests enable row level security;
drop policy if exists photo_booking_payment_requests_owner_all on public.photo_booking_payment_requests;
create policy photo_booking_payment_requests_owner_all on public.photo_booking_payment_requests
  for all
  using ((select auth.uid()) = owner_id and public.photo_is_studio_user())
  with check ((select auth.uid()) = owner_id and public.photo_is_studio_user());

-- 3. Documents: provider-neutral e-signature fields ------------------------------
alter table public.photo_documents
  add column if not exists provider text not null default 'internal',
  add column if not exists provider_envelope_id text,
  add column if not exists provider_status text,
  add column if not exists provider_error text,
  add column if not exists signer_role text not null default 'client' check (signer_role in ('client', 'guardian')),
  add column if not exists required_for_confirmation boolean not null default true,
  add column if not exists document_version text,
  add column if not exists voided_at timestamptz,
  add column if not exists completed_document_ref text,
  add column if not exists certificate_ref text;

alter table public.photo_documents drop constraint if exists photo_documents_status_check;
alter table public.photo_documents add constraint photo_documents_status_check check (status in ('draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'void'));
create unique index if not exists photo_documents_provider_envelope_uidx on public.photo_documents (provider, provider_envelope_id) where provider_envelope_id is not null;

alter table public.photo_document_templates drop constraint if exists photo_document_templates_kind_check;
alter table public.photo_document_templates add constraint photo_document_templates_kind_check check (kind in ('services_agreement', 'event_agreement', 'session_agreement', 'print_release', 'model_release', 'guardian_release', 'club_agreement', 'custom'));

-- Provider webhook events: idempotent by (provider, event_id). Service role only.
create table if not exists public.photo_esign_events (
  id bigserial primary key,
  provider text not null,
  event_id text not null,
  envelope_id text,
  event_type text,
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  result text,
  unique (provider, event_id)
);
alter table public.photo_esign_events enable row level security;

-- 4. updated_at trigger for the new table --------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'photo_booking_payment_requests_set_updated_at') then
    create trigger photo_booking_payment_requests_set_updated_at before update on public.photo_booking_payment_requests for each row execute function public.photo_set_updated_at();
  end if;
end $$;

-- 5. Client portal view: expose the stage columns, never guardian or legal evidence.
create or replace view public.photo_client_bookings_v with (security_invoker = false) as
  select b.id, b.owner_id, b.client_id, b.public_ref, b.booking_type, b.booking_status, b.athlete_name, b.customer_name, b.customer_email,
         b.customer_phone, b.academy, b.division, b.package_name, b.amount_qr, b.currency, b.status, b.payment_url, b.paid_at, b.event_id,
         b.session_at, b.session_end_at, b.location, b.payment_mode, b.payment_method, b.amount_paid_qr, b.manual_paid_at, b.details,
         b.contract_document_id, b.gallery_id, b.confirmed_at, b.delivered_at, b.completed_at, b.cancelled_at, b.created_at, b.updated_at,
         b.client_type, b.subject_is_minor, b.requires_contract, b.requires_guardian_release, b.contract_state,
         b.deposit_percent, b.deposit_qr, b.balance_qr, b.deposit_state, b.deposit_paid_at, b.balance_state, b.balance_due_at, b.balance_paid_at,
         b.gallery_delivered_at
  from public.photo_bookings b
  where b.client_id is not null and public.photo_is_my_person(b.client_id);
revoke all on public.photo_client_bookings_v from public, anon;
grant select on public.photo_client_bookings_v to authenticated, service_role;

-- 6. Client view of payment requests: amount, stage, status and our pay link only.
create or replace view public.photo_client_payment_requests_v with (security_invoker = false) as
  select r.id, r.owner_id, r.booking_id, r.stage, r.amount_qr, r.currency, r.status, r.payment_url, r.created_at, r.paid_at
  from public.photo_booking_payment_requests r
  where exists (
    select 1 from public.photo_bookings b where b.id = r.booking_id and b.client_id is not null and public.photo_is_my_person(b.client_id)
  );
revoke all on public.photo_client_payment_requests_v from public, anon;
grant select on public.photo_client_payment_requests_v to authenticated, service_role;
