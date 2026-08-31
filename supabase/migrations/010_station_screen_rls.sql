-- ============================================================
-- MIGRATION 010: Station Screen — device role, RLS, triggers
-- Run AFTER 009 (devices table must exist before these functions).
--
-- WHY DEVICES ARE DENIED BY DEFAULT
-- Every existing staff_* and owner_* policy calls current_staff_restaurant(),
-- which queries the staff table. Device users have no row in staff, so that
-- function returns NULL → restaurant_id = NULL is never true → all existing
-- policies automatically deny device users. These policies add only what
-- devices explicitly need.
--
-- FUTURE NOTE: access_code lives alongside name in the staff table. Any
-- future policy that grants devices SELECT on staff leaks it. Move
-- access_code to its own credentials table before this becomes a pattern.
-- ============================================================

BEGIN;

-- ── 1. Device role helper functions ───────────────────────────────────────────
--
-- SECURITY: both functions are SECURITY DEFINER (bypass RLS on devices table)
-- and both pin search_path to prevent an attacker from redirecting the 'devices'
-- table reference to a malicious schema by pre-setting search_path.
-- auth must be included because auth.uid() lives in the auth schema.
--
-- What they return for each session type:
--   Active device  → restaurant_id / true
--   Revoked device → NULL / false   (revoked_at IS NOT NULL → excluded)
--   Manager        → NULL / false   (no row in devices with their auth uid)
--   Waiter         → NULL / false   (same)
--   Anon customer  → NULL / false   (auth.uid() returns NULL for anon; = NULL never true)

CREATE OR REPLACE FUNCTION public.current_device_restaurant()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT restaurant_id
  FROM   public.devices
  WHERE  auth_user_id = auth.uid()
    AND  revoked_at IS NULL
  LIMIT  1;
$$;

CREATE OR REPLACE FUNCTION public.is_active_device()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.devices
    WHERE  auth_user_id = auth.uid()
      AND  revoked_at IS NULL
  );
$$;


-- ── 2. staff_public view ──────────────────────────────────────────────────────
--
-- This is the ONLY way a device session can read staff data.
-- Devices have no policy on the base staff table → direct reads are denied.
--
-- security_invoker = false (SECURITY DEFINER behaviour):
--   The view runs as its owner (postgres superuser), bypassing the staff
--   table's RLS. This is what allows a device — with no staff policy — to
--   read through the view at all.
--
-- security_barrier = true:
--   PostgreSQL evaluates the view's own WHERE before any outer-query conditions,
--   blocking filter-pushdown attacks that could leak rows via side-channel.
--
-- WHERE restaurant_id = current_device_restaurant():
--   For non-device sessions (manager, waiter, anon), current_device_restaurant()
--   returns NULL → restaurant_id = NULL → zero rows. Safe.
--
-- NO access_code COLUMN. Access_code cannot be retrieved through this view
-- because it is not projected. Requesting it via the API returns:
--   "column access_code does not exist"
--
-- Managers are not affected: they read the base staff table via
-- owner_manage_staff and existing staff policies, which still expose access_code.
--
-- GRANT SELECT ON staff_public TO authenticated is required for PostgREST to
-- expose this view. Without it the view exists in the DB but is invisible to
-- the REST API and the Station Screen breaks on day one.

CREATE OR REPLACE VIEW public.staff_public
WITH (security_invoker = false, security_barrier = true)
AS
SELECT id, restaurant_id, name, role
FROM   public.staff
WHERE  restaurant_id = public.current_device_restaurant();

GRANT SELECT ON public.staff_public TO authenticated;


-- ── 3. devices table RLS ──────────────────────────────────────────────────────

-- Device reads its own row — essential for detecting revocation on startup.
CREATE POLICY "device_read_own" ON devices
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- Device updates only last_seen_at (heartbeat).
-- Trigger below rejects any other column change from a device session.
CREATE POLICY "device_update_own_heartbeat" ON devices
  FOR UPDATE TO authenticated
  USING  (auth_user_id = auth.uid() AND is_active_device())
  WITH CHECK (auth_user_id = auth.uid() AND is_active_device());

-- Managers read all devices for their restaurant.
CREATE POLICY "manager_read_devices" ON devices
  FOR SELECT TO authenticated
  USING (restaurant_id = current_staff_restaurant()
         AND current_staff_role() = 'manager');

-- Managers update devices (rename, set revoked_at to revoke).
-- Insertion is done by the pair-device edge function via service role.
CREATE POLICY "manager_update_devices" ON devices
  FOR UPDATE TO authenticated
  USING  (restaurant_id = current_staff_restaurant()
          AND current_staff_role() = 'manager')
  WITH CHECK (restaurant_id = current_staff_restaurant()
              AND current_staff_role() = 'manager');

-- Trigger: device sessions may only touch last_seen_at.
CREATE OR REPLACE FUNCTION public.enforce_device_heartbeat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_device() THEN
    IF NEW.auth_user_id  IS DISTINCT FROM OLD.auth_user_id
    OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
    OR NEW.name          IS DISTINCT FROM OLD.name
    OR NEW.created_at    IS DISTINCT FROM OLD.created_at
    OR NEW.revoked_at    IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION 'Device sessions may only update last_seen_at';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_device_heartbeat
  BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_device_heartbeat();


-- ── 4. device_pairing_codes RLS ──────────────────────────────────────────────

CREATE POLICY "manager_insert_pairing_codes" ON device_pairing_codes
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = current_staff_restaurant()
              AND current_staff_role() = 'manager');

CREATE POLICY "manager_read_pairing_codes" ON device_pairing_codes
  FOR SELECT TO authenticated
  USING (restaurant_id = current_staff_restaurant()
         AND current_staff_role() = 'manager');

-- Code redemption (marking used_at, inserting the devices row) uses
-- the service role key in the pair-device edge function → bypasses RLS.


-- ── 5. orders: device read + update ──────────────────────────────────────────

-- Device reads active rows only. Served and cancelled are cleared from the board.
CREATE POLICY "device_read_orders" ON orders
  FOR SELECT TO authenticated
  USING (
    restaurant_id = current_device_restaurant()
    AND is_active_device()
    AND status IN ('pending', 'preparing', 'ready')
  );

-- Device can update orders. The trigger enforces which columns may change
-- and validates the transition. It also sets timestamps and attribution.
CREATE POLICY "device_update_orders" ON orders
  FOR UPDATE TO authenticated
  USING  (restaurant_id = current_device_restaurant() AND is_active_device())
  WITH CHECK (restaurant_id = current_device_restaurant() AND is_active_device());

-- Trigger: enforces column protection, transition validation, and server-side
-- timestamps + waiter attribution for device sessions.
-- Non-device updates (WaiterApp, manager) pass through untouched.
-- SECURITY DEFINER + pinned search_path so it can query shift_assignments and
-- tables freely without being blocked by their RLS.
CREATE OR REPLACE FUNCTION public.enforce_device_order_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_waiter_id uuid;
BEGIN
  -- Non-device sessions (WaiterApp, manager) pass through unchanged.
  IF NOT public.is_active_device() THEN
    RETURN NEW;
  END IF;

  -- Reject writes to columns a device must never touch.
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
  OR NEW.table_number  IS DISTINCT FROM OLD.table_number
  OR NEW.total         IS DISTINCT FROM OLD.total
  OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Station Screen may only update order status';
  END IF;

  -- Validate status transition. Only adjacent steps, no skipping, no reversals.
  --   pending → preparing → ready → served
  IF NOT (
    (OLD.status = 'pending'   AND NEW.status = 'preparing') OR
    (OLD.status = 'preparing' AND NEW.status = 'ready')     OR
    (OLD.status = 'ready'     AND NEW.status = 'served')
  ) THEN
    RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status;
  END IF;

  -- Resolve the waiter assigned to this table today from shift_assignments.
  -- NULL is acceptable when no assignment exists (see product note: the Station
  -- Screen should warn when tables have activity but no assignment for today).
  SELECT sa.waiter_id INTO v_waiter_id
  FROM   public.shift_assignments sa
  JOIN   public.tables t ON t.id = sa.table_id
  WHERE  sa.restaurant_id = NEW.restaurant_id
    AND  sa.assigned_date  = current_date
    AND  t.table_number    = NEW.table_number
  LIMIT  1;

  -- Set server-side timestamps and attribution.
  -- Client sends only {status: 'ready'}; the trigger fills in the rest.
  -- Any client-supplied value for these columns is overwritten here.
  CASE NEW.status
    WHEN 'preparing' THEN
      NEW.prepared_at := now();
      -- Keep existing handled_by if WaiterApp already stamped it.
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

CREATE TRIGGER trg_enforce_device_order_update
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_device_order_update();


-- ── 6. order_items: device read ───────────────────────────────────────────────

-- Device reads item names and quantities so a waiter knows what to carry.
-- price column exists in order_items but is never requested by the component.
-- No write policy — devices cannot insert or modify order_items.
CREATE POLICY "device_read_order_items" ON order_items
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE  restaurant_id = public.current_device_restaurant()
        AND  public.is_active_device()
        AND  status IN ('pending', 'preparing', 'ready')
    )
  );


-- ── 7. waiter_calls: device read + acknowledge ────────────────────────────────

-- Device reads pending calls only.
CREATE POLICY "device_read_waiter_calls" ON waiter_calls
  FOR SELECT TO authenticated
  USING (
    restaurant_id = current_device_restaurant()
    AND is_active_device()
    AND status = 'pending'
  );

-- One tap clears a row. Trigger sets acknowledged_at and acknowledged_by.
CREATE POLICY "device_update_waiter_calls" ON waiter_calls
  FOR UPDATE TO authenticated
  USING  (restaurant_id = current_device_restaurant() AND is_active_device())
  WITH CHECK (restaurant_id = current_device_restaurant() AND is_active_device());

CREATE OR REPLACE FUNCTION public.enforce_device_call_update()
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

  -- Reject writes to protected columns.
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
  OR NEW.table_number  IS DISTINCT FROM OLD.table_number
  OR NEW.call_type     IS DISTINCT FROM OLD.call_type
  OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Station Screen may only update call status';
  END IF;

  -- Only pending → acknowledged is a valid device transition.
  IF NOT (OLD.status = 'pending' AND NEW.status = 'acknowledged') THEN
    RAISE EXCEPTION 'Invalid call status transition: % → %', OLD.status, NEW.status;
  END IF;

  -- Resolve assigned waiter for this table today.
  SELECT sa.waiter_id INTO v_waiter_id
  FROM   public.shift_assignments sa
  JOIN   public.tables t ON t.id = sa.table_id
  WHERE  sa.restaurant_id = NEW.restaurant_id
    AND  sa.assigned_date  = current_date
    AND  t.table_number    = NEW.table_number
  LIMIT  1;

  -- Set attribution server-side. Overwrites anything the client sent.
  NEW.acknowledged_at := now();
  NEW.acknowledged_by := v_waiter_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_device_call_update
  BEFORE UPDATE ON waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.enforce_device_call_update();


-- ── 8. shift_assignments: device reads today only ────────────────────────────

CREATE POLICY "device_read_shift_assignments" ON shift_assignments
  FOR SELECT TO authenticated
  USING (
    restaurant_id = current_device_restaurant()
    AND is_active_device()
    AND assigned_date = current_date
  );


-- ── 9. No new policy on restaurants ──────────────────────────────────────────
-- Existing "Public can read restaurants" (USING true) already covers devices.
-- thresh_* and alert_* columns land there — fine, no financial data.
-- See billing warning in 009.
-- No write policy for devices on restaurants.


-- ── 10. Complete access matrix ────────────────────────────────────────────────
--
-- READ
--   orders              active rows (pending/preparing/ready), own restaurant
--   order_items         items for active orders, own restaurant
--   waiter_calls        pending only, own restaurant
--   shift_assignments   today only, own restaurant
--   staff_public        id, name, role only — NO access_code, own restaurant
--   restaurants         all columns (world-readable by existing policy)
--   devices             own row only
--
-- UPDATE (column restrictions enforced by triggers)
--   orders.status              pending→preparing, preparing→ready, ready→served
--   orders.prepared/ready/served_at + handled_by  — set by trigger, not client
--   waiter_calls.status        pending→acknowledged only
--   waiter_calls.acknowledged_at + acknowledged_by — set by trigger, not client
--   devices.last_seen_at       own row only
--
-- INSERT  nothing
-- DELETE  nothing
--
-- BLOCKED (no policy + current_staff_restaurant() returns NULL for devices)
--   staff base table        — denied (access_code unreachable)
--   push_subscriptions      — denied
--   menu_categories/items   — no write policy
--   restaurants UPDATE      — no policy
-- ============================================================

COMMIT;
