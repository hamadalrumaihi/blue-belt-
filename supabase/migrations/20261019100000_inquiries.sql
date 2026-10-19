-- Contact & Inquiries (website transformation, 19 Oct 2026).
--
-- The public contact form used to drop a bare message into photo_leads. The
-- new Contact & Inquiries page stores every message as a first-class
-- inquiry with its own reference, category, optional booking / order /
-- gallery reference, source page, status pipeline and private notes, so the
-- owner can work them from /inquiries and report on them. Leads and
-- bookings are untouched; an inquiry converted to a booking links to it.
--
-- Additive and idempotent: one table, its indexes, trigger, policies and
-- grants. Nothing existing changes.

create table if not exists public.photo_inquiries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Short public reference quoted by the customer (same alphabet as booking refs, IQ- prefix).
  reference text not null,
  person_id uuid references public.photo_people (id) on delete set null,
  full_name text not null,
  email text not null,
  category text not null check (category in (
    'general', 'tournament_event', 'athlete', 'club_team', 'photography', 'videography',
    'commercial_creative', 'booking_question', 'existing_order', 'payment_billing',
    'partnership', 'technical_support', 'other'
  )),
  subject text not null,
  message text not null,
  -- Optional customer-supplied booking / order / gallery reference, kept verbatim (trimmed).
  booking_reference text,
  -- The page the form was opened from (path only, no query), for lead tracking.
  source_page text,
  status text not null default 'new' check (status in ('new', 'in_progress', 'waiting_customer', 'quoted', 'converted', 'resolved', 'closed')),
  booking_id uuid references public.photo_bookings (id) on delete set null,
  -- Internal notes: [{ "at": iso, "by": uuid|null, "text": "..." }], never shown to the customer.
  notes jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb,
  -- Browser-generated key so a retried submission never creates a second inquiry.
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists photo_inquiries_reference_uidx on public.photo_inquiries (owner_id, reference);
create unique index if not exists photo_inquiries_idempotency_uidx on public.photo_inquiries (owner_id, idempotency_key) where idempotency_key is not null;
create index if not exists photo_inquiries_owner_status_idx on public.photo_inquiries (owner_id, status, created_at desc);
create index if not exists photo_inquiries_owner_category_idx on public.photo_inquiries (owner_id, category, created_at desc);
create index if not exists photo_inquiries_person_idx on public.photo_inquiries (person_id) where person_id is not null;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'photo_inquiries_set_updated_at') then
    create trigger photo_inquiries_set_updated_at before update on public.photo_inquiries for each row execute function public.photo_set_updated_at();
  end if;
end $$;

-- RLS: a studio user (owner or staff profile) works their own owner's rows. The public
-- form inserts through the service role on the server; anon never touches the table.
alter table public.photo_inquiries enable row level security;

drop policy if exists photo_inquiries_owner_select on public.photo_inquiries;
create policy photo_inquiries_owner_select on public.photo_inquiries
  for select using ((select auth.uid()) = owner_id and public.photo_is_studio_user());

drop policy if exists photo_inquiries_owner_insert on public.photo_inquiries;
create policy photo_inquiries_owner_insert on public.photo_inquiries
  for insert with check ((select auth.uid()) = owner_id and public.photo_is_studio_user());

drop policy if exists photo_inquiries_owner_update on public.photo_inquiries;
create policy photo_inquiries_owner_update on public.photo_inquiries
  for update using ((select auth.uid()) = owner_id and public.photo_is_studio_user())
  with check ((select auth.uid()) = owner_id and public.photo_is_studio_user());

drop policy if exists photo_inquiries_owner_delete on public.photo_inquiries;
create policy photo_inquiries_owner_delete on public.photo_inquiries
  for delete using ((select auth.uid()) = owner_id and public.photo_is_studio_user());

revoke all on table public.photo_inquiries from anon;
grant select, insert, update, delete on table public.photo_inquiries to authenticated, service_role;
