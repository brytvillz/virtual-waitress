-- 042_close_function_grants.sql
--
-- Revokes anon, authenticated, and PUBLIC execute access from functions that
-- have no business being called directly from a client connection.
--
-- Background: Supabase projects carry a project-level ALTER DEFAULT PRIVILEGES
-- that grants EXECUTE on all public schema functions to anon, authenticated,
-- and service_role. REVOKE ... FROM PUBLIC alone does not remove those
-- individual grants; each role must be revoked explicitly.
--
-- Two categories are closed here:
--
-- (A) claim_promo_uses — called only by the create-restaurant edge function
--     via the service role. No client path exists and none should.
--
-- (B) Trigger and event-trigger functions — called by the database engine
--     when a DML or DDL event fires. REVOKE EXECUTE does not affect trigger
--     invocation (the engine bypasses grantee checks), so these revokes do
--     not change trigger behaviour. They only close the direct-call path from
--     a client session, where the function would error immediately because
--     TG_OP, NEW, OLD and related trigger variables are not defined. "It
--     errors" is an implementation detail, not a security property; these
--     functions should not be callable by clients by design.
--
-- service_role retains EXECUTE on all functions below via the default
-- privilege and is not touched here.

-- ── (A) Promo uses counter ────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.claim_promo_uses(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_promo_uses(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_promo_uses(uuid) FROM authenticated;

-- ── (B) Trigger functions ─────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.enforce_cancellation_request_immutability() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_cancellation_request_immutability() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_cancellation_request_immutability() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_cancellation_request_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_cancellation_request_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_cancellation_request_insert() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_customer_ordering_enabled() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_customer_ordering_enabled() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_customer_ordering_enabled() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_device_call_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_device_call_update() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_device_call_update() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_device_heartbeat() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_device_heartbeat() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_device_heartbeat() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_device_order_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_device_order_update() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_device_order_update() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_order_item_immutable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_order_item_immutable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_order_item_immutable() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_payment_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_payment_update() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_payment_update() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_staff_order_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_staff_order_update() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_staff_order_update() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_tab_order_assignment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_tab_order_assignment() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_tab_order_assignment() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_void_request_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_void_request_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_void_request_insert() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_void_request_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_void_request_update() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_void_request_update() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_waiter_menu_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_waiter_menu_update() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_waiter_menu_update() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_waiter_order_header() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_waiter_order_header() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_waiter_order_header() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_waiter_order_item_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_waiter_order_item_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_waiter_order_item_insert() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.recompute_order_total() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_order_total() FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_order_total() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.record_order_history() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_order_history() FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_order_history() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.record_order_history_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_order_history_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_order_history_insert() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
