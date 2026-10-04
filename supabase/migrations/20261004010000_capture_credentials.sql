-- Phase B: revocable, expiring, owner/source-scoped credentials for machine
-- capture intake (the Windows event-session agent). Additive, owner-isolated.
-- Only the sha256 of a token is stored. The agent's heartbeat is kept on the
-- credential row so the owner can see when their agent last reported.
create table if not exists public.photo_capture_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  -- null = any source of this owner; otherwise only these source identities.
  scope_source_keys text[],
  scope_event_id uuid references public.photo_events(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  use_count integer not null default 0,
  last_heartbeat_at timestamptz,
  agent_version text,
  agent_status jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists photo_capture_credentials_owner_idx on public.photo_capture_credentials (owner_id, created_at desc);
alter table public.photo_capture_credentials enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'photo_capture_credentials' and policyname = 'photo_capture_credentials_owner_all') then
    create policy photo_capture_credentials_owner_all on public.photo_capture_credentials
      for all using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'photo_capture_credentials_set_updated_at') then
    create trigger photo_capture_credentials_set_updated_at before update on public.photo_capture_credentials
      for each row execute function public.photo_set_updated_at();
  end if;
end $$;
