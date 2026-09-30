-- ============================================================
-- ROLLBACK for migration 026_waiter_place_order
--
-- Restores enforce_waiter_order_header and
-- enforce_waiter_order_item_insert to their pre-026 bodies,
-- and drops the waiter_place_order RPC.
--
-- WARNING: This does NOT undo handled_by values already stamped
-- on orders by the updated trigger. Those rows remain attributed
-- to their creating waiter — rolling back only affects future
-- inserts.
-- ============================================================

BEGIN;

-- ── Restore enforce_waiter_order_header (remove handled_by line) ──────────

CREATE OR REPLACE FUNCTION public.enforce_waiter_order_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  IF public.current_staff_role() = 'waiter' THEN
    IF NEW.client_order_id IS NULL THEN
      RAISE EXCEPTION 'Waiter orders require a client_order_id for idempotency — generate one client-side and retry';
    END IF;
    NEW.ordered_by  := auth.uid();
    NEW.source      := 'waiter';
    NEW.total       := 0;  -- recomputed by recompute_order_total as items arrive
    NEW.created_at  := now();
  END IF;
  RETURN NEW;
END;
$$;

-- ── Restore enforce_waiter_order_item_insert (reinstate NULL-station RAISE) ─

CREATE OR REPLACE FUNCTION public.enforce_waiter_order_item_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
DECLARE
  v_price   int;
  v_station text;
BEGIN
  IF NEW.menu_item_id IS NULL THEN
    RETURN NEW;  -- customer (legacy) order item — pass through unchanged
  END IF;

  SELECT price, station
  INTO   v_price, v_station
  FROM   public.menu_items
  WHERE  id = NEW.menu_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Menu item % does not exist', NEW.menu_item_id;
  END IF;

  IF v_station IS NULL THEN
    RAISE EXCEPTION
      'Menu item % has no station tag — assign bar or kitchen in the dashboard before ordering',
      NEW.menu_item_id;
  END IF;

  NEW.price   := v_price;
  NEW.station := v_station;

  RETURN NEW;
END;
$$;

-- ── Drop waiter_place_order RPC ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.waiter_place_order(uuid, int, jsonb);

COMMIT;
