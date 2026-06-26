-- ============================================================
-- MIGRATION 001: Multi-location support
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Add owner_id to restaurants
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Backfill: each restaurant's owner is the manager in the staff table
UPDATE restaurants r
SET owner_id = s.id
FROM staff s
WHERE s.restaurant_id = r.id
  AND s.role = 'manager'
  AND r.owner_id IS NULL;

-- 3. Index for fast owner-based lookups
CREATE INDEX IF NOT EXISTS idx_restaurants_owner_id ON restaurants(owner_id);

-- ============================================================
-- RLS POLICIES — owners can access any restaurant they own
-- without needing a staff record in that restaurant.
-- Run each CREATE POLICY separately if any already exist.
-- ============================================================

-- restaurants: owners can read all their restaurants
CREATE POLICY "owner_read_restaurants" ON restaurants
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

-- restaurants: owners can update their own restaurants
CREATE POLICY "owner_update_restaurants" ON restaurants
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- menu_items
CREATE POLICY "owner_manage_menu_items" ON menu_items
  FOR ALL TO authenticated
  USING (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()))
  WITH CHECK (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()));

-- menu_categories
CREATE POLICY "owner_manage_menu_categories" ON menu_categories
  FOR ALL TO authenticated
  USING (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()))
  WITH CHECK (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()));

-- tables
CREATE POLICY "owner_manage_tables" ON tables
  FOR ALL TO authenticated
  USING (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()))
  WITH CHECK (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()));

-- staff
CREATE POLICY "owner_manage_staff" ON staff
  FOR ALL TO authenticated
  USING (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()))
  WITH CHECK (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()));

-- orders (read only for owners — write is customer-facing anon)
CREATE POLICY "owner_read_orders" ON orders
  FOR SELECT TO authenticated
  USING (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()));

-- order_items
CREATE POLICY "owner_read_order_items" ON order_items
  FOR SELECT TO authenticated
  USING (order_id IN (
    SELECT id FROM orders
    WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid())
  ));

-- shift_assignments
CREATE POLICY "owner_manage_shift_assignments" ON shift_assignments
  FOR ALL TO authenticated
  USING (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()))
  WITH CHECK (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()));

-- waiter_calls
CREATE POLICY "owner_read_waiter_calls" ON waiter_calls
  FOR SELECT TO authenticated
  USING (restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid()));
