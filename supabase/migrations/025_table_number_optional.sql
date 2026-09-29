-- ============================================================
-- Migration 025 — optional table number
--
-- Makes table_number nullable on orders and waiter_calls so venues
-- that do not use numbered tables (e.g. open-floor bars) can take
-- and manage orders. Adds uses_table_numbers to restaurants so the
-- admin can mark a venue as tableless. Denormalises tab_number onto
-- orders so realtime payloads carry it without extra joins.
--
-- Part A — orders.table_number DROP NOT NULL
--
-- Part B — waiter_calls.table_number DROP NOT NULL
--
-- Part C — restaurants.uses_table_numbers boolean DEFAULT true
--   New venue setting. When false: no table assignment in any waiter
--   UI; QR table codes are not applicable; display helper falls
--   through to the "Quick order" path.
--
-- Part D — orders.tab_number int NULL (denormalised)
--   Copied from tabs.tab_number at INSERT time by
--   enforce_tab_order_assignment. Cannot go stale — tab_id is
--   immutable on the order once set, and tab_number is immutable on
--   the tab. Allows realtime payloads and push notifications to
--   display "Tab 3" without a JOIN.
--
-- Part E — enforce_tab_order_assignment replacement (from 024)
--   Adds: NEW.tab_number := v_tab.tab_number before RETURN NEW.
--
-- Part F — enforce_device_order_update replacement (from 024)
--   Adds tab_number to both immutable-column guard lists so station
--   screens cannot change either tab column independently.
--
-- Part G — enforce_staff_order_update replacement (from 024)
--   Recompute guard: tab_number added unconditionally (same as tab_id).
--   Normal guard: tab_id and tab_number grouped under the same
--   vw.moving_order_tab bypass so only move_order_to_tab() may
--   change either.
--
-- Part H — move_order_to_tab replacement (from 024)
--   Fetches tab_number from the target tab in the lock SELECT.
--   Updates both tab_id and tab_number in the single UPDATE so the
--   denormalised column stays consistent with the FK.
--
-- Purely additive except the two NOT NULL drops. No data is changed.
-- Existing orders and calls keep their table_number values. The three
-- SECURITY DEFINER functions are replaced in place (CREATE OR REPLACE).
-- ============================================================


BEGIN;


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — orders.table_number: allow NULL
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ALTER COLUMN table_number DROP NOT NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — waiter_calls.table_number: allow NULL
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.waiter_calls
  ALTER COLUMN table_number DROP NOT NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — restaurants.uses_table_numbers venue setting
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS uses_table_numbers boolean NOT NULL DEFAULT true;


-- ════════════════════════════════════════════════════════════════════════════
-- PART D — orders.tab_number (denormalised from tabs)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Stamped by enforce_tab_order_assignment at INSERT time.
-- Guarded by both enforce_device_order_update and
-- enforce_staff_order_update so it can never be changed directly.
-- The only function that may change it is move_order_to_tab(), which
-- updates tab_id and tab_number together in one UPDATE.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tab_number int NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- PART E — enforce_tab_order_assignment replacement (from migration 024)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Identical to the migration 024 body with one addition:
--   After validating the tab, stamp NEW.tab_number from the tab row
--   so the denormalised column is filled on every INSERT that carries
--   a tab_id.

CREATE OR REPLACE FUNCTION public.enforce_tab_order_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tab_status     text;
  v_tab_restaurant uuid;
  v_tab_number     int;
BEGIN
  IF NEW.tab_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status, restaurant_id, tab_number
  INTO   v_tab_status, v_tab_restaurant, v_tab_number
  FROM   public.tabs
  WHERE  id = NEW.tab_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tab % does not exist', NEW.tab_id;
  END IF;

  IF v_tab_restaurant <> NEW.restaurant_id THEN
    RAISE EXCEPTION 'Tab does not belong to restaurant %', NEW.restaurant_id;
  END IF;

  IF v_tab_status = 'closed' THEN
    RAISE EXCEPTION 'Cannot add an order to a closed tab';
  END IF;

  -- Stamp the denormalised tab number so realtime payloads carry it.
  NEW.tab_number := v_tab_number;

  RETURN NEW;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- PART F — enforce_device_order_update replacement (from migration 024)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Identical to the migration 024 body with one addition:
--   tab_number added to both guard lists. Station screens must never
--   change either tab column.

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

  IF current_setting('vw.recomputing_total', true) = 'true' THEN
    IF NEW.ordered_by      IS DISTINCT FROM OLD.ordered_by
    OR NEW.source          IS DISTINCT FROM OLD.source
    OR NEW.client_order_id IS DISTINCT FROM OLD.client_order_id
    OR NEW.status          IS DISTINCT FROM OLD.status
    OR NEW.table_number    IS DISTINCT FROM OLD.table_number
    OR NEW.party_label     IS DISTINCT FROM OLD.party_label
    OR NEW.tab_id          IS DISTINCT FROM OLD.tab_id
    OR NEW.tab_number      IS DISTINCT FROM OLD.tab_number
    THEN
      RAISE EXCEPTION 'Station Screen may only update order status';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.restaurant_id   IS DISTINCT FROM OLD.restaurant_id
  OR NEW.table_number    IS DISTINCT FROM OLD.table_number
  OR NEW.total           IS DISTINCT FROM OLD.total
  OR NEW.created_at      IS DISTINCT FROM OLD.created_at
  OR NEW.ordered_by      IS DISTINCT FROM OLD.ordered_by
  OR NEW.source          IS DISTINCT FROM OLD.source
  OR NEW.client_order_id IS DISTINCT FROM OLD.client_order_id
  OR NEW.party_label     IS DISTINCT FROM OLD.party_label
  OR NEW.tab_id          IS DISTINCT FROM OLD.tab_id
  OR NEW.tab_number      IS DISTINCT FROM OLD.tab_number
  THEN
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


-- ════════════════════════════════════════════════════════════════════════════
-- PART G — enforce_staff_order_update replacement (from migration 024)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Identical to the migration 024 body with these additions:
--   (recompute path) tab_number added unconditionally — no recompute
--     may change either tab column.
--   (normal path) tab_number grouped with tab_id under the same
--     vw.moving_order_tab bypass. move_order_to_tab() sets the flag
--     and then updates both columns together; no other path may change
--     either.

CREATE OR REPLACE FUNCTION public.enforce_staff_order_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  IF public.is_any_device() THEN
    RETURN NEW;
  END IF;

  IF current_setting('vw.cancelling_order', true) IS DISTINCT FROM 'true'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'cancelled'
  THEN
    RAISE EXCEPTION
      'Orders cannot be cancelled by a direct UPDATE — use cancel_order() '
      'or approve_cancellation_request() so the reason is recorded';
  END IF;

  IF public.current_staff_role() IN ('waiter', 'manager') THEN

    IF current_setting('vw.recomputing_total', true) = 'true' THEN
      IF NEW.ordered_by      IS DISTINCT FROM OLD.ordered_by
      OR NEW.source          IS DISTINCT FROM OLD.source
      OR NEW.client_order_id IS DISTINCT FROM OLD.client_order_id
      OR NEW.status          IS DISTINCT FROM OLD.status
      OR NEW.restaurant_id   IS DISTINCT FROM OLD.restaurant_id
      OR NEW.table_number    IS DISTINCT FROM OLD.table_number
      OR NEW.created_at      IS DISTINCT FROM OLD.created_at
      OR NEW.party_label     IS DISTINCT FROM OLD.party_label
      OR NEW.tab_id          IS DISTINCT FROM OLD.tab_id
      OR NEW.tab_number      IS DISTINCT FROM OLD.tab_number
      THEN
        RAISE EXCEPTION 'Only orders.total may change during a system recompute';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.total           IS DISTINCT FROM OLD.total
    OR NEW.ordered_by      IS DISTINCT FROM OLD.ordered_by
    OR NEW.source          IS DISTINCT FROM OLD.source
    OR NEW.client_order_id IS DISTINCT FROM OLD.client_order_id
    OR NEW.restaurant_id   IS DISTINCT FROM OLD.restaurant_id
    OR NEW.table_number    IS DISTINCT FROM OLD.table_number
    OR NEW.created_at      IS DISTINCT FROM OLD.created_at
    OR NEW.party_label     IS DISTINCT FROM OLD.party_label
    OR ((NEW.tab_id     IS DISTINCT FROM OLD.tab_id
      OR NEW.tab_number IS DISTINCT FROM OLD.tab_number)
         AND current_setting('vw.moving_order_tab', true) IS DISTINCT FROM 'true')
    THEN
      RAISE EXCEPTION
        'Order header is immutable after creation (total, ordered_by, source, '
        'client_order_id, restaurant_id, table_number, created_at, '
        'party_label may not be changed; use move_order_to_tab() to reassign '
        'a tab — it updates both tab_id and tab_number together)';
    END IF;

  END IF;

  RETURN NEW;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- PART H — move_order_to_tab replacement (from migration 024)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Identical to the migration 024 body with two changes:
--   1. Lock SELECT on the target tab now fetches tab_number.
--   2. The UPDATE sets both tab_id and tab_number together so the
--      denormalised column never drifts from the FK.

CREATE OR REPLACE FUNCTION public.move_order_to_tab(
  p_order_id   uuid,
  p_new_tab_id uuid,
  p_reason     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tab        record;
  v_order      record;
  v_is_owner   boolean := false;
  v_role       text;
  v_old_tab_id uuid;
BEGIN
  IF length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'move_order_to_tab: reason must be at least 3 characters';
  END IF;

  SELECT id, restaurant_id, status, tab_number
  INTO   v_tab
  FROM   public.tabs
  WHERE  id = p_new_tab_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tab % not found', p_new_tab_id;
  END IF;

  IF v_tab.status = 'closed' THEN
    RAISE EXCEPTION 'Cannot move an order to a closed tab';
  END IF;

  SELECT id, restaurant_id, status, tab_id
  INTO   v_order
  FROM   public.orders
  WHERE  id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot reassign a cancelled order';
  END IF;

  IF v_tab.restaurant_id <> v_order.restaurant_id THEN
    RAISE EXCEPTION
      'Tab does not belong to the same restaurant as the order';
  END IF;

  IF v_order.tab_id IS NOT DISTINCT FROM p_new_tab_id THEN
    RAISE EXCEPTION 'Order is already assigned to tab %', p_new_tab_id;
  END IF;

  SELECT (owner_id = auth.uid())
  INTO   v_is_owner
  FROM   public.restaurants
  WHERE  id = v_order.restaurant_id;

  v_is_owner := COALESCE(v_is_owner, false);

  IF NOT v_is_owner THEN
    SELECT role
    INTO   v_role
    FROM   public.staff
    WHERE  id            = auth.uid()
      AND  restaurant_id = v_order.restaurant_id;
  END IF;

  IF NOT (v_is_owner OR v_role = 'manager') THEN
    RAISE EXCEPTION 'Only a manager or the owner may move an order between tabs';
  END IF;

  v_old_tab_id := v_order.tab_id;

  PERFORM set_config('vw.moving_order_tab', 'true', true);

  UPDATE public.orders
  SET    tab_id     = p_new_tab_id,
         tab_number = v_tab.tab_number
  WHERE  id         = p_order_id;

  INSERT INTO public.order_history
    (restaurant_id, order_id, changed_by, change_type, field, old_value, new_value)
  VALUES (
    v_order.restaurant_id, p_order_id, auth.uid(),
    'assignment', 'tab_id',
    v_old_tab_id::text, p_new_tab_id::text
  );

  INSERT INTO public.order_history
    (restaurant_id, order_id, changed_by, change_type, field, old_value, new_value)
  VALUES (
    v_order.restaurant_id, p_order_id, auth.uid(),
    'assignment', 'tab_move_reason',
    NULL, p_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_order_to_tab(uuid, uuid, text) TO authenticated;


COMMIT;
