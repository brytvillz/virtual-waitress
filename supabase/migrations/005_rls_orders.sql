-- ============================================================
-- MIGRATION 005: RLS for orders, order_items, waiter_calls
--               push_subscriptions scope fix
--               plan/plan_status column documentation
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── 1. Enable RLS on the three previously unprotected tables ──
ALTER TABLE orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiter_calls ENABLE ROW LEVEL SECURITY;

-- ── 2. orders ─────────────────────────────────────────────────

-- Anonymous customers can place orders at any valid restaurant.
-- restaurant_id must exist — prevents phantom restaurant spam.
CREATE POLICY "anon_insert_orders" ON orders
  FOR INSERT TO anon
  WITH CHECK (restaurant_id IN (SELECT id FROM restaurants));

-- Staff can view orders for their own restaurant only.
CREATE POLICY "staff_read_orders" ON orders
  FOR SELECT TO authenticated
  USING (restaurant_id = current_staff_restaurant());

-- Staff can update order status (pending → preparing → served/cancelled).
CREATE POLICY "staff_update_orders" ON orders
  FOR UPDATE TO authenticated
  USING  (restaurant_id = current_staff_restaurant())
  WITH CHECK (restaurant_id = current_staff_restaurant());

-- ── 3. order_items ────────────────────────────────────────────

-- Anonymous customers can add items to orders placed in the last hour.
-- The 1-hour window prevents retroactive manipulation of old orders
-- while being generous enough for any real ordering flow.
CREATE POLICY "anon_insert_order_items" ON order_items
  FOR INSERT TO anon
  WITH CHECK (
    order_id IN (
      SELECT id FROM orders
      WHERE created_at > now() - INTERVAL '1 hour'
    )
  );

-- Staff can view items for their restaurant's orders.
CREATE POLICY "staff_read_order_items" ON order_items
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT id FROM orders
      WHERE restaurant_id = current_staff_restaurant()
    )
  );

-- ── 4. waiter_calls ───────────────────────────────────────────

-- Anonymous customers can call waiters at any valid restaurant.
CREATE POLICY "anon_insert_waiter_calls" ON waiter_calls
  FOR INSERT TO anon
  WITH CHECK (restaurant_id IN (SELECT id FROM restaurants));

-- Staff can view calls for their restaurant.
CREATE POLICY "staff_read_waiter_calls" ON waiter_calls
  FOR SELECT TO authenticated
  USING (restaurant_id = current_staff_restaurant());

-- Staff can acknowledge calls (status: pending → acknowledged).
CREATE POLICY "staff_update_waiter_calls" ON waiter_calls
  FOR UPDATE TO authenticated
  USING  (restaurant_id = current_staff_restaurant())
  WITH CHECK (restaurant_id = current_staff_restaurant());

-- ── 5. push_subscriptions — fix overly permissive policy ──────
-- The original policy used (true) — any authenticated user could read
-- or delete any restaurant's push subscriptions across all tenants.
DROP POLICY IF EXISTS "Staff can manage their own subscriptions" ON push_subscriptions;

CREATE POLICY "staff_read_push_subs"   ON push_subscriptions
  FOR SELECT TO authenticated
  USING (restaurant_id = current_staff_restaurant());

CREATE POLICY "staff_insert_push_subs" ON push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = current_staff_restaurant());

CREATE POLICY "staff_delete_push_subs" ON push_subscriptions
  FOR DELETE TO authenticated
  USING (restaurant_id = current_staff_restaurant());

-- ── 6. Document plan columns ───────────────────────────────────
-- These columns were added manually to the live DB and referenced by
-- edge functions but never recorded in a migration. Documenting now
-- so the schema is reproducible. IF NOT EXISTS is safe to run again.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS plan        text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'growth', 'pro')),
  ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'inactive'
    CHECK (plan_status IN ('active', 'inactive'));
