-- ============================================================
-- ROLLBACK for migration 025_table_number_optional.sql
--
-- Removes the schema additions from 025 and restores the three
-- SECURITY DEFINER functions to their migration 024 bodies.
--
-- WARNING: The NOT NULL restoration on orders.table_number and
-- waiter_calls.table_number will fail if any rows with NULL
-- table_number exist. Before running, either delete those rows or
-- set them to a sentinel value (e.g. 0) and clean up afterwards.
--
-- HOW TO USE
-- Supabase Dashboard → SQL Editor, or:
--   psql $DATABASE_URL -f supabase/rollback/025_ROLLBACK.sql
-- ============================================================

BEGIN;

-- Restore enforce_tab_order_assignment to migration 024 body
-- (tab_number stamp removed).
CREATE OR REPLACE FUNCTION public.enforce_tab_order_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tab_status     text;
  v_tab_restaurant uuid;
BEGIN
  IF NEW.tab_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status, restaurant_id
  INTO   v_tab_status, v_tab_restaurant
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

  RETURN NEW;
END;
$$;

-- Restore enforce_device_order_update to migration 024 body
-- (tab_number removed from guard lists).
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

-- Restore enforce_staff_order_update to migration 024 body
-- (tab_number removed from guard lists).
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
    OR (NEW.tab_id IS DISTINCT FROM OLD.tab_id
        AND current_setting('vw.moving_order_tab', true) IS DISTINCT FROM 'true')
    THEN
      RAISE EXCEPTION
        'Order header is immutable after creation (total, ordered_by, source, '
        'client_order_id, restaurant_id, table_number, created_at, '
        'party_label may not be changed; use move_order_to_tab() to reassign a tab)';
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- Restore move_order_to_tab to migration 024 body
-- (tab_number removed from SELECT and UPDATE).
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

  SELECT id, restaurant_id, status
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
  SET    tab_id = p_new_tab_id
  WHERE  id     = p_order_id;

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

-- Remove columns added by 025.
-- WARNING: if any orders.table_number or waiter_calls.table_number rows
-- are NULL, SET NOT NULL will fail. Update or delete those rows first.
ALTER TABLE public.orders DROP COLUMN IF EXISTS tab_number;
ALTER TABLE public.restaurants DROP COLUMN IF EXISTS uses_table_numbers;

ALTER TABLE public.orders ALTER COLUMN table_number SET NOT NULL;
ALTER TABLE public.waiter_calls ALTER COLUMN table_number SET NOT NULL;

COMMIT;
