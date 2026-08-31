-- ============================================================
-- MIGRATION 012: Drop wildcard order policies
--
-- Two policies exist in the live DB that were created directly in
-- the Supabase dashboard (before migration history began) and are
-- not recorded in any migration file:
--
--   "Staff can view orders"   SELECT  USING (true)
--   "Staff can update orders" UPDATE  USING (true)
--
-- Both use USING (true) — every authenticated user can read or
-- update every order in the database, with no restaurant scoping.
-- This is what allowed revoked device sessions to read orders
-- despite all the correctly-scoped policies in migrations 005-011.
--
-- These policies are completely superseded by the scoped policies
-- already in place:
--
--   SELECT: owner_read_orders, staff_read_orders (with is_any_device guard),
--           device_read_orders
--   UPDATE: staff_update_orders (with is_any_device guard), device_update_orders
--
-- Dropping them closes the leak without removing any legitimate access.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "Staff can view orders"   ON orders;
DROP POLICY IF EXISTS "Staff can update orders" ON orders;

COMMIT;
