-- Order <-> invoice link (NEW-2, PR 5): the payments webhook/reconcile can now
-- resolve a MyFatoorah invoice to a Pic-Time order, not just a standalone
-- booking. The linking columns already exist on photo_orders (provider,
-- provider_invoice_id, payment_url, paid_at — from the baseline) and
-- photo_payment_events.order_id (also baseline). This migration only adds the
-- lookup index the webhook uses; it is purely additive and changes no
-- behaviour on its own. All invoice creation stays gated behind
-- PAYMENTS_MYFATOORAH_ENABLED (+ PAYMENTS_AUTO_INVOICE_ENABLED for the
-- automatic path), so nothing here runs until payments are activated.

create index if not exists photo_orders_provider_invoice_idx
  on public.photo_orders (provider, provider_invoice_id)
  where provider_invoice_id is not null;

comment on index public.photo_orders_provider_invoice_idx is
  'Resolve a MyFatoorah invoice back to its Pic-Time order in the payments webhook/reconcile path.';
