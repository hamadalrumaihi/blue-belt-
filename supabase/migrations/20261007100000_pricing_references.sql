-- Pricing research + quote suggestions (Blue Belt Media), owner only.
--
-- Additive and idempotent. Two new tables and one helper function; nothing
-- existing is touched. Unlike the other studio tables these are NOT shared
-- with staff: the policies require photo_is_owner_user(), so a staff or
-- client account gets zero rows and cannot insert, whatever the app does.

-- Caller is the studio owner (photo_profiles.role = 'owner'). -----------------
create or replace function public.photo_is_owner_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.photo_profiles p where p.user_id = auth.uid() and p.role = 'owner'
  );
$$;
revoke execute on function public.photo_is_owner_user() from public, anon;
grant execute on function public.photo_is_owner_user() to authenticated, service_role;

-- Reference prices: what other providers charge, checked by hand. --------------
create table if not exists public.photo_price_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null,
  source_url text,
  checked_on date not null default current_date,
  location text,
  service_type text not null check (service_type in ('tournament_athlete', 'club', 'training_session', 'private_session', 'custom')),
  price_from numeric(10, 2) not null check (price_from >= 0),
  price_to numeric(10, 2) check (price_to is null or price_to >= price_from),
  currency text not null default 'QAR',
  -- Free-form scope (hours, athletes, photos, video, editing_hours, delivery_days, raw_files, travel_included); validated in the app.
  includes jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists photo_price_references_owner_type_idx on public.photo_price_references (owner_id, service_type);

-- Quotes: the job inputs, the computed breakdown and what the owner chose. -----
create table if not exists public.photo_quotes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  booking_id uuid references public.photo_bookings (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'applied', 'discarded')),
  inputs jsonb not null,
  calculation jsonb not null,
  suggested_from numeric(10, 2),
  suggested_to numeric(10, 2),
  chosen_amount_qr numeric(10, 2) check (chosen_amount_qr is null or chosen_amount_qr >= 0),
  currency text not null default 'QAR',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists photo_quotes_owner_booking_idx on public.photo_quotes (owner_id, booking_id);
create index if not exists photo_quotes_owner_created_idx on public.photo_quotes (owner_id, created_at desc);

-- RLS: the owner's own rows, and only for an owner-role profile. ---------------
alter table public.photo_price_references enable row level security;
alter table public.photo_quotes enable row level security;

drop policy if exists photo_price_references_owner_all on public.photo_price_references;
create policy photo_price_references_owner_all on public.photo_price_references
  for all
  using ((select auth.uid()) = owner_id and public.photo_is_owner_user())
  with check ((select auth.uid()) = owner_id and public.photo_is_owner_user());

drop policy if exists photo_quotes_owner_all on public.photo_quotes;
create policy photo_quotes_owner_all on public.photo_quotes
  for all
  using ((select auth.uid()) = owner_id and public.photo_is_owner_user())
  with check ((select auth.uid()) = owner_id and public.photo_is_owner_user());

-- updated_at triggers ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['photo_price_references', 'photo_quotes'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_set_updated_at') then
      execute format('create trigger %I before update on public.%I for each row execute function public.photo_set_updated_at()', t || '_set_updated_at', t);
    end if;
  end loop;
end $$;
