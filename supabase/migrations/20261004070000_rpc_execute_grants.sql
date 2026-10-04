-- Tighten EXECUTE on the intake/worker RPCs so no client can bypass the
-- credential or session checks by calling them directly over PostgREST
-- (/rest/v1/rpc/...). Surfaced by the Supabase database linter
-- (0028/0029 security_definer_function_executable) and by reasoning about
-- which role each function is actually meant for.
--
-- Three groups:
--   1. Server-only RPCs, called exclusively by the service-role client
--      (orders intake, the MyFatoorah webhook/cron, the delivery runner).
--      These take the owner / booking as a parameter and do NOT re-derive it
--      from auth.uid(), so a signed-in user calling them directly could act
--      for another owner. Restrict to service_role.
--   2. User-facing RPCs that run as the signed-in user and self-guard on
--      auth.uid() (coverage completion, collaborator board/membership).
--      Keep `authenticated`; drop `anon` — an anonymous caller has a NULL
--      auth.uid() and must never reach them.
--   3. photo_apply_refresh is SECURITY INVOKER (RLS applies) and is called by
--      the signed-in Import page with the user's own session, so it keeps
--      `authenticated` and is intentionally left unchanged here.
--
-- Also pin search_path on three helper/trigger functions flagged by lint
-- 0011 (function_search_path_mutable). Additive and reversible.

-- 1. Server-only: service_role only.
revoke execute on function public.photo_record_order(uuid, jsonb, jsonb) from anon, authenticated;
revoke execute on function public.photo_apply_payment_transition(uuid, text, jsonb, jsonb, bigint, text, jsonb) from anon, authenticated;
revoke execute on function public.photo_claim_notification_deliveries(text, integer, integer, text, uuid) from anon, authenticated;

-- 2. User-facing self-guarding RPCs: keep authenticated, drop anon.
revoke execute on function public.photo_apply_coverage_command(uuid, uuid, text, boolean, timestamptz, boolean) from anon;
revoke execute on function public.photo_set_coverage_done(uuid, text, boolean) from anon;
revoke execute on function public.photo_collaborator_board(uuid) from anon;
revoke execute on function public.photo_collaborator_events() from anon;
revoke execute on function public.photo_is_event_member(uuid) from anon;

-- 3. Pin search_path on the flagged helper/trigger functions.
alter function public.photo_set_updated_at() set search_path = public;
alter function public.photo_ensure_owner_policies(text) set search_path = public;
alter function public.photo_coverage_touch() set search_path = public;
