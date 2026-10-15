-- Media library (Blue Belt Media): owner-managed photographs in Supabase Storage.
--
-- Additive and idempotent. Two tables, two storage buckets and their policies.
-- The project is shared with another application, so every object is prefixed
-- photo_ (tables) or bbm- (buckets). Writes are OWNER ONLY (photo_is_owner_user()
-- from 20261007100000_pricing_references.sql): staff and client accounts get
-- zero rows and cannot insert, and anon has no grant at all.
--
-- Trust boundaries:
--   * bbm-media-private  originals and drafts. Never public. An owner-role user may
--     insert / read / delete objects under "<their uid>/..." only; that is what the
--     signed upload URL path relies on. Nothing else reads it except the service role.
--   * bbm-media-public   published web derivatives only (JPEG, stripped of EXIF).
--     Anyone may read; NO authenticated write policy exists, so only the service
--     role (server-side processing) ever writes or deletes there. A derivative is
--     public by design once it is uploaded: unpublishing removes the object and
--     stops the site linking it, but copies already downloaded cannot be recalled.

-- Buckets ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bbm-media-private', 'bbm-media-private', false,
  41943040, -- 40 MB, the same limit the app enforces before signing an upload
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/tiff']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bbm-media-public', 'bbm-media-public', true,
  10485760, -- 10 MB; a 2560 px JPEG derivative is well under this
  array['image/jpeg']
)
on conflict (id) do nothing;

-- Assets --------------------------------------------------------------------------------
create table if not exists public.photo_media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- draft: row created, original not yet confirmed. processing: derivatives being made.
  -- ready: usable, not public. published: on the site. archived: hidden, restorable. failed: see error (retry allowed).
  status text not null default 'draft' check (status in ('draft', 'processing', 'ready', 'published', 'archived', 'failed')),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- "<owner_id>/<sha256>.<ext>" in bbm-media-private; immutable, never a local path.
  original_key text not null check (original_key ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.[a-z0-9]{2,5}$'),
  original_bytes bigint not null check (original_bytes > 0),
  original_width integer check (original_width is null or original_width > 0),
  original_height integer check (original_height is null or original_height > 0),
  mime text not null,
  -- [{ key, width, height, bytes }] in bbm-media-public, ascending width; empty until processed.
  derivatives jsonb not null default '[]'::jsonb check (jsonb_typeof(derivatives) = 'array'),
  blur_data_url text,
  alt text not null default '',
  caption text,
  category text not null default 'brand_general' check (category in ('tournament_action', 'athlete_portrait', 'training_session', 'team_club', 'coaching_moment', 'victory_podium', 'behind_the_scenes', 'brand_general')),
  tags text[] not null default '{}'::text[],
  focal_x numeric(4, 3) not null default 0.5 check (focal_x >= 0 and focal_x <= 1),
  focal_y numeric(4, 3) not null default 0.5 check (focal_y >= 0 and focal_y <= 1),
  sort_order integer not null default 0,
  taken_on date,
  source text not null check (source in ('web_upload', 'cli_import', 'manifest')),
  -- Non-identifying origin: a short hash of the original file's basename, never a path. Owner-only, never public.
  source_label text check (source_label is null or source_label ~ '^[0-9a-f]{12}$'),
  -- The owner's own confirmations. Set only by the owner in the UI; no pipeline may set them.
  rights_confirmed boolean not null default false,
  guardian_ok boolean not null default false,
  -- Set by classification (possible minors, private session, third-party branding) and cleared only by the owner.
  needs_review boolean not null default false,
  review_note text,
  error text,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photo_media_assets_owner_sha_key unique (owner_id, content_sha256)
);
create index if not exists photo_media_assets_owner_status_idx on public.photo_media_assets (owner_id, status, sort_order, created_at desc);
create index if not exists photo_media_assets_owner_category_idx on public.photo_media_assets (owner_id, category);

-- Placements ----------------------------------------------------------------------------
-- hero (one), featured (ordered), work (ordered), service:<slot> (ordered per service).
create table if not exists public.photo_media_placements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  asset_id uuid not null references public.photo_media_assets (id) on delete cascade,
  placement text not null check (placement in ('hero', 'featured', 'work') or placement ~ '^service:[a-z_]{2,40}$'),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  constraint photo_media_placements_unique unique (owner_id, placement, asset_id)
);
create index if not exists photo_media_placements_owner_placement_idx on public.photo_media_placements (owner_id, placement, position);

-- A placement must point at an asset of the same owner (RLS on the asset side makes a
-- foreign id unreadable, but the check keeps the rule explicit for the service role too).
create or replace function public.photo_media_placement_owner_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.photo_media_assets a where a.id = new.asset_id and a.owner_id = new.owner_id) then
    raise exception 'placement asset does not belong to this owner' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.photo_media_placement_owner_check() from public, anon;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'photo_media_placements_owner_check') then
    create trigger photo_media_placements_owner_check before insert or update on public.photo_media_placements
      for each row execute function public.photo_media_placement_owner_check();
  end if;
end $$;

-- RLS: owner-role profile, own rows only ----------------------------------------------
alter table public.photo_media_assets enable row level security;
alter table public.photo_media_placements enable row level security;

drop policy if exists photo_media_assets_owner_all on public.photo_media_assets;
create policy photo_media_assets_owner_all on public.photo_media_assets
  for all
  using ((select auth.uid()) = owner_id and public.photo_is_owner_user())
  with check ((select auth.uid()) = owner_id and public.photo_is_owner_user());

drop policy if exists photo_media_placements_owner_all on public.photo_media_placements;
create policy photo_media_placements_owner_all on public.photo_media_placements
  for all
  using ((select auth.uid()) = owner_id and public.photo_is_owner_user())
  with check ((select auth.uid()) = owner_id and public.photo_is_owner_user());

-- Public reads go through the service role on the server with an explicit safe projection
-- (src/lib/media/public.ts); anon never touches these tables directly.
revoke all on table public.photo_media_assets from anon;
revoke all on table public.photo_media_placements from anon;
grant select, insert, update, delete on table public.photo_media_assets to authenticated, service_role;
grant select, insert, update, delete on table public.photo_media_placements to authenticated, service_role;

-- updated_at trigger (same helper as every other photo_ table) ---------------------------
do $$
declare t text;
begin
  foreach t in array array['photo_media_assets'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_set_updated_at') then
      execute format('create trigger %I before update on public.%I for each row execute function public.photo_set_updated_at()', t || '_set_updated_at', t);
    end if;
  end loop;
end $$;

-- Storage policies ------------------------------------------------------------------------
-- Private bucket: an owner-role user works only under "<uid>/...". This is the policy a
-- signed upload URL is minted against (createSignedUploadUrl needs INSERT on storage.objects).
drop policy if exists bbm_media_private_owner_insert on storage.objects;
create policy bbm_media_private_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'bbm-media-private'
    and public.photo_is_owner_user()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists bbm_media_private_owner_select on storage.objects;
create policy bbm_media_private_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'bbm-media-private'
    and public.photo_is_owner_user()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists bbm_media_private_owner_delete on storage.objects;
create policy bbm_media_private_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'bbm-media-private'
    and public.photo_is_owner_user()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Public bucket: read for everyone; deliberately NO insert/update/delete policy for anon or
-- authenticated. Only the service role (bypasses RLS) writes published derivatives.
drop policy if exists bbm_media_public_read on storage.objects;
create policy bbm_media_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'bbm-media-public');
