-- ============================================================
-- MIGRATION 014: Fix anon order_items INSERT (broken by 013)
--
-- anon_insert_order_items has a WITH CHECK that subqueries orders:
--   order_id IN (SELECT id FROM orders WHERE created_at > now() - '1 hour')
--
-- Anon users have no SELECT policy on orders (correct — they must not
-- read other tables' orders). WITH CHECK subqueries run with the calling
-- user's privileges, so this subquery always returns empty for anon,
-- and every order_items INSERT fails with 401.
--
-- Before migration 013 this was masked by "Anyone can add items to an
-- order" WITH CHECK (true). Dropping that in 013 exposed the bug and
-- broke the customer order flow immediately.
--
-- Fix: is_recent_order() SECURITY DEFINER so the anon user does not
-- need SELECT on orders. The 1-hour window is preserved.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_recent_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE  id          = p_order_id
      AND  created_at  > now() - INTERVAL '1 hour'
  );
$$;

ALTER POLICY "anon_insert_order_items" ON order_items
  WITH CHECK (public.is_recent_order(order_id));

COMMIT;
