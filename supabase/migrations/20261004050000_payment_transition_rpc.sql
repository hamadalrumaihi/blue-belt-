-- Phase F: atomic payment state + attempt row + owner notification outbox.
-- Additive. Production payment operations stay OFF (feature flags); this only
-- gives the webhook / reconciliation code one transaction to apply a booking
-- transition, write the payment attempt, mark the delivery row and enqueue
-- the owner's [Orders] confirmation, instead of four separate statements.
-- Guarded by the expected previous status: a concurrent writer wins and the
-- caller is told (applied=false, reason=concurrent_update).
create or replace function public.photo_apply_payment_transition(
  p_booking_id uuid,
  p_expected_status text,
  p_columns jsonb,
  p_attempt jsonb default null,
  p_event_row_id bigint default null,
  p_processing_result text default null,
  p_delivery jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_booking public.photo_bookings;
  v_updated integer;
begin
  select * into v_booking from public.photo_bookings where id = p_booking_id for update;
  if not found then return jsonb_build_object('applied', false, 'reason', 'booking_not_found'); end if;
  if v_booking.status <> p_expected_status then return jsonb_build_object('applied', false, 'reason', 'concurrent_update', 'status', v_booking.status); end if;

  update public.photo_bookings set
    status = coalesce(p_columns->>'status', status),
    payment_status_updated_at = coalesce(nullif(p_columns->>'payment_status_updated_at', '')::timestamptz, now()),
    paid_at = case when p_columns ? 'paid_at' then nullif(p_columns->>'paid_at', '')::timestamptz else paid_at end,
    refunded_at = case when p_columns ? 'refunded_at' then nullif(p_columns->>'refunded_at', '')::timestamptz else refunded_at end,
    disputed_at = case when p_columns ? 'disputed_at' then nullif(p_columns->>'disputed_at', '')::timestamptz else disputed_at end,
    metadata = case when p_columns ? 'metadata' then coalesce(p_columns->'metadata', metadata) else metadata end
  where id = p_booking_id;
  get diagnostics v_updated = row_count;

  if p_attempt is not null then
    insert into public.photo_payment_attempts (owner_id, booking_id, provider, provider_invoice_id, provider_payment_id, status, amount, currency, raw)
    values (v_booking.owner_id, p_booking_id, coalesce(p_attempt->>'provider', 'MYFATOORAH'), p_attempt->>'provider_invoice_id', p_attempt->>'provider_payment_id',
            coalesce(p_attempt->>'status', p_columns->>'status'), coalesce((p_attempt->>'amount')::numeric, v_booking.amount_qr), coalesce(p_attempt->>'currency', v_booking.currency), coalesce(p_attempt->'raw', '{}'::jsonb))
    on conflict (provider, provider_payment_id) where provider_payment_id is not null do nothing;
  end if;

  if p_event_row_id is not null then
    update public.photo_payment_events set processing_result = p_processing_result, processed_at = now(), booking_id = p_booking_id, owner_id = v_booking.owner_id
    where id = p_event_row_id;
  end if;

  if p_delivery is not null then
    insert into public.photo_notification_deliveries (owner_id, channel, alert_key, kind, category, payload, status, attempts, next_attempt_at)
    values (v_booking.owner_id, coalesce(p_delivery->>'channel', 'telegram'), p_delivery->>'alert_key', coalesce(p_delivery->>'kind', 'PAYMENT_CONFIRMED'), 'orders', coalesce(p_delivery->'payload', '{}'::jsonb), 'pending', 0, now())
    on conflict (owner_id, channel, alert_key) do nothing;
  end if;

  return jsonb_build_object('applied', v_updated = 1, 'status', coalesce(p_columns->>'status', v_booking.status), 'owner_id', v_booking.owner_id);
end; $$;

revoke all on function public.photo_apply_payment_transition(uuid, text, jsonb, jsonb, bigint, text, jsonb) from public, anon;
grant execute on function public.photo_apply_payment_transition(uuid, text, jsonb, jsonb, bigint, text, jsonb) to service_role;
