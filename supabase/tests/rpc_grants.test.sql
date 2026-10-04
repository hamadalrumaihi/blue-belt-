-- Verifies the EXECUTE lockdown from 20261004070000_rpc_execute_grants.sql.
-- Read-only: asserts role privileges and rolls back with ROLLBACK_OK on success.
-- Run against a disposable database (or the hosted project in a transaction).

do $$
declare
  v_fail text := '';
  procedure_oid oid;
begin
  -- Server-only RPCs: must NOT be callable by anon or authenticated.
  if has_function_privilege('anon', 'public.photo_record_order(uuid,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.photo_record_order(uuid,jsonb,jsonb)', 'EXECUTE') then
    v_fail := v_fail || 'photo_record_order reachable by anon/authenticated; ';
  end if;
  if has_function_privilege('anon', 'public.photo_apply_payment_transition(uuid,text,jsonb,jsonb,bigint,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.photo_apply_payment_transition(uuid,text,jsonb,jsonb,bigint,text,jsonb)', 'EXECUTE') then
    v_fail := v_fail || 'photo_apply_payment_transition reachable by anon/authenticated; ';
  end if;
  if has_function_privilege('anon', 'public.photo_claim_notification_deliveries(text,integer,integer,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.photo_claim_notification_deliveries(text,integer,integer,text,uuid)', 'EXECUTE') then
    v_fail := v_fail || 'photo_claim_notification_deliveries reachable by anon/authenticated; ';
  end if;

  -- Service role must still reach them.
  if not has_function_privilege('service_role', 'public.photo_record_order(uuid,jsonb,jsonb)', 'EXECUTE') then
    v_fail := v_fail || 'service_role lost photo_record_order; ';
  end if;

  -- User-facing self-guarding RPCs: anon out, authenticated kept.
  if has_function_privilege('anon', 'public.photo_apply_coverage_command(uuid,uuid,text,boolean,timestamptz,boolean)', 'EXECUTE') then
    v_fail := v_fail || 'photo_apply_coverage_command still reachable by anon; ';
  end if;
  if not has_function_privilege('authenticated', 'public.photo_apply_coverage_command(uuid,uuid,text,boolean,timestamptz,boolean)', 'EXECUTE') then
    v_fail := v_fail || 'photo_apply_coverage_command lost authenticated; ';
  end if;
  if has_function_privilege('anon', 'public.photo_set_coverage_done(uuid,text,boolean)', 'EXECUTE') then
    v_fail := v_fail || 'photo_set_coverage_done still reachable by anon; ';
  end if;

  -- The Import page path stays callable by signed-in users (SECURITY INVOKER + RLS).
  if not has_function_privilege('authenticated', 'public.photo_apply_refresh(uuid,integer,timestamptz,boolean,text,text,text,jsonb,jsonb,jsonb,jsonb,uuid[])', 'EXECUTE') then
    v_fail := v_fail || 'photo_apply_refresh lost authenticated (breaks Import); ';
  end if;

  if v_fail <> '' then
    raise exception 'RPC_GRANTS_FAIL: %', v_fail;
  end if;

  raise exception 'ROLLBACK_OK: rpc execute grants locked down';
end $$;
