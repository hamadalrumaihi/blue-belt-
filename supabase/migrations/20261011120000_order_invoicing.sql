-- Photo-order payment workflow: durable invoice jobs, private pay links,
-- e-mail delivery state, Telegram inline actions and runner heartbeats.
--
-- Additive and idempotent. Nothing here bills anyone: the columns describe
-- work the invoice runner does only while PAYMENTS_MYFATOORAH_ENABLED (and,
-- for the automatic path, PAYMENTS_AUTO_INVOICE_ENABLED plus the owner's
-- "Automatic" mode with its activation time) are on.

-- 1. Orders: the invoice job and the customer's private payment link ---------
alter table public.photo_orders
  -- sha256 of the bbo_… token in the customer's /pay/order/<token> link.
  add column if not exists pay_token_hash text,
  add column if not exists pay_token_created_at timestamptz,
  -- The durable queue: set when an invoice is wanted (automatically at intake,
  -- or by the owner from the dashboard / Telegram); cleared never, completed_at
  -- marks the job done (e-mail queued or an exception recorded).
  add column if not exists invoice_requested_at timestamptz,
  add column if not exists invoice_requested_by text,
  add column if not exists invoice_job_leased_until timestamptz,
  add column if not exists invoice_job_attempts integer not null default 0,
  add column if not exists invoice_next_attempt_at timestamptz,
  add column if not exists invoice_job_error text,
  add column if not exists invoice_completed_at timestamptz,
  -- Customer e-mail state for the payment link: none | queued | sent | failed | exception
  add column if not exists invoice_email_state text not null default 'none',
  add column if not exists invoice_email_updated_at timestamptz,
  add column if not exists invoice_email_count integer not null default 0,
  -- Why the order sits in the exception queue (no_email, invalid_email, unknown_method, provider_failed, email_disabled, payments_off).
  add column if not exists invoice_exception text;

alter table public.photo_orders drop constraint if exists photo_orders_invoice_email_state_check;
alter table public.photo_orders add constraint photo_orders_invoice_email_state_check
  check (invoice_email_state in ('none', 'queued', 'sent', 'failed', 'exception'));

create unique index if not exists photo_orders_pay_token_uidx
  on public.photo_orders (pay_token_hash) where pay_token_hash is not null;
create index if not exists photo_orders_invoice_queue_idx
  on public.photo_orders (invoice_requested_at)
  where invoice_requested_at is not null and invoice_completed_at is null;

comment on column public.photo_orders.invoice_requested_at is 'Queued invoice work for the order; processed by runOrderInvoiceJobs (/api/cron/payments and the intake kick).';
comment on column public.photo_orders.invoice_email_state is 'Customer payment-link e-mail: none, queued, sent, failed or exception.';

-- 2. Telegram: remember the sent message so a later card can edit it or drop
--    its buttons once the order is paid or cancelled.
alter table public.photo_notification_deliveries
  add column if not exists provider_message_id text;

-- 3. Telegram link: who is authorised to press financial buttons. In a private
--    chat the chat id is the user id; in a group only the user who linked the
--    chat may act, so the id is stored at /start.
alter table public.photo_telegram_links
  add column if not exists user_id bigint,
  add column if not exists chat_type text;

-- 4. Runner heartbeats: last run of each job, readable by the studio team so the
--    dashboard can say "the invoice runner last ran 3 minutes ago" without any
--    secret leaving the server. Written by the service role only.
create table if not exists public.photo_job_heartbeats (
  name text primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null default true,
  summary jsonb not null default '{}'::jsonb
);
alter table public.photo_job_heartbeats enable row level security;
drop policy if exists photo_job_heartbeats_studio_read on public.photo_job_heartbeats;
create policy photo_job_heartbeats_studio_read on public.photo_job_heartbeats
  for select using (public.photo_is_studio_user());
revoke all on public.photo_job_heartbeats from anon;
grant select on public.photo_job_heartbeats to authenticated;
grant all on public.photo_job_heartbeats to service_role;

-- 5. photo_record_order: the intake may queue the invoice job in the same
--    transaction as the order (automatic mode). Replays still enqueue nothing.
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
    id, owner_id, source, external_ref, pictime_order_id, customer_name, customer_email, customer_phone, gallery_name,
    amount_qr, currency, status, provider, payment_method, payment_state, payment_reference, payment_reported_state,
    items, placed_at, received_at, buyer_note, athlete_name_hint, raw, paid_at, metadata,
    invoice_requested_at, invoice_requested_by, invoice_exception,
    invoice_email_state, invoice_completed_at
  ) values (
    -- The caller may mint the id (the Telegram card's buttons name it); otherwise one is generated.
    coalesce(nullif(p_order->>'id', '')::uuid, gen_random_uuid()),
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
    coalesce(p_order->'metadata', '{}'::jsonb),
    nullif(p_order->>'invoice_requested_at', '')::timestamptz,
    nullif(p_order->>'invoice_requested_by', ''),
    nullif(p_order->>'invoice_exception', ''),
    case when nullif(p_order->>'invoice_exception', '') is not null then 'exception' else 'none' end,
    case when nullif(p_order->>'invoice_exception', '') is not null then now() else null end
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
