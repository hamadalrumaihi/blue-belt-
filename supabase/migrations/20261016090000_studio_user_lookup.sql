-- Collaborator lookups without enumerating auth users (SECURITY-REGISTER F-10).
--
-- Inviting a collaborator and listing an event's team used to page through
-- auth.admin.listUsers with the service role, which pulls every account
-- (portal clients included) into memory on each call. These two SECURITY
-- DEFINER functions answer the same questions for the signed-in studio user
-- with the user's own session: only owner/staff profiles are ever returned,
-- a client or anon caller gets insufficient_privilege, and e-mails are only
-- resolved for people who already share an event with the caller.
-- Additive and idempotent.

create or replace function public.photo_find_studio_user_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.photo_is_studio_user() then
    raise exception using errcode = 'insufficient_privilege', message = 'Studio users only.';
  end if;
  if p_email is null or btrim(p_email) = '' then
    return null;
  end if;
  select u.id into v_id
  from auth.users u
  join public.photo_profiles p on p.user_id = u.id
  where p.role in ('owner', 'staff')
    and lower(u.email) = lower(btrim(p_email))
  limit 1;
  return v_id;
end;
$$;
revoke all on function public.photo_find_studio_user_by_email(text) from public, anon;
grant execute on function public.photo_find_studio_user_by_email(text) to authenticated, service_role;

create or replace function public.photo_studio_user_emails(p_ids uuid[])
returns table (user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.photo_is_studio_user() then
    raise exception using errcode = 'insufficient_privilege', message = 'Studio users only.';
  end if;
  return query
    select u.id, u.email::text
    from auth.users u
    join public.photo_profiles p on p.user_id = u.id
    where u.id = any (coalesce(p_ids, '{}'::uuid[]))
      and p.role in ('owner', 'staff')
      and (
        u.id = auth.uid()
        or exists (
          select 1
          from public.photo_event_members m
          join public.photo_events e on e.id = m.event_id
          where m.user_id = u.id
            and (
              e.owner_id = auth.uid()
              or exists (select 1 from public.photo_event_members m2 where m2.event_id = e.id and m2.user_id = auth.uid())
            )
        )
      );
end;
$$;
revoke all on function public.photo_studio_user_emails(uuid[]) from public, anon;
grant execute on function public.photo_studio_user_emails(uuid[]) to authenticated, service_role;
