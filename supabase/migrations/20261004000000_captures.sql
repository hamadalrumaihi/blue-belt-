-- Phase A: capture ledger for trustworthy bracket capture.
-- Additive, owner-isolated. One row per capture of a source page delivered by
-- any transport (import page, browser hand-over, Windows agent, render worker).
--   * (owner_id, capture_id) is unique: a replayed capture id never applies twice.
--   * source_key is the owner-neutral source identity (host|path|bracket params);
--     rows are always read with owner_id, never shared across owners.
--   * status: received -> applied | rejected. reject_code names why.
create table if not exists public.photo_captures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  capture_id text not null,
  source_key text not null,
  source_url text not null,
  final_url text,
  transport text not null default 'import' check (transport in ('import','handoff','agent','worker','http')),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  status text not null default 'received' check (status in ('received','applied','rejected')),
  reject_code text,
  content_hash text not null,
  bytes integer not null default 0,
  completeness text not null default 'unknown' check (completeness in ('complete','partial','unknown')),
  athlete_count integer,
  outcome jsonb not null default '{}'::jsonb,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, capture_id)
);
create index if not exists photo_captures_owner_source_idx
  on public.photo_captures (owner_id, source_key, captured_at desc) where status = 'applied';
create index if not exists photo_captures_owner_received_idx
  on public.photo_captures (owner_id, received_at desc);
alter table public.photo_captures enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'photo_captures' and policyname = 'photo_captures_owner_all') then
    create policy photo_captures_owner_all on public.photo_captures
      for all using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'photo_captures_set_updated_at') then
    create trigger photo_captures_set_updated_at before update on public.photo_captures
      for each row execute function public.photo_set_updated_at();
  end if;
end $$;
