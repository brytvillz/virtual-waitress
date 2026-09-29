-- ============================================================
-- Migration 023 — customer_ordering_gate
--
-- CONTEXT
-- restaurants.customer_ordering_enabled (boolean NOT NULL DEFAULT true)
-- was added in migration 018.  The anon_insert_orders RLS policy (also
-- 018) already blocks anonymous inserts when the column is false.
--
-- This migration adds a defense-in-depth BEFORE INSERT trigger so that
-- the check also fires when a service-role client bypasses RLS — e.g.,
-- an edge function or a direct psql connection.  The trigger is a no-op
-- for authenticated staff (waiters/managers/owners) so waiter-created
-- orders are never blocked by this gate.
-- ============================================================

BEGIN;

-- ── Part A: defense-in-depth trigger ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_customer_ordering_enabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  -- Authenticated users (waiters, managers, owners) are never blocked here.
  -- Their own RLS policies and the enforce_waiter_order_header trigger govern
  -- what they may do.
  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT customer_ordering_enabled
  INTO   v_enabled
  FROM   public.restaurants
  WHERE  id = NEW.restaurant_id;

  IF NOT COALESCE(v_enabled, true) THEN
    RAISE EXCEPTION
      'Customer ordering is currently disabled for this venue — please speak to your waiter to place an order';
  END IF;

  RETURN NEW;
END;
$$;

-- Run before the waiter-header trigger (alphabetical order — 'c' < 'w').
CREATE TRIGGER trg_customer_ordering_gate
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_ordering_enabled();

COMMIT;
