-- ============================================================
-- MIGRATION 016: Add status = 'pending' to is_recent_order()
--
-- The function introduced in 014 only checked order age (< 1 hour).
-- Missing check: if the order has already been picked up by the kitchen
-- (status = 'preparing', 'ready', 'served', 'cancelled'), no new items
-- should be attachable to it. Without this, a customer — or anyone who
-- knows a live order UUID — can attach items to an in-flight order that
-- staff are already preparing, and the customer gets billed for food
-- they never ordered.
--
-- KNOWN GAP NOT FIXED HERE — restaurant scoping:
-- order_items has no restaurant_id column. Anon JWTs have no restaurant
-- claim. There is nothing in the RLS expression to compare the order's
-- restaurant_id against. Fixing this properly requires either:
--   (a) a restaurant_id column on order_items (schema change + FK), or
--   (b) a restaurant claim in the customer session JWT (auth model change).
-- The 128-bit random UUID makes order ID guessing practically impossible,
-- but the gap is real by design. It is recorded here so it is not lost.
-- Address in a future migration before the product has live traffic.
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
      AND  status      = 'pending'
  );
$$;

COMMIT;
