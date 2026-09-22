-- ============================================================
-- Migration 020 — party_label and payment_method on orders
--
-- party_label: free-text tag a waiter sets at order creation to
--   separate multiple parties sharing a single table (e.g. four
--   groups at the VIP table each get a label). Set on INSERT,
--   blocked from UPDATE by both order-header guards.
--
-- payment_method: written by the cashier flow at settlement.
--   Intentionally NOT blocked in either guard — the cashier must
--   be able to write it after the order is placed.
--
-- Both columns are nullable; existing orders get NULL.
-- ============================================================

-- ── Schema ────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS party_label     text,
  ADD COLUMN IF NOT EXISTS payment_method  text
    CHECK (payment_method IN ('cash', 'transfer', 'pos'));


-- ── enforce_device_order_update: add party_label to both blocked lists ────
--
-- BEFORE UPDATE on orders, station-screen path.
-- party_label added to:
--   (a) the vw.recomputing_total narrow-window check
--   (b) the main column guard
-- payment_method intentionally absent from both.

CREATE OR REPLACE FUNCTION public.enforce_device_order_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_waiter_id uuid;
BEGIN
  -- Non-device sessions (WaiterApp, manager, owner) pass through unchanged.
  IF NOT public.is_active_device() THEN
    RETURN NEW;
  END IF;

  -- System total recomputation: only total may change; guard everything else.
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

  -- Reject writes to columns a device must never touch.
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

  -- Validate status transition.
  IF NOT (
    (OLD.status = 'pending'   AND NEW.status = 'preparing') OR
    (OLD.status = 'preparing' AND NEW.status = 'ready')     OR
    (OLD.status = 'ready'     AND NEW.status = 'served')
  ) THEN
    RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status;
  END IF;

  -- Resolve the waiter assigned to this table today.
  SELECT sa.waiter_id INTO v_waiter_id
  FROM   public.shift_assignments sa
  JOIN   public.tables t ON t.id = sa.table_id
  WHERE  sa.restaurant_id = NEW.restaurant_id
    AND  sa.assigned_date  = current_date
    AND  t.table_number    = NEW.table_number
  LIMIT  1;

  -- Set server-side timestamps and attribution.
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


-- ── enforce_staff_order_update: add party_label to both blocked lists ─────
--
-- BEFORE UPDATE on orders, waiter/manager path.
-- party_label added to:
--   (a) the vw.recomputing_total narrow-window check
--   (b) the main blocked-column list
-- payment_method intentionally absent — cashier flow writes it after order.

CREATE OR REPLACE FUNCTION public.enforce_staff_order_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  -- Device sessions are handled by enforce_device_order_update; skip here.
  IF public.is_any_device() THEN
    RETURN NEW;
  END IF;

  -- Only apply to waiter and manager sessions.
  -- NULL IN (...) evaluates to NULL, not TRUE — use positive IN check so
  -- owner sessions (current_staff_role() = NULL) fall through to RETURN NEW.
  IF public.current_staff_role() IN ('waiter', 'manager') THEN

    -- System total recompute: only total may change; guard everything else.
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

    -- Normal path: block immutable order header columns.
    -- Allowed: status, handled_by, prepared_at, ready_at, served_at, payment_method.
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
