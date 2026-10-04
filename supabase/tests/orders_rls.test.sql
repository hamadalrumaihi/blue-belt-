-- Isolation test for photo_orders (Phase E): the owner reads their orders; an
-- event collaborator (photo_event_members) reads NONE — orders carry customer
-- and financial data and are owner-only. Also checks photo_record_order
-- dedupes by owner + source + external_ref and enqueues the outbox row once.
-- Paste the DO block into a psql session against a disposable database:
--   ERROR: ROLLBACK_OK: all orders RLS assertions passed
do $$
declare
  v_owner uuid;
  v_event uuid;
  v_collab uuid := '00000000-0000-4000-8000-0000000000dd';
  v_res jsonb;
  v_order uuid;
  v_count int;
begin
  select owner_id into v_owner from public.photo_events limit 1;
  if v_owner is null then raise exception 'seed an event owner before running'; end if;
  insert into public.photo_events (owner_id, name, platform, timezone) values (v_owner, 'TEST EVENT (rollback)', 'AJP', 'Asia/Qatar') returning id into v_event;
  insert into public.photo_event_members (event_id, user_id, role, invited_by) values (v_event, v_collab, 'photographer', v_owner);

  -- Record an order atomically with its outbox row; a replay returns the same id and enqueues nothing new.
  v_res := public.photo_record_order(v_owner, jsonb_build_object('source', 'pictime', 'external_ref', 'RLS-TEST-1', 'customer_name', 'Buyer', 'amount', 120, 'payment_method', 'fawran', 'payment_state', 'pending'),
                                     jsonb_build_object('alert_key', 'order:pictime:RLS-TEST-1', 'kind', 'ORDER_PLACED', 'payload', jsonb_build_object('text', 'x')));
  v_order := (v_res->>'order_id')::uuid;
  if (v_res->>'replayed') <> 'false' or v_order is null then raise exception 'FAIL record: %', v_res; end if;
  v_res := public.photo_record_order(v_owner, jsonb_build_object('source', 'pictime', 'external_ref', 'RLS-TEST-1', 'customer_name', 'Buyer', 'amount', 999), null);
  if (v_res->>'replayed') <> 'true' or (v_res->>'order_id')::uuid <> v_order then raise exception 'FAIL replay: %', v_res; end if;
  select count(*) into v_count from public.photo_notification_deliveries where owner_id = v_owner and alert_key = 'order:pictime:RLS-TEST-1';
  if v_count <> 1 then raise exception 'FAIL outbox rows = %', v_count; end if;
  select amount_qr::int into v_count from public.photo_orders where id = v_order;
  if v_count <> 120 then raise exception 'FAIL replay changed the amount'; end if;

  -- Owner sees the order.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.photo_orders where id = v_order;
  if v_count <> 1 then raise exception 'FAIL owner cannot read own order'; end if;

  -- Collaborator sees nothing, cannot update, cannot insert for the owner.
  perform set_config('request.jwt.claims', json_build_object('sub', v_collab, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.photo_orders where id = v_order;
  if v_count <> 0 then raise exception 'FAIL collaborator can read orders'; end if;
  update public.photo_orders set payment_state = 'paid' where id = v_order;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL collaborator updated an order'; end if;
  begin
    insert into public.photo_orders (owner_id, customer_name, amount_qr) values (v_owner, 'Spoof', 1);
    raise exception 'FAIL collaborator inserted an order for the owner';
  exception when insufficient_privilege or check_violation then null;
  end;

  raise exception 'ROLLBACK_OK: all orders RLS assertions passed';
end $$;
