-- ============================================================
-- MIGRATION 011: Exclude device sessions from staff-based policies
--
-- Root cause: current_staff_restaurant() is defined outside the
-- migration history and unexpectedly returns a non-NULL restaurant_id
-- for device users, allowing revoked (and potentially active) devices
-- to match staff_read_orders, staff_update_orders, and all other
-- policies that use current_staff_restaurant().
--
-- is_active_device() and current_device_restaurant() both return
-- correct values (false / NULL for revoked devices). The device_*
-- policies in migration 010 are correct. The gap is in the older
-- staff_* policies that pre-date device sessions.
--
-- Fix: a new SECURITY DEFINER helper is_any_device() that returns true
-- for ANY device session (active or revoked) by checking only the
-- existence of a devices row — ignoring revoked_at. This helper is
-- added as AND NOT is_any_device() to every policy that calls
-- current_staff_restaurant(). Devices then access orders/calls/items
-- only through the explicitly-scoped device_* policies in migration 010.
-- ============================================================

BEGIN;

-- ── 1. is_any_device() ────────────────────────────────────────────────────────
-- Returns true for ANY session that has a devices row, active or revoked.
-- Used to explicitly exclude device sessions from staff-based policies.
-- is_active_device() (migration 010) already gates the device_* policies;
-- this function gates the staff_* policies from the other side.

CREATE OR REPLACE FUNCTION public.is_any_device()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.devices
    WHERE  auth_user_id = auth.uid()
  );
$$;


-- ── 2. Patch policies that use current_staff_restaurant() ─────────────────────
--
-- All six staff_* policies from migration 005 and the four manager_*
-- policies from migration 010 are patched here.
--
-- The device_* policies already require is_active_device() = true OR
-- check current_device_restaurant() which returns NULL for non-devices,
-- so non-device sessions are unaffected by this change.

-- orders
ALTER POLICY "staff_read_orders" ON orders
  USING (
    restaurant_id = current_staff_restaurant()
    AND NOT public.is_any_device()
  );

ALTER POLICY "staff_update_orders" ON orders
  USING  (restaurant_id = current_staff_restaurant() AND NOT public.is_any_device())
  WITH CHECK (restaurant_id = current_staff_restaurant() AND NOT public.is_any_device());

-- order_items
ALTER POLICY "staff_read_order_items" ON order_items
  USING (
    order_id IN (
      SELECT id FROM orders
      WHERE restaurant_id = current_staff_restaurant()
    )
    AND NOT public.is_any_device()
  );

-- waiter_calls
ALTER POLICY "staff_read_waiter_calls" ON waiter_calls
  USING (
    restaurant_id = current_staff_restaurant()
    AND NOT public.is_any_device()
  );

ALTER POLICY "staff_update_waiter_calls" ON waiter_calls
  USING  (restaurant_id = current_staff_restaurant() AND NOT public.is_any_device())
  WITH CHECK (restaurant_id = current_staff_restaurant() AND NOT public.is_any_device());

-- push_subscriptions (devices have no business reading or writing these)
ALTER POLICY "staff_read_push_subs" ON push_subscriptions
  USING (
    restaurant_id = current_staff_restaurant()
    AND NOT public.is_any_device()
  );

ALTER POLICY "staff_insert_push_subs" ON push_subscriptions
  WITH CHECK (
    restaurant_id = current_staff_restaurant()
    AND NOT public.is_any_device()
  );

ALTER POLICY "staff_delete_push_subs" ON push_subscriptions
  USING (
    restaurant_id = current_staff_restaurant()
    AND NOT public.is_any_device()
  );

-- manager_* policies on devices and device_pairing_codes (migration 010)
-- These already require current_staff_role() = 'manager', which should
-- return NULL for device users — but add the guard for defence in depth.
ALTER POLICY "manager_read_devices" ON devices
  USING (
    restaurant_id = current_staff_restaurant()
    AND current_staff_role() = 'manager'
    AND NOT public.is_any_device()
  );

ALTER POLICY "manager_update_devices" ON devices
  USING  (restaurant_id = current_staff_restaurant() AND current_staff_role() = 'manager' AND NOT public.is_any_device())
  WITH CHECK (restaurant_id = current_staff_restaurant() AND current_staff_role() = 'manager' AND NOT public.is_any_device());

ALTER POLICY "manager_insert_pairing_codes" ON device_pairing_codes
  WITH CHECK (
    restaurant_id = current_staff_restaurant()
    AND current_staff_role() = 'manager'
    AND NOT public.is_any_device()
  );

ALTER POLICY "manager_read_pairing_codes" ON device_pairing_codes
  USING (
    restaurant_id = current_staff_restaurant()
    AND current_staff_role() = 'manager'
    AND NOT public.is_any_device()
  );

COMMIT;
