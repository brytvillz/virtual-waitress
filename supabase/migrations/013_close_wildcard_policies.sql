-- ============================================================
-- MIGRATION 013: Close remaining wildcard and unscoped policies
--
-- This migration was written while the database has no live customers.
-- Every fix here gets more expensive the longer it waits.
--
-- GROUPS ADDRESSED
-- ────────────────────────────────────────────────────────────
-- A: Cross-tenant wildcards (USING true on authenticated)
--    order_items  "Staff can view order items"    — any trial account
--    waiter_calls "Staff can view waiter calls"   — reads/writes every
--    waiter_calls "Staff can update waiter calls" — restaurant's data
--
--    The order_items leak is worse than the orders leak we closed in 012:
--    it exposed every dish every restaurant sells, in what volume, to
--    anyone who registered a trial account. Every manager dashboard visit
--    was a free competitive intelligence report for rivals.
--
-- B: staff_read_assignments and staff_read_tables lack is_any_device()
--    guards. Because current_staff_restaurant() returns a non-null value
--    for device sessions (root cause to be fixed in the function bodies
--    below), any active device can today read full historical shift data
--    and all table records without the intended scope restriction.
--    Also adds device_read_tables (needed by the Station Screen in Step 5;
--    better to write it while thinking about RLS than during layout work).
--
-- C: Two permissive INSERT policies undermine the stricter anon_insert_*
--    policies beside them. RLS policies are OR'd — the looser one makes
--    the stricter one decorative:
--    - "Anyone can add items to an order" WITH CHECK (true): any public
--      session can attach items to any existing order regardless of age
--      or ownership. A customer could be billed for items they never ordered.
--    - "Anyone can call a waiter" only checks status = 'pending', no
--      restaurant_id scope: a denial-of-service vector aimed directly at
--      the Station Screen we are about to build.
--
-- D: Housekeeping — duplicate restaurant policy; wrong role on one.
--
-- ROOT CAUSE NOTE
-- current_staff_restaurant() and current_staff_role() return non-null
-- values for device sessions. The is_any_device() guards added in
-- migration 011 are belt-and-braces. The root cause fix belongs here
-- but requires the live function bodies, which are not recorded in
-- the migration history. Placeholders are marked PENDING below.
-- ============================================================

BEGIN;


-- ── GROUP A: Drop cross-tenant wildcard SELECT/UPDATE policies ────────────────

-- Replaced by staff_read_order_items (restaurant-scoped, is_any_device guarded)
-- and device_read_order_items (active-device scoped).
DROP POLICY IF EXISTS "Staff can view order items"   ON order_items;

-- Replaced by staff_read_waiter_calls (restaurant-scoped, is_any_device guarded)
-- and device_read_waiter_calls (active-device scoped, pending-only).
DROP POLICY IF EXISTS "Staff can view waiter calls"  ON waiter_calls;

-- Replaced by staff_update_waiter_calls (restaurant-scoped, is_any_device guarded)
-- and device_update_waiter_calls (active-device scoped).
DROP POLICY IF EXISTS "Staff can update waiter calls" ON waiter_calls;


-- ── GROUP B: Add is_any_device() guard to unguarded staff read policies ───────

-- shift_assignments: without this guard, active devices can read full
-- shift history for the restaurant. They should only see today (device_read_shift_assignments).
ALTER POLICY "staff_read_assignments" ON shift_assignments
  USING (
    restaurant_id = current_staff_restaurant()
    AND NOT public.is_any_device()
  );

-- tables: without this guard, active devices can read all table records via
-- the staff path. device_read_tables (below) provides the correct scoped path.
ALTER POLICY "staff_read_tables" ON tables
  USING (
    restaurant_id = current_staff_restaurant()
    AND NOT public.is_any_device()
  );

-- Device reads tables for its own restaurant only.
-- Needed by the Station Screen to render the table grid and resolve table
-- numbers to IDs. Written here while we are thinking about device RLS
-- rather than bolted on during layout work in Step 5.
CREATE POLICY "device_read_tables" ON tables
  FOR SELECT TO authenticated
  USING (
    restaurant_id = public.current_device_restaurant()
    AND public.is_active_device()
  );


-- ── GROUP C: Drop permissive INSERT policies that undermine scoped ones ────────

-- The anon_insert_order_items policy (1-hour window, order must exist) is the
-- intended gate. "Anyone can add items to an order" WITH CHECK (true) bypassed
-- it completely, allowing items to be attached to any order of any age.
DROP POLICY IF EXISTS "Anyone can add items to an order" ON order_items;

-- The anon_insert_waiter_calls policy scopes by restaurant_id IN (restaurants).
-- "Anyone can call a waiter" only checked status = 'pending', leaving
-- restaurant_id unscoped — a DoS vector for the Station Screen.
DROP POLICY IF EXISTS "Anyone can call a waiter" ON waiter_calls;


-- ── GROUP D: Housekeeping ─────────────────────────────────────────────────────

-- Duplicate — "Public can read restaurants" already covers this exactly.
DROP POLICY IF EXISTS "Public can view restaurants" ON restaurants;

-- This policy was on roles: {public} (anon + authenticated), meaning
-- unauthenticated sessions could call current_staff_restaurant() and attempt
-- an update. Functionally safe only because current_staff_restaurant() returns
-- NULL for anon sessions; safe-by-function-behaviour is not the same as
-- safe-by-design. Recreate on authenticated only.
DROP POLICY IF EXISTS "Managers can update their own restaurant" ON restaurants;

CREATE POLICY "manager_update_restaurant" ON restaurants
  FOR UPDATE TO authenticated
  USING  (id = current_staff_restaurant() AND current_staff_role() = 'manager')
  WITH CHECK (id = current_staff_restaurant() AND current_staff_role() = 'manager');


-- ── HARDEN current_staff_restaurant() and current_staff_role() ───────────────
--
-- Root cause update (confirmed from live function bodies + trigger audit):
--
--   There is no handle_new_user trigger. current_staff_restaurant() returns
--   NULL for device sessions because no staff row exists for the device UUID.
--   The device-reading-orders failure was caused entirely by the untracked
--   "Staff can view orders" USING (true) wildcard — closed by migration 012.
--   The is_any_device() guards in migrations 011-013 are belt-and-braces on
--   top of policies that already returned no rows for devices.
--
-- Two real problems remain in the original function bodies regardless:
--
-- 1. Missing SET search_path = public, auth.
--    SECURITY DEFINER functions without a pinned search_path are exploitable:
--    an attacker with CREATE SCHEMA access can shadow the 'staff' table and
--    redirect the function. Same class of vulnerability fixed in migration 010.
--
-- 2. No explicit device exclusion.
--    Safety currently comes from "no staff row for this device UUID".
--    That is safe-by-coincidence. One operator error (staff row created for a
--    device UUID) and every is_any_device() guard in the schema fails at once.
--    The exclusion inside the function makes the guard belt-and-braces
--    rather than the only line of defence.

CREATE OR REPLACE FUNCTION public.current_staff_restaurant()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT restaurant_id
  FROM   public.staff
  WHERE  id = auth.uid()
    AND  NOT EXISTS (
           SELECT 1 FROM public.devices WHERE auth_user_id = auth.uid()
         );
$$;

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role
  FROM   public.staff
  WHERE  id = auth.uid()
    AND  NOT EXISTS (
           SELECT 1 FROM public.devices WHERE auth_user_id = auth.uid()
         );
$$;

COMMIT;
