-- Pic-Time's own "pay the photographer directly" option arrives as
-- paymentMethod "photographer" (confirmed by the first real order the Zap
-- sent on 2026-10-04). Until now it was stored as "unknown", which hid the
-- order from the "needs payment confirmation" logic and the invoice draft.
alter table public.photo_orders drop constraint if exists photo_orders_payment_method_check;
alter table public.photo_orders add constraint photo_orders_payment_method_check
  check (payment_method in ('card', 'fawran', 'bank_transfer', 'cash', 'photographer', 'unknown'));

-- Backfill orders that already arrived with that method, from the redacted
-- raw payload kept on the row. Nothing about money changes: payment_state,
-- paid_at and the owner's confirmation are untouched.
update public.photo_orders
   set payment_method = 'photographer'
 where payment_method = 'unknown'
   and lower(coalesce(raw->>'paymentMethod', raw#>>'{payment,method}', '')) = 'photographer';

-- The order date came in the ASP.NET /Date(ms)/ form and was dropped; Zapier
-- also sends the parsed epoch milliseconds as placedAt_Date.
update public.photo_orders
   set placed_at = to_timestamp((raw->>'placedAt_Date')::bigint / 1000.0)
 where placed_at is null
   and raw->>'placedAt_Date' ~ '^[0-9]{12,13}$';
