-- ============================================================
-- ROLLBACK for migration 018_waiter_mode_phase1.sql
--
-- *** DATA SAFETY WARNING ***
-- This rollback drops station, item_status, source, ordered_by,
-- client_order_id, business_day_start, timezone, station_type,
-- and the void_requests table — permanently destroying any data
-- in those columns. It is only safe to run BEFORE real orders
-- have been placed through the new waiter flow. Once Ichiban or
-- any venue has traded a night on migration 018, a forward fix
-- migration must be written instead. Do not run this file after
-- production data exists.
--
-- HOW TO USE
-- Run manually via Supabase Dashboard → SQL Editor, or:
--   psql $DATABASE_URL -f supabase/rollback/018_ROLLBACK.sql
-- Do NOT place this file in supabase/migrations/ — the migration
-- runner would apply it automatically and undo 018 on every push.
--
-- LIVE POLICY CAPTURE (verbatim from pg_policies, pre-push):
--
-- policyname              | cmd    | roles          | qual
-- anon_insert_orders      | INSERT | {anon}         | null
--   with_check: (restaurant_id IN ( SELECT restaurants.id FROM restaurants))
--
-- device_read_order_items | SELECT | {authenticated}| (order_id IN ( SELECT orders.id
--   FROM orders WHERE ((orders.restaurant_id = current_device_restaurant())
--   AND is_active_device() AND (orders.status = ANY
--   (ARRAY['pending'::text, 'preparing'::text, 'ready'::text])))))
--   with_check: null
--
-- Verify after rollback:
--   SELECT policyname, cmd FROM pg_policies
--   WHERE tablename IN ('orders','order_items')
--   AND policyname IN ('anon_insert_orders','device_read_order_items');
--   Expected: 2 rows.
-- ============================================================

BEGIN;


-- ── Step 1: Drop new triggers ──────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_waiter_order_header          ON public.orders;
DROP TRIGGER IF EXISTS trg_enforce_staff_order_update   ON public.orders;
DROP TRIGGER IF EXISTS trg_waiter_order_item_insert     ON public.order_items;
DROP TRIGGER IF EXISTS trg_recompute_order_total        ON public.order_items;
DROP TRIGGER IF EXISTS trg_order_item_immutable         ON public.order_items;
DROP TRIGGER IF EXISTS trg_void_request_insert          ON public.void_requests;
DROP TRIGGER IF EXISTS trg_void_request_update          ON public.void_requests;


-- ── Step 2: Restore enforce_device_order_update to migration 010 body ──────
--    Migration 018 replaced this function; restore the exact migration 010
--    version so station screens work correctly without the 018 additions.

CREATE OR REPLACE FUNCTION public.enforce_device_order_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_waiter_id uuid;
BEGIN
  IF NOT public.is_active_device() THEN
    RETURN NEW;
  END IF;

  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
  OR NEW.table_number  IS DISTINCT FROM OLD.table_number
  OR NEW.total         IS DISTINCT FROM OLD.total
  OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Station Screen may only update order status';
  END IF;

  IF NOT (
    (OLD.status = 'pending'   AND NEW.status = 'preparing') OR
    (OLD.status = 'preparing' AND NEW.status = 'ready')     OR
    (OLD.status = 'ready'     AND NEW.status = 'served')
  ) THEN
    RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status;
  END IF;

  SELECT sa.waiter_id INTO v_waiter_id
  FROM   public.shift_assignments sa
  JOIN   public.tables t ON t.id = sa.table_id
  WHERE  sa.restaurant_id = NEW.restaurant_id
    AND  sa.assigned_date  = current_date
    AND  t.table_number    = NEW.table_number
  LIMIT  1;

  CASE NEW.status
    WHEN 'preparing' THEN
      NEW.prepared_at := now();
      IF OLD.handled_by IS NULL THEN
        NEW.handled_by := v_waiter_id;
      END IF;
    WHEN 'ready' THEN
      NEW.ready_at := now();
    WHEN 'served' THEN
      NEW.served_at := now();
    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;


-- ── Step 3: Drop new RLS policies ─────────────────────────────────────────

DROP POLICY IF EXISTS "waiter_insert_orders"        ON public.orders;
DROP POLICY IF EXISTS "waiter_insert_order_items"   ON public.order_items;
DROP POLICY IF EXISTS "waiter_update_order_items"   ON public.order_items;
DROP POLICY IF EXISTS "device_update_order_items"   ON public.order_items;
DROP POLICY IF EXISTS "waiter_insert_void_requests" ON public.void_requests;
DROP POLICY IF EXISTS "staff_read_void_requests"    ON public.void_requests;
DROP POLICY IF EXISTS "owner_read_void_requests"    ON public.void_requests;
DROP POLICY IF EXISTS "owner_update_void_requests"  ON public.void_requests;


-- ── Step 4: Recreate the two dropped policies verbatim from live capture ───

DROP POLICY IF EXISTS "anon_insert_orders" ON public.orders;
CREATE POLICY "anon_insert_orders" ON public.orders
  FOR INSERT TO anon
  WITH CHECK (restaurant_id IN ( SELECT restaurants.id FROM restaurants));

DROP POLICY IF EXISTS "device_read_order_items" ON public.order_items;
CREATE POLICY "device_read_order_items" ON public.order_items
  FOR SELECT TO authenticated
  USING (order_id IN (
    SELECT orders.id
    FROM   orders
    WHERE  orders.restaurant_id = current_device_restaurant()
      AND  is_active_device()
      AND  orders.status = ANY (ARRAY['pending'::text, 'preparing'::text, 'ready'::text])
  ));


-- ── Step 5: Drop view and new functions ───────────────────────────────────

DROP VIEW     IF EXISTS public.order_items_for_device;

DROP FUNCTION IF EXISTS public.business_day_window(uuid, date);
DROP FUNCTION IF EXISTS public.current_device_station();
DROP FUNCTION IF EXISTS public.enforce_staff_order_update();
DROP FUNCTION IF EXISTS public.enforce_void_request_update();
DROP FUNCTION IF EXISTS public.enforce_void_request_insert();
DROP FUNCTION IF EXISTS public.recompute_order_total();
DROP FUNCTION IF EXISTS public.enforce_order_item_immutable();
DROP FUNCTION IF EXISTS public.enforce_waiter_order_item_insert();
DROP FUNCTION IF EXISTS public.enforce_waiter_order_header();


-- ── Step 6: Drop void_requests table ─────────────────────────────────────

DROP TABLE IF EXISTS public.void_requests;


-- ── Step 7: Drop added columns ────────────────────────────────────────────
--    client_order_id: unique index orders_client_idempotency drops with it.

ALTER TABLE public.restaurants
  DROP COLUMN IF EXISTS customer_ordering_enabled,
  DROP COLUMN IF EXISTS business_day_start,
  DROP COLUMN IF EXISTS timezone;

ALTER TABLE public.devices
  DROP COLUMN IF EXISTS station_type;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS ordered_by,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS client_order_id;

ALTER TABLE public.order_items
  DROP COLUMN IF EXISTS menu_item_id,
  DROP COLUMN IF EXISTS station,
  DROP COLUMN IF EXISTS item_status;

ALTER TABLE public.menu_items
  DROP COLUMN IF EXISTS station;


COMMIT;
