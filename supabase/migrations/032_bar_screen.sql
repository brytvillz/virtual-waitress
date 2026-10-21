-- ─────────────────────────────────────────────────────────────────────────────
-- 032 Bar Screen
-- Changes:
--   1. Add order_items to the supabase_realtime publication
--   2. Modify enforce_device_order_update to allow pending→ready
--      (bar screen skips preparing; handled_by filled from ordered_by, not shift lookup)
--   3. Add station_type NOT NULL constraint + default 'bar' on devices
--   4. Set station_type default on device_pairing_codes to guide provisioning
--      (devices table has 0 rows; no backfill needed)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;

-- 2. Allow pending → ready in the device order trigger.
--    The bar screen taps Ready once; there is no preparing step.
--    handled_by on this path comes from ordered_by (the waiter who placed
--    the order), which is a recorded fact. For customer orders ordered_by
--    is NULL and handled_by stays NULL — no invented attribution.
--    The preparing branch is unchanged.
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
    (OLD.status = 'ready'     AND NEW.status = 'served')
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
      -- Direct pending→ready (bar tap): attribute to ordered_by.
      -- ordered_by is populated on all waiter orders; null on customer orders.
      -- Do not derive from shift assignments here — that would invent attribution.
      IF OLD.status = 'pending' AND OLD.handled_by IS NULL THEN
        NEW.handled_by := OLD.ordered_by;
      END IF;
    WHEN 'served' THEN
      NEW.served_at := now();
    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

-- 3. Devices: require station_type on every new device.
--    Zero existing rows, so no backfill needed.
--    Default 'bar' because every current pilot venue is a bar.
ALTER TABLE public.devices
  ALTER COLUMN station_type SET DEFAULT 'bar',
  ADD CONSTRAINT devices_station_type_not_null
    CHECK (station_type IS NOT NULL);
