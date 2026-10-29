-- MIGRATION 045: Bar screen undo — allow ready → pending reversal
--
-- The enforce_device_order_update trigger previously allowed only:
--   pending → preparing, pending → ready, preparing → ready, ready → served
--
-- This migration adds ready → pending for the bar screen undo feature.
-- The trigger handles clearing ready_at and handled_by server-side; the client
-- only needs to send { status: 'pending' }.
--
-- order_history records both the status change and the handled_by clearance
-- automatically via the existing record_order_history AFTER trigger.

CREATE OR REPLACE FUNCTION public.enforce_device_order_update()
RETURNS trigger LANGUAGE plpgsql AS $$
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
    (OLD.status = 'pending'   AND NEW.status = 'ready')     OR
    (OLD.status = 'preparing' AND NEW.status = 'ready')     OR
    (OLD.status = 'ready'     AND NEW.status = 'served')    OR
    (OLD.status = 'ready'     AND NEW.status = 'pending')
  ) THEN
    RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status;
  END IF;

  -- Shift-assignment lookup: only used for the preparing branch.
  IF OLD.status = 'pending' AND NEW.status = 'preparing' THEN
    SELECT sa.waiter_id INTO v_waiter_id
    FROM   public.shift_assignments sa
    JOIN   public.tables t ON t.id = sa.table_id
    WHERE  sa.restaurant_id = NEW.restaurant_id
      AND  sa.assigned_date  = current_date
      AND  t.table_number    = NEW.table_number
    LIMIT  1;
  END IF;

  CASE NEW.status
    WHEN 'preparing' THEN
      NEW.prepared_at := now();
      IF OLD.handled_by IS NULL THEN
        NEW.handled_by := v_waiter_id;
      END IF;
    WHEN 'ready' THEN
      NEW.ready_at := now();
      IF OLD.status = 'pending' AND OLD.handled_by IS NULL THEN
        NEW.handled_by := OLD.ordered_by;
      END IF;
    WHEN 'served' THEN
      NEW.served_at := now();
    WHEN 'pending' THEN
      -- Undo: reverse the ready transition.
      -- Clear both timestamps and attribution written when going ready.
      NEW.ready_at   := NULL;
      NEW.handled_by := NULL;
    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

-- Trigger functions must be revoked from all caller roles.
-- See AGENTS.md for the full rationale.
REVOKE EXECUTE ON FUNCTION public.enforce_device_order_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_device_order_update() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_device_order_update() FROM authenticated;
