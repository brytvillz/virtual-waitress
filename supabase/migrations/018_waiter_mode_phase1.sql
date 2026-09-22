-- ============================================================
-- MIGRATION 018: Waiter Mode Phase 1
--
-- Enables waiters to place orders directly, adds per-item station
-- tagging, per-item status lifecycle, idempotent offline ordering,
-- void requests (owner-approved), and safe total recomputation.
--
-- ── Session variables ────────────────────────────────────────
-- vw.resolving_void (is_local=true):
--   Set by enforce_void_request_insert and enforce_void_request_update
--   before they touch order_items.item_status. Lets the immutability
--   trigger pass those specific changes through without hitting the
--   caller-type guard. Clears at commit/rollback — cannot outlive its
--   transaction.
--
-- vw.recomputing_total (is_local=true):
--   Set by recompute_order_total before it UPDATE orders SET total.
--   enforce_device_order_update returns early when this is set, so
--   the system's own total update does not trigger the status-transition
--   guard. Same safety model as vw.resolving_void. Without this flag,
--   a device marking an item 'ready' causes the recompute to hit the
--   transition guard with OLD.status = NEW.status, raising an exception
--   and killing the station screen on first tap.
--
-- ── Idempotency ──────────────────────────────────────────────
-- orders.client_order_id + UNIQUE INDEX: one order per restaurant per
-- client UUID. Waiter must supply it; the trigger rejects NULL. Client
-- retries INSERT ... ON CONFLICT DO NOTHING and reads the row back.
-- Customer orders (anon) leave it NULL; the partial index ignores them.
--
-- ── Total recomputation ───────────────────────────────────────
-- AFTER INSERT/UPDATE/DELETE on order_items → UPDATE orders SET total.
-- Recomputes from scratch (idempotent, retry-safe). Excludes voided
-- items, so an approved void reduces the total automatically.
--
-- ── Void flow ────────────────────────────────────────────────
-- 1. Waiter inserts void_requests row.
-- 2. enforce_void_request_insert captures prior_status and advances
--    order_items.item_status to void_requested.
-- 3. Owner approves or rejects.
-- 4. enforce_void_request_update cascades: approved → voided (total
--    drops), rejected → prior_status (total unchanged).
--
-- ── Station scoping ───────────────────────────────────────────
-- current_device_station() returns the station_type stored on the
-- device row. order_items_for_device and device_update_order_items
-- both filter on this value. A device with station_type='all' sees
-- and can act on items for both stations — single-screen fallback.
-- ============================================================

BEGIN;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 — Schema additions
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. menu_items: station tag.
--     Nullable — existing items unaffected. enforce_waiter_order_item_insert
--     blocks ordering any item where station IS NULL.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS station text
    CHECK (station IN ('bar', 'kitchen'));

-- 1b. orders: waiter attribution, order source, idempotency key.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ordered_by      uuid REFERENCES public.staff(id),
  ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'customer'
    CHECK (source IN ('customer', 'waiter')),
  ADD COLUMN IF NOT EXISTS client_order_id uuid;

-- Idempotency constraint: one order per restaurant per client UUID.
-- Partial index on NOT NULL so customer orders never conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS orders_client_idempotency
  ON public.orders (restaurant_id, client_order_id)
  WHERE client_order_id IS NOT NULL;

-- 1c. order_items: station snapshot, per-item lifecycle, menu item FK.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS menu_item_id uuid REFERENCES public.menu_items(id),
  ADD COLUMN IF NOT EXISTS station      text
    CHECK (station IN ('bar', 'kitchen')),
  ADD COLUMN IF NOT EXISTS item_status  text NOT NULL DEFAULT 'sent'
    CHECK (item_status IN ('sent', 'ready', 'served', 'void_requested', 'voided'));

-- 1d. devices: station assignment.
--     'all' is the single-screen fallback — do not remove this value.
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS station_type text
    CHECK (station_type IN ('bar', 'kitchen', 'all'));

-- 1e. restaurants: per-venue customer ordering gate.
--     DEFAULT true keeps every existing venue unchanged.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS customer_ordering_enabled boolean NOT NULL DEFAULT true;

-- 1f. restaurants: business day boundary and local timezone.
--     Business day: starts at business_day_start and runs until the same time
--     the following day. For a bar that closes at 04:00, Saturday night's
--     takings run from Sat 06:00 through Sun 05:59 — all one shift.
--     timezone: stored on the restaurant, used by business_day_window() for
--     all money queries. Never hardcode 'Africa/Lagos' in query code.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS business_day_start time     NOT NULL DEFAULT '06:00',
  ADD COLUMN IF NOT EXISTS timezone           text     NOT NULL DEFAULT 'Africa/Lagos';


-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 — void_requests table
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.void_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_item_id  uuid        NOT NULL REFERENCES public.order_items(id),
  requested_by   uuid        NOT NULL REFERENCES public.staff(id),
  reason         text        NOT NULL,
  prior_status   text        NOT NULL
    CHECK (prior_status IN ('sent', 'ready', 'served')),
  status         text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by     uuid        REFERENCES public.staff(id),
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.void_requests ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 3 — Device station helper + order_items_for_device view
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. current_device_station()
--     Returns the station_type for the calling device.
--     NULL for non-device sessions (same safety pattern as
--     current_device_restaurant in migration 010).
CREATE OR REPLACE FUNCTION public.current_device_station()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT station_type
  FROM   public.devices
  WHERE  auth_user_id = auth.uid()
    AND  revoked_at IS NULL
  LIMIT  1;
$$;

-- 3b. order_items_for_device view
--     Devices must not receive price data ("station screens see no money").
--     This view is the ONLY read path for devices on order_items. Migration 010's
--     device_read_order_items policy (SELECT on base table) is dropped in Part 5.
--
--     Security model mirrors staff_public (migration 010):
--       security_invoker = false  → view runs as owner, bypasses order_items RLS.
--       security_barrier = true   → view WHERE evaluated before outer conditions.
--       current_device_restaurant() returns NULL for non-device sessions → zero rows.
--
--     Station scoping is enforced here, not in the route URL.
--     A bar device (station_type='bar') sees only bar items. station_type='all'
--     sees both. A non-device session gets zero rows from this view.
--
--     Only active-status items are shown. Served and voided items are
--     cleared from the board automatically.
CREATE OR REPLACE VIEW public.order_items_for_device
  WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  oi.id,
  oi.order_id,
  oi.menu_item_id,
  oi.item_name,
  oi.quantity,
  oi.station,
  oi.item_status
FROM public.order_items oi
JOIN public.orders o ON o.id = oi.order_id
WHERE o.restaurant_id = public.current_device_restaurant()
  AND oi.item_status IN ('sent', 'ready', 'void_requested')
  AND (
    oi.station IS NULL
    OR public.current_device_station() = 'all'
    OR oi.station = public.current_device_station()
  );

GRANT SELECT ON public.order_items_for_device TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 4 — Trigger functions
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. enforce_waiter_order_header
--     BEFORE INSERT on orders — for waiter sessions only.
--     Sets ordered_by, source, total, created_at server-side.
--     Rejects waiter orders that omit client_order_id (idempotency is
--     mandatory for waiter orders; a missing key means the offline queue
--     cannot deduplicate retries).
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

CREATE TRIGGER trg_waiter_order_header
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_waiter_order_header();


-- 4b. enforce_waiter_order_item_insert
--     BEFORE INSERT on order_items — fires when menu_item_id is supplied.
--     Copies price and station from menu_items (server-side snapshot).
--     Overwrites any client-supplied price or station.
--     Raises if the item has no station tag — the waiter UI must hide
--     untagged items so this path should never be reached on the floor.
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

CREATE TRIGGER trg_waiter_order_item_insert
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_waiter_order_item_insert();


-- 4c. recompute_order_total
--     AFTER INSERT/UPDATE/DELETE on order_items.
--     Recomputes orders.total from scratch — idempotent, retry-safe.
--     Excludes voided items (approved void reduces total automatically).
--
--     SECURITY DEFINER: UPDATE to orders must succeed regardless of the
--     calling session's own update policy on orders.
--
--     vw.recomputing_total (is_local=true): signals enforce_device_order_update
--     to return early instead of checking the status-transition rules.
--     Without this, a device marking an item 'ready' causes this trigger to
--     UPDATE orders (status unchanged, total unchanged) and the transition guard
--     raises "Invalid status transition: pending → pending", killing the screen.
CREATE OR REPLACE FUNCTION public.recompute_order_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  PERFORM set_config('vw.recomputing_total', 'true', true);

  UPDATE public.orders
  SET    total = (
    SELECT COALESCE(SUM(price * quantity), 0)
    FROM   public.order_items
    WHERE  order_id    = v_order_id
      AND  item_status <> 'voided'
  )
  WHERE  id = v_order_id;

  PERFORM set_config('vw.recomputing_total', 'false', true);

  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$;

CREATE TRIGGER trg_recompute_order_total
  AFTER INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.recompute_order_total();


-- 4d. enforce_order_item_immutable
--     BEFORE UPDATE on order_items.
--     Blocks all column changes except item_status.
--     Validates status transitions per caller type.
CREATE OR REPLACE FUNCTION public.enforce_order_item_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  -- System void resolution: bypass all checks.
  IF current_setting('vw.resolving_void', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Immutable columns — must never change after insert.
  IF NEW.order_id     IS DISTINCT FROM OLD.order_id
  OR NEW.item_name    IS DISTINCT FROM OLD.item_name
  OR NEW.quantity     IS DISTINCT FROM OLD.quantity
  OR NEW.price        IS DISTINCT FROM OLD.price
  OR NEW.station      IS DISTINCT FROM OLD.station
  OR NEW.menu_item_id IS DISTINCT FROM OLD.menu_item_id
  THEN
    RAISE EXCEPTION 'Order items are immutable after creation — submit a void request to remove an item';
  END IF;

  -- Allow no-op updates.
  IF NEW.item_status IS NOT DISTINCT FROM OLD.item_status THEN
    RETURN NEW;
  END IF;

  -- Transition validation per caller type.
  IF public.is_active_device() THEN
    IF NOT (OLD.item_status = 'sent' AND NEW.item_status = 'ready') THEN
      RAISE EXCEPTION 'Station screen may only advance item_status sent → ready (got % → %)',
        OLD.item_status, NEW.item_status;
    END IF;

  ELSIF public.current_staff_role() IN ('waiter', 'manager') THEN
    -- void_requested allowed from sent, ready, or served.
    IF NOT (
      (OLD.item_status IN ('sent', 'ready', 'served') AND NEW.item_status = 'void_requested') OR
      (OLD.item_status = 'ready'                      AND NEW.item_status = 'served')
    ) THEN
      RAISE EXCEPTION 'Invalid item_status transition for waiter/manager: % → %',
        OLD.item_status, NEW.item_status;
    END IF;

  ELSE
    RAISE EXCEPTION 'Caller not authorised to advance item_status (role: %)',
      COALESCE(public.current_staff_role(), 'unknown');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_item_immutable
  BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_item_immutable();


-- 4e. enforce_void_request_insert
--     BEFORE INSERT on void_requests.
--     Captures prior_status and requested_by server-side.
--     Advances order_items.item_status to void_requested immediately.
CREATE OR REPLACE FUNCTION public.enforce_void_request_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_current_status text;
BEGIN
  SELECT item_status
  INTO   v_current_status
  FROM   public.order_items
  WHERE  id = NEW.order_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item % does not exist', NEW.order_item_id;
  END IF;

  IF v_current_status NOT IN ('sent', 'ready', 'served') THEN
    RAISE EXCEPTION 'Cannot request void on item with status %', v_current_status;
  END IF;

  -- Server-side enforcement — overwrite all client-supplied values.
  NEW.requested_by := auth.uid();
  NEW.prior_status := v_current_status;
  NEW.status       := 'pending';
  NEW.created_at   := now();
  NEW.decided_by   := NULL;
  NEW.decided_at   := NULL;

  PERFORM set_config('vw.resolving_void', 'true', true);
  UPDATE public.order_items
  SET    item_status = 'void_requested'
  WHERE  id = NEW.order_item_id;
  PERFORM set_config('vw.resolving_void', 'false', true);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_void_request_insert
  BEFORE INSERT ON public.void_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_void_request_insert();


-- 4f. enforce_void_request_update
--     BEFORE UPDATE on void_requests.
--     Owner-only. Sets decided_at and decided_by server-side.
--     Cascades to order_items: approved → voided, rejected → prior_status.
CREATE OR REPLACE FUNCTION public.enforce_void_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target_status text;
BEGIN
  -- All fields except status are immutable.
  IF NEW.order_item_id  IS DISTINCT FROM OLD.order_item_id
  OR NEW.restaurant_id  IS DISTINCT FROM OLD.restaurant_id
  OR NEW.requested_by   IS DISTINCT FROM OLD.requested_by
  OR NEW.reason         IS DISTINCT FROM OLD.reason
  OR NEW.prior_status   IS DISTINCT FROM OLD.prior_status
  OR NEW.created_at     IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Void requests are immutable — only the status decision may be changed';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')) THEN
    RAISE EXCEPTION 'Invalid void request status transition: % → %', OLD.status, NEW.status;
  END IF;

  -- Ownership check (belt-and-braces alongside RLS policy).
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE  id       = NEW.restaurant_id
      AND  owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the restaurant owner may approve or reject void requests';
  END IF;

  NEW.decided_by := auth.uid();
  NEW.decided_at := now();

  v_target_status := CASE NEW.status
    WHEN 'approved' THEN 'voided'
    ELSE OLD.prior_status  -- rejection restores the specific status the item held before the request
  END;

  PERFORM set_config('vw.resolving_void', 'true', true);
  UPDATE public.order_items
  SET    item_status = v_target_status
  WHERE  id = NEW.order_item_id;
  PERFORM set_config('vw.resolving_void', 'false', true);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_void_request_update
  BEFORE UPDATE ON public.void_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_void_request_update();


-- 4g. enforce_device_order_update — replace function body from migration 010.
--     Adds guards for new order columns (ordered_by, source, client_order_id).
--     Adds vw.recomputing_total early-return so recompute_order_total can
--     UPDATE orders.total without triggering the status-transition guard.
--
--     Without the flag check: device marks item 'ready' → recompute fires →
--     UPDATE orders (total same value, status unchanged) → this trigger sees
--     is_active_device()=true and OLD.status=NEW.status → no valid transition
--     matches → raises exception → station screen dead on first tap.
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

  -- System total recomputation: only total may change; guard everything else as normal.
  -- Blanket RETURN NEW would let a device bypass the header guard during a recompute window.
  IF current_setting('vw.recomputing_total', true) = 'true' THEN
    IF NEW.ordered_by      IS DISTINCT FROM OLD.ordered_by
    OR NEW.source          IS DISTINCT FROM OLD.source
    OR NEW.client_order_id IS DISTINCT FROM OLD.client_order_id
    OR NEW.status          IS DISTINCT FROM OLD.status
    OR NEW.table_number    IS DISTINCT FROM OLD.table_number
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


-- 4h. enforce_staff_order_update
--     BEFORE UPDATE on orders — covers waiter and manager sessions.
--     Devices are already guarded by enforce_device_order_update and are
--     excluded here by the is_any_device() check.
--     Owner sessions have no staff row so current_staff_role() returns NULL
--     and the trigger passes through without acting.
--
--     Blocked columns: total, ordered_by, source, client_order_id,
--                      restaurant_id, table_number, created_at.
--     Allowed: status, handled_by, prepared_at, ready_at, served_at.
--
--     vw.recomputing_total path: only total may change (narrowed, same
--     pattern as enforce_device_order_update above). All other columns
--     remain guarded even during a server-side recompute.
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
  -- NULL IN (...) evaluates to NULL, not TRUE, so NOT IN cannot be used here —
  -- NULL would fall through the IF condition and hit the guard unintentionally.
  -- Invert: wrap the guard in an explicit IN check so NULL (owner, anon) is
  -- unambiguously excluded.
  IF public.current_staff_role() IN ('waiter', 'manager') THEN

    -- System total recompute: only total may change; guard everything else as normal.
    IF current_setting('vw.recomputing_total', true) = 'true' THEN
      IF NEW.ordered_by      IS DISTINCT FROM OLD.ordered_by
      OR NEW.source          IS DISTINCT FROM OLD.source
      OR NEW.client_order_id IS DISTINCT FROM OLD.client_order_id
      OR NEW.status          IS DISTINCT FROM OLD.status
      OR NEW.restaurant_id   IS DISTINCT FROM OLD.restaurant_id
      OR NEW.table_number    IS DISTINCT FROM OLD.table_number
      OR NEW.created_at      IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'Only orders.total may change during a system recompute';
      END IF;
      RETURN NEW;
    END IF;

    -- Normal path: block immutable order header columns.
    -- Allow: status, handled_by, prepared_at, ready_at, served_at.
    -- Future columns: add party_label here when it lands; payment_method must NOT
    -- be blocked here — the cashier flow needs to write it.
    IF NEW.total           IS DISTINCT FROM OLD.total
    OR NEW.ordered_by      IS DISTINCT FROM OLD.ordered_by
    OR NEW.source          IS DISTINCT FROM OLD.source
    OR NEW.client_order_id IS DISTINCT FROM OLD.client_order_id
    OR NEW.restaurant_id   IS DISTINCT FROM OLD.restaurant_id
    OR NEW.table_number    IS DISTINCT FROM OLD.table_number
    OR NEW.created_at      IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION
        'Order header is immutable after creation (total, ordered_by, source, '
        'client_order_id, restaurant_id, table_number, created_at may not be changed)';
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_staff_order_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_order_update();


-- ════════════════════════════════════════════════════════════════════════════
-- PART 4i — business_day_window helper
-- ════════════════════════════════════════════════════════════════════════════

-- Returns the timestamptz bounds of the current (or a specified past) business
-- day for a restaurant.
--
-- Logic:
--   1. Convert now() to local time using the restaurant's timezone.
--   2. If the local clock is BEFORE business_day_start (e.g. 02:00 < 06:00),
--      the business day started YESTERDAY — subtract one day.
--   3. Build the local start timestamp, convert back to UTC (timestamptz).
--   4. ends_at = starts_at + interval '1 day'.
--
-- Use half-open interval: WHERE created_at >= starts_at AND created_at < ends_at.
-- Nothing is double-counted at the boundary. Past nights are queryable by
-- passing p_local_date explicitly.
--
-- This function is the ONLY authoritative source of the business-day window.
-- No money query may compute its own date arithmetic.
CREATE OR REPLACE FUNCTION public.business_day_window(
  p_restaurant_id uuid,
  p_local_date    date DEFAULT NULL
)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tz              text;
  v_start_time      time;
  v_local_now       timestamptz;
  v_local_time      time;
  v_local_date      date;
  v_local_start     timestamp;
BEGIN
  SELECT timezone, business_day_start
  INTO   v_tz, v_start_time
  FROM   public.restaurants
  WHERE  id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant % not found', p_restaurant_id;
  END IF;

  IF p_local_date IS NOT NULL THEN
    -- Caller is asking for a specific past business day.
    v_local_date := p_local_date;
  ELSE
    -- Determine the current business day from local clock.
    v_local_now  := now() AT TIME ZONE v_tz;
    v_local_time := v_local_now::time;
    v_local_date := v_local_now::date;

    -- If local clock is before the day-start boundary (e.g. 02:00 < 06:00),
    -- we are still inside yesterday's business day.
    IF v_local_time < v_start_time THEN
      v_local_date := v_local_date - 1;
    END IF;
  END IF;

  v_local_start := v_local_date + v_start_time;

  RETURN QUERY
  SELECT
    (v_local_start AT TIME ZONE v_tz)                              AS starts_at,
    (v_local_start AT TIME ZONE v_tz) + interval '1 day'          AS ends_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.business_day_window(uuid, date) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 5 — RLS changes
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. Gate anon customer ordering on customer_ordering_enabled.
DROP POLICY IF EXISTS "anon_insert_orders" ON public.orders;

CREATE POLICY "anon_insert_orders" ON public.orders
  FOR INSERT TO anon
  WITH CHECK (
    restaurant_id IN (
      SELECT id FROM public.restaurants
      WHERE  customer_ordering_enabled = true
    )
  );

-- 5b. Waiters may INSERT orders for their own restaurant.
CREATE POLICY "waiter_insert_orders" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.current_staff_restaurant()
    AND public.current_staff_role() = 'waiter'
    AND NOT public.is_any_device()
  );

-- 5c. Remove device SELECT on the base order_items table.
--     Devices now read through order_items_for_device (no price column).
--     Proof test: SELECT price FROM order_items as a device JWT must return
--     zero rows.
DROP POLICY IF EXISTS "device_read_order_items" ON public.order_items;

-- 5d. Waiters and managers INSERT order_items.
CREATE POLICY "waiter_insert_order_items" ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    order_id IN (
      SELECT id FROM public.orders
      WHERE  restaurant_id = public.current_staff_restaurant()
    )
    AND NOT public.is_any_device()
    AND public.current_staff_role() IN ('waiter', 'manager')
  );

-- 5e. Waiters and managers UPDATE item_status.
--     enforce_order_item_immutable validates columns and transitions.
CREATE POLICY "waiter_update_order_items" ON public.order_items
  FOR UPDATE TO authenticated
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE  restaurant_id = public.current_staff_restaurant()
    )
    AND NOT public.is_any_device()
  )
  WITH CHECK (
    order_id IN (
      SELECT id FROM public.orders
      WHERE  restaurant_id = public.current_staff_restaurant()
    )
    AND NOT public.is_any_device()
  );

-- 5f. Devices UPDATE item_status (sent → ready only, validated by trigger).
--     Mirrors order_items_for_device view: NULL station is visible to and
--     actionable by every device so customer-ordered items (no station tag)
--     do not accumulate on a board that cannot be cleared.
CREATE POLICY "device_update_order_items" ON public.order_items
  FOR UPDATE TO authenticated
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE  restaurant_id = public.current_device_restaurant()
    )
    AND public.is_active_device()
    AND (
      station IS NULL
      OR public.current_device_station() = 'all'
      OR station = public.current_device_station()
    )
  )
  WITH CHECK (
    order_id IN (
      SELECT id FROM public.orders
      WHERE  restaurant_id = public.current_device_restaurant()
    )
    AND public.is_active_device()
    AND (
      station IS NULL
      OR public.current_device_station() = 'all'
      OR station = public.current_device_station()
    )
  );

-- 5g. Waiters INSERT void requests.
CREATE POLICY "waiter_insert_void_requests" ON public.void_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.current_staff_restaurant()
    AND NOT public.is_any_device()
    AND public.current_staff_role() = 'waiter'
  );

-- 5h. Staff read void requests for their restaurant.
CREATE POLICY "staff_read_void_requests" ON public.void_requests
  FOR SELECT TO authenticated
  USING (
    restaurant_id = public.current_staff_restaurant()
    AND NOT public.is_any_device()
  );

-- 5i. Owner reads void requests via the owner_id path (no staff row needed).
CREATE POLICY "owner_read_void_requests" ON public.void_requests
  FOR SELECT TO authenticated
  USING (
    restaurant_id IN (
      SELECT id FROM public.restaurants
      WHERE  owner_id = auth.uid()
    )
    AND NOT public.is_any_device()
  );

-- 5j. Owner approves or rejects void requests.
--     enforce_void_request_update re-checks ownership and sets timestamps.
CREATE POLICY "owner_update_void_requests" ON public.void_requests
  FOR UPDATE TO authenticated
  USING (
    restaurant_id IN (
      SELECT id FROM public.restaurants
      WHERE  owner_id = auth.uid()
    )
    AND NOT public.is_any_device()
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT id FROM public.restaurants
      WHERE  owner_id = auth.uid()
    )
    AND NOT public.is_any_device()
  );


COMMIT;
