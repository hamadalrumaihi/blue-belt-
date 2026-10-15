-- Isolation test for the media library (photo_media_assets, photo_media_placements
-- and the bbm-media-* storage policies): only an OWNER-role profile reads or writes
-- its own rows. A staff profile, a client profile and anon get nothing and cannot
-- insert, whatever owner_id they claim. The public bucket is readable by anyone but
-- writable by nobody except the service role; the private bucket is scoped to the
-- caller's own folder.
--
-- Paste the DO block into a psql session against a disposable database:
--   ERROR: ROLLBACK_OK: all media RLS assertions passed
-- (The exception at the end rolls everything back, including the test users.)
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-00000000bb01';
  v_staff uuid := '00000000-0000-4000-8000-00000000bb02';
  v_client uuid := '00000000-0000-4000-8000-00000000bb03';
  v_other uuid := '00000000-0000-4000-8000-00000000bb04';
  v_sha text := repeat('ab', 32);
  v_asset uuid;
  v_count int;
begin
  -- Seed as the superuser / service role (bypasses RLS) -----------------------
  insert into auth.users (id, email) values
    (v_owner, 'media-owner@example.test'),
    (v_staff, 'media-staff@example.test'),
    (v_client, 'media-client@example.test'),
    (v_other, 'media-other-owner@example.test');
  insert into public.photo_profiles (user_id, role) values (v_owner, 'owner'), (v_staff, 'staff'), (v_client, 'client'), (v_other, 'owner')
    on conflict (user_id) do update set role = excluded.role;

  if not exists (select 1 from storage.buckets where id = 'bbm-media-private' and public = false) then raise exception 'FAIL private bucket missing or public'; end if;
  if not exists (select 1 from storage.buckets where id = 'bbm-media-public' and public = true) then raise exception 'FAIL public bucket missing or private'; end if;

  -- Owner: insert + select + placement -----------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if not public.photo_is_owner_user() then raise exception 'FAIL photo_is_owner_user() is false for an owner profile'; end if;

  insert into public.photo_media_assets (content_sha256, original_key, original_bytes, mime, source)
    values (v_sha, v_owner::text || '/' || v_sha || '.jpg', 1234, 'image/jpeg', 'web_upload') returning id into v_asset;
  select count(*) into v_count from public.photo_media_assets where id = v_asset and owner_id = v_owner and status = 'draft';
  if v_count <> 1 then raise exception 'FAIL owner cannot read own asset (owner_id default = auth.uid())'; end if;

  update public.photo_media_assets set status = 'ready', alt = 'Test' where id = v_asset;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL owner cannot update own asset'; end if;

  insert into public.photo_media_placements (asset_id, placement, position) values (v_asset, 'featured', 0);
  select count(*) into v_count from public.photo_media_placements where asset_id = v_asset and owner_id = v_owner;
  if v_count <> 1 then raise exception 'FAIL owner cannot read own placement'; end if;

  -- Duplicate content for the same owner is refused by the unique key.
  begin
    insert into public.photo_media_assets (content_sha256, original_key, original_bytes, mime, source)
      values (v_sha, v_owner::text || '/' || v_sha || '.jpg', 1234, 'image/jpeg', 'cli_import');
    raise exception 'FAIL duplicate sha256 accepted for the same owner';
  exception when unique_violation then null;
  end;

  -- A key outside the owner's folder shape is refused.
  begin
    insert into public.photo_media_assets (content_sha256, original_key, original_bytes, mime, source)
      values (repeat('cd', 32), '../etc/passwd', 1, 'image/jpeg', 'web_upload');
    raise exception 'FAIL path-like original_key accepted';
  exception when check_violation then null;
  end;

  -- An owner cannot claim another owner's id on insert.
  begin
    insert into public.photo_media_assets (owner_id, content_sha256, original_key, original_bytes, mime, source)
      values (v_other, repeat('ef', 32), v_other::text || '/' || repeat('ef', 32) || '.jpg', 1, 'image/jpeg', 'web_upload');
    raise exception 'FAIL owner inserted an asset for another owner';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- Storage: the owner may insert under their own folder in the private bucket only.
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('bbm-media-private', v_owner::text || '/' || v_sha || '.jpg', v_owner, v_owner::text);
  select count(*) into v_count from storage.objects where bucket_id = 'bbm-media-private' and name like v_owner::text || '/%';
  if v_count <> 1 then raise exception 'FAIL owner cannot read own private object'; end if;
  update storage.objects set metadata = '{"mimetype":"image/jpeg"}'::jsonb where bucket_id = 'bbm-media-private' and name = v_owner::text || '/' || v_sha || '.jpg';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL owner cannot update (upsert) own private object'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id) values ('bbm-media-private', v_other::text || '/' || v_sha || '.jpg', v_owner, v_owner::text);
    raise exception 'FAIL owner inserted into another owner''s private folder';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id) values ('bbm-media-public', v_owner::text || '/' || v_sha || '/1280.jpg', v_owner, v_owner::text);
    raise exception 'FAIL an authenticated owner wrote to the public bucket (service role only)';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- Another owner sees none of these rows or objects.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.photo_media_assets where id = v_asset;
  if v_count <> 0 then raise exception 'FAIL another owner can read the asset'; end if;
  select count(*) into v_count from public.photo_media_placements where asset_id = v_asset;
  if v_count <> 0 then raise exception 'FAIL another owner can read the placement'; end if;
  select count(*) into v_count from storage.objects where bucket_id = 'bbm-media-private';
  if v_count <> 0 then raise exception 'FAIL another owner can list private objects'; end if;
  begin
    insert into public.photo_media_placements (owner_id, asset_id, placement) values (v_other, v_asset, 'hero');
    raise exception 'FAIL another owner placed a foreign asset';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- Staff: zero rows, failing insert, no update ---------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  if public.photo_is_owner_user() then raise exception 'FAIL photo_is_owner_user() is true for a staff profile'; end if;
  select count(*) into v_count from public.photo_media_assets;
  if v_count <> 0 then raise exception 'FAIL staff can read media assets'; end if;
  select count(*) into v_count from public.photo_media_placements;
  if v_count <> 0 then raise exception 'FAIL staff can read placements'; end if;
  update public.photo_media_assets set status = 'published' where id = v_asset;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL staff published an asset'; end if;
  begin
    insert into public.photo_media_assets (content_sha256, original_key, original_bytes, mime, source)
      values (repeat('12', 32), v_staff::text || '/' || repeat('12', 32) || '.jpg', 1, 'image/jpeg', 'web_upload');
    raise exception 'FAIL staff inserted an asset';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id) values ('bbm-media-private', v_staff::text || '/' || v_sha || '.jpg', v_staff, v_staff::text);
    raise exception 'FAIL staff uploaded to the private bucket';
  exception when insufficient_privilege or check_violation then null;
  end;
  select count(*) into v_count from storage.objects where bucket_id = 'bbm-media-private';
  if v_count <> 0 then raise exception 'FAIL staff can list private objects'; end if;

  -- Client: zero rows, failing insert ------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.photo_media_assets;
  if v_count <> 0 then raise exception 'FAIL client can read media assets'; end if;
  begin
    insert into public.photo_media_assets (content_sha256, original_key, original_bytes, mime, source)
      values (repeat('34', 32), v_client::text || '/' || repeat('34', 32) || '.jpg', 1, 'image/jpeg', 'web_upload');
    raise exception 'FAIL client inserted an asset';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id) values ('bbm-media-private', v_client::text || '/x.jpg', v_client, v_client::text);
    raise exception 'FAIL client uploaded to the private bucket';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- Anon: nothing on the tables, read-only on the public bucket ------------------------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  begin
    select count(*) into v_count from public.photo_media_assets;
    if v_count <> 0 then raise exception 'FAIL anon can read media assets'; end if;
  exception when insufficient_privilege then null; -- no grant at all is the intended state
  end;
  begin
    insert into public.photo_media_assets (content_sha256, original_key, original_bytes, mime, source)
      values (repeat('56', 32), v_owner::text || '/' || repeat('56', 32) || '.jpg', 1, 'image/jpeg', 'web_upload');
    raise exception 'FAIL anon inserted an asset';
  exception when insufficient_privilege or check_violation then null;
  end;
  select count(*) into v_count from storage.objects where bucket_id = 'bbm-media-private';
  if v_count <> 0 then raise exception 'FAIL anon can list private objects'; end if;
  -- Seed a published copy as the service role, then check that anon cannot enumerate it.
  perform set_config('role', 'service_role', true);
  insert into storage.objects (bucket_id, name) values ('bbm-media-public', v_owner::text || '/' || v_sha || '/1280.jpg');
  perform set_config('role', 'anon', true);
  select count(*) into v_count from storage.objects where bucket_id = 'bbm-media-public';
  if v_count <> 0 then raise exception 'FAIL anon can list the public bucket (unpublished keys would be enumerable)'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from storage.objects where bucket_id = 'bbm-media-public';
  if v_count <> 0 then raise exception 'FAIL an authenticated user can list the public bucket'; end if;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  begin
    insert into storage.objects (bucket_id, name) values ('bbm-media-public', 'anon/x.jpg');
    raise exception 'FAIL anon wrote to the public bucket';
  exception when insufficient_privilege or check_violation then null;
  end;

  raise exception 'ROLLBACK_OK: all media RLS assertions passed';
end $$;
