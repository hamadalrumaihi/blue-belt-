-- Browser approval jobs are leased independently of invoice creation.
alter table public.photo_orders
  add column if not exists approval_leased_until timestamptz,
  add column if not exists approval_next_attempt_at timestamptz,
  add column if not exists approval_last_error text;

create index if not exists photo_orders_pending_pictime_approval
  on public.photo_orders (approval_next_attempt_at, paid_at)
  where payment_state = 'paid' and provider = 'MYFATOORAH'
    and fulfilled_at is null and approved_in_pictime_at is null;
