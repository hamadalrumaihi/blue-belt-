-- Phase E: Pic-Time order intake (feature-flagged) and owner Orders views.
-- Additive. Buyers are customers, kept apart from photo_athletes; nothing here
-- creates or links a tracked athlete. Owner-only RLS on photo_orders is
-- unchanged (photo_ensure_owner_policies in the baseline).

-- Intake credentials reuse the capture-credential table with a kind.
alter table public.photo_capture_credentials
  add column if not exists kind text not null default 'capture';
alter table public.photo_capture_credentials drop constraint if exists photo_capture_credentials_kind_check;
alter table public.photo_capture_credentials add constraint photo_capture_credentials_kind_check
  check (kind in ('capture', 'orders'));

alter table public.photo_orders
  add column if not exists source text not null default 'manual',
  add column if not exists external_ref text,
  add column if not exists payment_method text not null default 'unknown',
  add column if not exists payment_state text not null default 'unknown',
  add column if not exists payment_reference text,
  add column if not exists payment_reported_state text,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists placed_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists buyer_note text,
  add column if not exists athlete_name_hint text,
  add column if not exists raw jsonb not null default '{}'::jsonb,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by uuid,
  add column if not exists fulfilled_at timestamptz;
alter table public.photo_orders drop constraint if exists photo_orders_payment_method_check;
alter table public.photo_orders add constraint photo_orders_payment_method_check
  check (payment_method in ('card', 'fawran', 'bank_transfer', 'cash', 'unknown'));
alter table public.photo_orders drop constraint if exists photo_orders_payment_state_check;
alter table public.photo_orders add constraint photo_orders_payment_state_check
  check (payment_state in ('unknown', 'pending', 'paid', 'failed', 'refunded'));
-- One order per owner + source + external reference: a Zap retry is a replay.
create unique index if not exists photo_orders_owner_source_ref_uidx
  on public.photo_orders (owner_id, source, external_ref) where external_ref is not null;
create index if not exists photo_orders_owner_received_idx on public.photo_orders (owner_id, received_at desc nulls last, created_at desc);

-- Atomic order + notification outbox. SECURITY DEFINER so the service-role
-- intake route and (later) owner actions share one code path; the owner id is
-- an explicit argument that the route takes from the credential, never from
-- the body. Replays return the existing order and enqueue nothing.
create or replace function public.photo_record_order(
  p_owner_id uuid,
  p_order jsonb,
  p_delivery jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_existing uuid;
begin
  if p_owner_id is null then raise exception 'owner required' using errcode = '22023'; end if;
  select id into v_existing from public.photo_orders
   where owner_id = p_owner_id and source = coalesce(p_order->>'source', 'manual') and external_ref = p_order->>'external_ref';
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'replayed', true, 'order_id', v_existing);
  end if;

  insert into public.photo_orders (
    owner_id, source, external_ref, pictime_order_id, customer_name, customer_email, customer_phone, gallery_name,
    amount_qr, currency, status, provider, payment_method, payment_state, payment_reference, payment_reported_state,
    items, placed_at, received_at, buyer_note, athlete_name_hint, raw, paid_at, metadata
  ) values (
    p_owner_id,
    coalesce(p_order->>'source', 'manual'),
    p_order->>'external_ref',
    nullif(p_order->>'pictime_order_id', ''),
    p_order->>'customer_name',
    nullif(p_order->>'customer_email', ''),
    nullif(p_order->>'customer_phone', ''),
    nullif(p_order->>'gallery_name', ''),
    coalesce((p_order->>'amount')::numeric, 0),
    coalesce(nullif(p_order->>'currency', ''), 'QAR'),
    coalesce(nullif(p_order->>'status', ''), 'placed'),
    nullif(p_order->>'provider', ''),
    coalesce(nullif(p_order->>'payment_method', ''), 'unknown'),
    coalesce(nullif(p_order->>'payment_state', ''), 'unknown'),
    nullif(p_order->>'payment_reference', ''),
    nullif(p_order->>'payment_reported_state', ''),
    coalesce(p_order->'items', '[]'::jsonb),
    nullif(p_order->>'placed_at', '')::timestamptz,
    coalesce(nullif(p_order->>'received_at', '')::timestamptz, now()),
    nullif(p_order->>'buyer_note', ''),
    nullif(p_order->>'athlete_name_hint', ''),
    coalesce(p_order->'raw', '{}'::jsonb),
    case when p_order->>'payment_state' = 'paid' then coalesce(nullif(p_order->>'placed_at', '')::timestamptz, now()) else null end,
    coalesce(p_order->'metadata', '{}'::jsonb)
  )
  on conflict (owner_id, source, external_ref) where external_ref is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.photo_orders
     where owner_id = p_owner_id and source = coalesce(p_order->>'source', 'manual') and external_ref = p_order->>'external_ref';
    return jsonb_build_object('ok', true, 'replayed', true, 'order_id', v_id);
  end if;

  if p_delivery is not null then
    insert into public.photo_notification_deliveries (owner_id, channel, alert_key, kind, category, payload, status, attempts, next_attempt_at)
    values (p_owner_id, coalesce(p_delivery->>'channel', 'telegram'), coalesce(p_delivery->>'alert_key', 'order:' || v_id::text), coalesce(p_delivery->>'kind', 'ORDER_PLACED'), 'orders',
            coalesce(p_delivery->'payload', '{}'::jsonb), 'pending', 0, now())
    on conflict (owner_id, channel, alert_key) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'replayed', false, 'order_id', v_id);
end; $$;

revoke all on function public.photo_record_order(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.photo_record_order(uuid, jsonb, jsonb) to service_role;
