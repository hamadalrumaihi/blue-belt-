-- Phase 3: operational-incident tracking for Telegram diagnostics.
-- Additive, owner-isolated. Applied to project nuujdewnkovtdvlbfzdx on 2026-10-03.
create table if not exists public.photo_incidents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  incident_key text not null,
  kind text not null,
  event_id uuid references public.photo_events(id) on delete set null,
  source_host text,
  athlete_count integer not null default 1,
  status text not null default 'open' check (status in ('open','resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  occurrences integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, incident_key)
);
create index if not exists photo_incidents_owner_status_idx on public.photo_incidents (owner_id, status);
alter table public.photo_incidents enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'photo_incidents' and policyname = 'photo_incidents_owner_all') then
    create policy photo_incidents_owner_all on public.photo_incidents
      for all using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
end $$;
