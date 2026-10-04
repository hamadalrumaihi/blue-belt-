-- Phase D: independent, lease-based notification delivery.
-- Additive. Deliveries are now CLAIMED atomically (FOR UPDATE SKIP LOCKED) by
-- whichever runner is draining the queue — the bounded /api/cron/deliveries
-- job ticked by the Railway process, or the small per-owner kick after a
-- user's refresh — so two runners never send the same row and a crashed
-- runner's rows become claimable again when their lease expires.
alter table public.photo_notification_deliveries
  add column if not exists leased_until timestamptz,
  add column if not exists lease_owner text,
  add column if not exists category text;

alter table public.photo_notification_deliveries drop constraint if exists photo_notification_deliveries_status_check;
alter table public.photo_notification_deliveries add constraint photo_notification_deliveries_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

create index if not exists photo_notification_deliveries_claim_idx
  on public.photo_notification_deliveries (channel, next_attempt_at)
  where status in ('pending', 'failed', 'sending');

-- Claims up to p_limit due rows for p_channel (optionally one owner), marking
-- them 'sending' with a lease and counting the attempt. Due means:
--   pending/failed with next_attempt_at <= now()  (null = terminal, not due)
--   sending with an expired lease                  (runner died mid-send)
-- and attempts < 3. SECURITY INVOKER: a user-session caller only sees its own
-- rows (RLS); the service-role runner sees every owner's.
create or replace function public.photo_claim_notification_deliveries(
  p_channel text,
  p_limit integer,
  p_lease_seconds integer,
  p_worker text,
  p_owner_id uuid default null
) returns setof public.photo_notification_deliveries
language plpgsql security invoker set search_path = public as $$
begin
  return query
  update public.photo_notification_deliveries d
     set status = 'sending',
         attempts = d.attempts + 1,
         leased_until = now() + make_interval(secs => greatest(5, least(coalesce(p_lease_seconds, 60), 600))),
         lease_owner = left(coalesce(p_worker, 'runner'), 80),
         updated_at = now()
   where d.id in (
     select x.id from public.photo_notification_deliveries x
      where x.channel = p_channel
        and (p_owner_id is null or x.owner_id = p_owner_id)
        and x.attempts < 3
        and (
          (x.status in ('pending', 'failed') and x.next_attempt_at is not null and x.next_attempt_at <= now())
          or (x.status = 'sending' and x.leased_until is not null and x.leased_until < now())
        )
      order by x.created_at
      limit greatest(1, least(coalesce(p_limit, 20), 100))
      for update skip locked
   )
  returning d.*;
end $$;

revoke all on function public.photo_claim_notification_deliveries(text, integer, integer, text, uuid) from public, anon;
grant execute on function public.photo_claim_notification_deliveries(text, integer, integer, text, uuid) to authenticated, service_role;
