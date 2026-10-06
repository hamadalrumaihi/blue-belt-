-- Order invoicing hardening (review fixes for the order <-> invoice lifecycle).
--
-- 1. invoice_claimed_at: a short-lived claim taken (conditionally) before the
--    MyFatoorah SendPayment call, so two callers (overlapping cron runs, a
--    double click, cron + owner) can never create two invoices for one order.
--    A stale claim (crash between the provider call and the write-back) is
--    recovered by asking MyFatoorah for the invoice by CustomerReference (the
--    order id) and re-linking it, never by blindly creating a second one.
-- 2. The invoice-id lookup index becomes UNIQUE, matching
--    photo_bookings_provider_invoice_uidx: one MyFatoorah invoice resolves to
--    exactly one order, so the webhook's single-row lookup can never be
--    confused by a duplicate (accidental or written by an owner via the API).
-- Additive apart from replacing the index created in 20261005090000; nothing
-- here runs until payments are enabled.

alter table public.photo_orders add column if not exists invoice_claimed_at timestamptz;

create unique index if not exists photo_orders_provider_invoice_uidx
  on public.photo_orders (provider, provider_invoice_id)
  where provider_invoice_id is not null;

drop index if exists public.photo_orders_provider_invoice_idx;

comment on column public.photo_orders.invoice_claimed_at is
  'Set while one caller creates this order''s MyFatoorah invoice; cleared when the invoice is recorded or the attempt fails.';
