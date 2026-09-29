-- ============================================================
-- ROLLBACK for migration 024_tabs.sql
--
-- Removes the tabs table, orders.tab_id column, all functions
-- and triggers added in 024, and restores enforce_device_order_update
-- and enforce_staff_order_update to their migration 020/022 bodies
-- (without tab_id in the guard lists).
--
-- HOW TO USE
-- Supabase Dashboard → SQL Editor, or:
--   psql $DATABASE_URL -f supabase/rollback/024_ROLLBACK.sql
--
-- WARNING: drops all tab data and removes tab_id from all orders.
-- Apply only to a database that has not yet had tabs used in production.
-- ============================================================

BEGIN;

-- Functions and triggers added by 024.
DROP TRIGGER IF EXISTS trg_tab_order_assignment ON public.orders;
DROP FUNCTION IF EXISTS public.enforce_tab_order_assignment();
DROP FUNCTION IF EXISTS public.move_order_to_tab(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.void_tab(uuid, text);
DROP FUNCTION IF EXISTS public.settle_tab(uuid, text);
DROP FUNCTION IF EXISTS public.open_tab(uuid, int, text);

-- Remove tab_id from orders before dropping tabs (FK constraint).
ALTER TABLE public.orders DROP COLUMN IF EXISTS tab_id;

-- Drop tabs table (cascades RLS policies and indexes).
DROP TABLE IF EXISTS public.tabs;

-- Restore enforce_device_order_update to migration 020 body
-- (tab_id removed from guard lists).
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

-- Restore enforce_staff_order_update to migration 022 body
-- (tab_id removed from guard lists).
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
    THEN
      RAISE EXCEPTION
        'Order header is immutable after creation (total, ordered_by, source, '
        'client_order_id, restaurant_id, table_number, created_at, party_label '
        'may not be changed)';
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
