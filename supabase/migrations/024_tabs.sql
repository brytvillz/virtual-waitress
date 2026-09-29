-- ============================================================
-- Migration 024 — tabs (stage 1 of tab feature)
--
-- A tab is a named running bill a waiter opens for a group of
-- guests, accumulates separate orders onto across a service
-- session, and settles with one payment at the end.
-- One table can have more than one tab. Venues with no table
-- numbers set tabs.table_number = NULL.
--
-- Part A — tabs table
--   Sequential tab_number per (restaurant, business_day).
--   business_day uses the restaurant's business_day_start and
--   timezone so a bar's late-night service is not split at
--   calendar midnight.
--
-- Part B — orders.tab_id FK column (nullable)
--
-- Part C — enforce_tab_order_assignment (BEFORE INSERT on orders)
--   Blocks assigning an order to a closed tab.
--
-- Part D — enforce_device_order_update replacement (from 020)
--   tab_id added to both immutable column guard lists.
--
-- Part E — enforce_staff_order_update replacement (from 022)
--   tab_id added to both immutable column guard lists.
--
-- Part F — open_tab(restaurant_id, table_number, note) → uuid
--   SECURITY DEFINER. Race-safe tab_number allocation via
--   pg_advisory_xact_lock so two concurrent opens cannot claim
--   the same number.
--
-- Part G — settle_tab(tab_id, payment_method)
--   SECURITY DEFINER. One transaction: marks every non-cancelled
--   order on the tab paid, closes the tab. All-or-nothing.
--   Auth: the waiter who opened the tab, any manager, or the owner.
--
-- Part H — void_tab(tab_id, reason)
--   SECURITY DEFINER. Closes an empty tab (all orders cancelled or
--   no orders) and records the reason on the tab row. Manager or
--   owner only.
--
-- Part I — move_order_to_tab(order_id, new_tab_id, reason)
--   SECURITY DEFINER. Reassigns one order to a different open tab.
--   Manager or owner only. Writes two audit rows to order_history.
--   Uses vw.moving_order_tab session flag to bypass the tab_id
--   guard in enforce_staff_order_update (normal path only).
--
-- Part J — RLS on tabs
--   Staff read. All writes go through the SECURITY DEFINER RPCs.
--   Anon has no policies — both read and write blocked.
--
-- Session variables used:
--   vw.moving_order_tab = 'true' (is_local, set by move_order_to_tab)
--     Permits a single tab_id change on orders in the normal path of
--     enforce_staff_order_update. Cleared automatically at transaction end.
--   settle_tab() needs no flag: is_paid and payment_method are absent
--   from all enforce_staff_order_update guard lists.
--
-- Purely additive: no existing tables dropped or columns
-- removed. enforce_device_order_update and
-- enforce_staff_order_update are replaced in place
-- (CREATE OR REPLACE).
-- ============================================================


BEGIN;


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — tabs table
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tabs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  tab_number    int         NOT NULL,
  -- Logical date of this tab's service session. Computed using the
  -- restaurant's business_day_start and timezone — identical logic to
  -- business_day_window(). A 2 AM tab at a venue with business_day_start
  -- = '06:00' carries the previous calendar date so the number sequence
  -- does not reset at midnight.
  business_day  date        NOT NULL,
  -- NULL for venues that do not use table numbers.
  table_number  int         NULL,
  note          text        NULL,
  -- Set by void_tab(); NULL on a normally settled tab.
  -- A closed tab with void_reason IS NOT NULL was voided before settlement.
  void_reason   text        NULL,
  status        text        NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'closed')),
  opened_by     uuid        NOT NULL REFERENCES auth.users(id),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_by     uuid        NULL     REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at     timestamptz NULL,

  -- Two waiters opening tabs in the same second get different numbers
  -- because open_tab() holds a per-(restaurant, business_day) advisory
  -- lock across the MAX+1 computation and the INSERT.
  CONSTRAINT tabs_number_unique_per_day
    UNIQUE (restaurant_id, business_day, tab_number)
);

ALTER TABLE public.tabs ENABLE ROW LEVEL SECURITY;

-- Fast look-up of all tabs for a restaurant on a given business day
-- (waiter app tab list, admin end-of-night report).
CREATE INDEX IF NOT EXISTS idx_tabs_restaurant_day
  ON public.tabs (restaurant_id, business_day);

-- Fast look-up of open tabs only (the common waiter query).
CREATE INDEX IF NOT EXISTS idx_tabs_open
  ON public.tabs (restaurant_id)
  WHERE status = 'open';


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — orders.tab_id FK column
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tab_id uuid NULL REFERENCES public.tabs(id);

-- Fast look-up of all orders for a tab (used by settle_tab and future UI).
CREATE INDEX IF NOT EXISTS idx_orders_tab_id
  ON public.orders (tab_id)
  WHERE tab_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — enforce_tab_order_assignment (BEFORE INSERT on orders)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Fires only when tab_id IS NOT NULL. Verifies the tab exists, belongs to
-- the same restaurant, and is open. Closed tabs reject new orders.
--
-- SECURITY DEFINER so the trigger can read public.tabs regardless of the
-- calling session's SELECT policies (anon customers and device sessions
-- have no access to tabs).

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

-- Alphabetically 'trg_t' fires after 'trg_c' (customer_ordering_gate)
-- and 'trg_e' (enforce_waiter_order_header), which is correct: the
-- waiter header trigger validates and normalises the row first; this
-- trigger then validates the tab assignment.
CREATE TRIGGER trg_tab_order_assignment
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tab_order_assignment();


-- ════════════════════════════════════════════════════════════════════════════
-- PART D — enforce_device_order_update replacement (from migration 020)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Identical to the migration 020 body with one addition:
--   tab_id added to the recompute narrow-window guard and to the main
--   blocked-column list so station screens cannot change a tab assignment.

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
    OR NEW.tab_id          IS DISTINCT FROM OLD.tab_id
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
  OR NEW.tab_id          IS DISTINCT FROM OLD.tab_id
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


-- ════════════════════════════════════════════════════════════════════════════
-- PART E — enforce_staff_order_update replacement (from migration 022)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Identical to the migration 022 body with these additions:
--   (recompute path) tab_id added unconditionally — no recompute may change
--     a tab assignment.
--   (normal path) tab_id guarded unless vw.moving_order_tab = 'true', which
--     move_order_to_tab() sets (is_local) before its UPDATE so only that one
--     function may reassign tabs. All other direct tab_id writes are blocked.
--
-- settle_tab() changes only is_paid and payment_method — both intentionally
-- absent from the blocked-column list (cashier flow). No session flag needed.

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

  -- No direct cancellation by any authenticated session.
  -- cancel_order() and approve_cancellation_request() set
  -- vw.cancelling_order = 'true' (is_local) before their UPDATE on orders;
  -- the guard lets them through.
  IF current_setting('vw.cancelling_order', true) IS DISTINCT FROM 'true'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'cancelled'
  THEN
    RAISE EXCEPTION
      'Orders cannot be cancelled by a direct UPDATE — use cancel_order() '
      'or approve_cancellation_request() so the reason is recorded';
  END IF;

  -- Column guards apply to waiter and manager sessions only.
  -- NULL IN (...) evaluates to NULL, not TRUE — owner sessions
  -- (current_staff_role() = NULL) fall through to RETURN NEW.
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
      OR NEW.tab_id          IS DISTINCT FROM OLD.tab_id
      THEN
        RAISE EXCEPTION 'Only orders.total may change during a system recompute';
      END IF;
      RETURN NEW;
    END IF;

    -- Normal path: block immutable order header columns.
    -- Allowed changes: status (managers via cancel_order), handled_by,
    -- prepared_at, ready_at, served_at, payment_method, is_paid,
    -- paid_at, paid_by.
    -- tab_id is also blocked unless move_order_to_tab() has signalled via
    -- vw.moving_order_tab that it is the one performing this UPDATE.
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


-- ════════════════════════════════════════════════════════════════════════════
-- PART F — open_tab(restaurant_id, table_number, note) → uuid
-- ════════════════════════════════════════════════════════════════════════════
--
-- Opens a new tab and returns its id.
--
-- Race safety:
--   pg_advisory_xact_lock(int, int) acquires an exclusive
--   transaction-level lock keyed on
--     (hashtext(restaurant_id), hashtext(business_day::text)).
--   Any concurrent open_tab call for the same restaurant on the same
--   business day blocks at this line until the holding transaction commits
--   or rolls back. The lock releases automatically — no explicit unlock.
--   The two-argument form (int, int) uses two independent 32-bit hashes,
--   giving a 64-bit key space with negligible collision risk across any
--   realistic number of restaurants.
--   After acquiring the lock: SELECT MAX(tab_number)+1 sees the row the
--   first caller just inserted, so the second caller gets 2, not 1 again.
--
-- Business day:
--   Mirrors business_day_window() logic exactly. If the local clock
--   (restaurant timezone) is before business_day_start, the active
--   business day started on the previous calendar date.

CREATE OR REPLACE FUNCTION public.open_tab(
  p_restaurant_id uuid,
  p_table_number  int  DEFAULT NULL,
  p_note          text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tz           text;
  v_start_time   time;
  v_is_owner     boolean;
  v_role         text;
  v_local_now    timestamp;
  v_local_time   time;
  v_business_day date;
  v_tab_number   int;
  v_tab_id       uuid;
BEGIN
  -- Load restaurant config and check ownership in one query.
  SELECT timezone, business_day_start,
         (owner_id = auth.uid())
  INTO   v_tz, v_start_time, v_is_owner
  FROM   public.restaurants
  WHERE  id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant % not found', p_restaurant_id;
  END IF;

  v_is_owner := COALESCE(v_is_owner, false);

  IF NOT v_is_owner THEN
    SELECT role
    INTO   v_role
    FROM   public.staff
    WHERE  id            = auth.uid()
      AND  restaurant_id = p_restaurant_id;
  END IF;

  IF NOT (v_is_owner OR v_role IN ('waiter', 'manager')) THEN
    RAISE EXCEPTION 'Not authorised to open a tab for this restaurant';
  END IF;

  -- Determine the current business day using restaurant-local time.
  v_local_now   := now() AT TIME ZONE v_tz;
  v_local_time  := v_local_now::time;
  v_business_day := v_local_now::date;

  IF v_local_time < v_start_time THEN
    v_business_day := v_business_day - 1;
  END IF;

  -- Serialise concurrent opens for this restaurant+day.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text),
    hashtext(v_business_day::text)
  );

  -- Safe to read MAX now — no concurrent open_tab can be here for the
  -- same (restaurant_id, business_day).
  SELECT COALESCE(MAX(tab_number), 0) + 1
  INTO   v_tab_number
  FROM   public.tabs
  WHERE  restaurant_id = p_restaurant_id
    AND  business_day  = v_business_day;

  INSERT INTO public.tabs (
    restaurant_id, tab_number, business_day,
    table_number, note, status,
    opened_by, opened_at
  ) VALUES (
    p_restaurant_id, v_tab_number, v_business_day,
    p_table_number, p_note, 'open',
    auth.uid(), now()
  )
  RETURNING id INTO v_tab_id;

  RETURN v_tab_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_tab(uuid, int, text) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PART G — settle_tab(tab_id, payment_method)
-- ════════════════════════════════════════════════════════════════════════════
--
-- One atomic transaction:
--   1. Locks the tab row (prevents concurrent settle calls).
--   2. Verifies the tab is open and the payment method is valid.
--   3. Checks authorisation: the waiter who opened the tab, any manager, or
--      the owner. A waiter who did not open the tab is not authorised.
--      (Tighter than the general enforce_payment_update rule, which allows
--      any waiter to mark an individual order paid.)
--   4. Locks all non-cancelled orders on the tab (prevents a concurrent
--      individual payment recording from racing with the bulk settlement).
--   5. Pre-flight: raises if ANY non-cancelled order has a pending
--      cancellation request. Nothing is paid until this check passes.
--   6. Pre-flight: raises if there are no unpaid non-cancelled orders.
--   7. Marks every non-cancelled unpaid order paid.
--      enforce_payment_update (BEFORE) fires per row:
--        — re-checks authorisation
--        — stamps paid_at = now() (PostgreSQL transaction time: identical
--          for every row in this transaction, so all orders get the same
--          paid_at)
--        — stamps paid_by = auth.uid() (also identical across all rows)
--      record_order_history (AFTER) fires per row:
--        — writes change_type='payment', field='is_paid'
--        — writes change_type='payment', field='payment_method'
--      This is identical to how a manually-recorded individual payment is
--      audited today.
--   8. Closes the tab.
--
-- Cancelled orders are skipped silently — they are never paid.
-- Already-paid orders are also skipped — the WHERE clause filters them.

CREATE OR REPLACE FUNCTION public.settle_tab(
  p_tab_id         uuid,
  p_payment_method text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tab          record;
  v_is_owner     boolean := false;
  v_role         text;
  v_unpaid_count int;
BEGIN
  -- Lock the tab row to prevent concurrent settlement calls.
  SELECT id, restaurant_id, status, opened_by
  INTO   v_tab
  FROM   public.tabs
  WHERE  id = p_tab_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tab % not found', p_tab_id;
  END IF;

  IF v_tab.status = 'closed' THEN
    RAISE EXCEPTION 'Tab is already closed';
  END IF;

  -- Validate payment method — same three values enforced on individual orders.
  IF p_payment_method NOT IN ('cash', 'transfer', 'pos') THEN
    RAISE EXCEPTION
      'Invalid payment method — must be one of: cash, transfer, pos';
  END IF;

  -- Authorisation: opener of the tab, any manager, or the owner.
  SELECT (owner_id = auth.uid())
  INTO   v_is_owner
  FROM   public.restaurants
  WHERE  id = v_tab.restaurant_id;

  v_is_owner := COALESCE(v_is_owner, false);

  IF NOT v_is_owner THEN
    SELECT role
    INTO   v_role
    FROM   public.staff
    WHERE  id            = auth.uid()
      AND  restaurant_id = v_tab.restaurant_id;
  END IF;

  IF NOT (
    v_is_owner
    OR v_role = 'manager'
    OR v_tab.opened_by = auth.uid()
  ) THEN
    RAISE EXCEPTION
      'Only the waiter who opened this tab, a manager, or the owner may settle it';
  END IF;

  -- Lock all non-cancelled orders on this tab before any reads or writes.
  -- Prevents a concurrent supabase.from('orders').update(...) call from
  -- paying one of these orders individually while we are mid-settlement.
  PERFORM id
  FROM   public.orders
  WHERE  tab_id = p_tab_id
    AND  status <> 'cancelled'
  FOR UPDATE;

  -- Pre-flight: any non-cancelled order with a pending cancellation request?
  -- This check runs before any UPDATE so a failed settlement leaves nothing
  -- partially paid.
  IF EXISTS (
    SELECT 1
    FROM   public.orders o
    JOIN   public.cancellation_requests cr ON cr.order_id = o.id
    WHERE  o.tab_id  = p_tab_id
      AND  o.status  <> 'cancelled'
      AND  cr.status  = 'pending'
  ) THEN
    RAISE EXCEPTION
      'Cannot settle tab — one or more orders have a pending cancellation '
      'request; the manager must decide those requests first';
  END IF;

  -- Pre-flight: at least one non-cancelled unpaid order must exist.
  SELECT COUNT(*)
  INTO   v_unpaid_count
  FROM   public.orders
  WHERE  tab_id  = p_tab_id
    AND  status  <> 'cancelled'
    AND  is_paid  = false;

  IF v_unpaid_count = 0 THEN
    RAISE EXCEPTION 'Tab has no unpaid orders to settle';
  END IF;

  -- Mark every non-cancelled unpaid order as paid.
  -- enforce_payment_update and record_order_history fire per row.
  UPDATE public.orders
  SET    is_paid        = true,
         payment_method = p_payment_method
  WHERE  tab_id  = p_tab_id
    AND  status  <> 'cancelled'
    AND  is_paid  = false;

  -- Close the tab.
  UPDATE public.tabs
  SET    status    = 'closed',
         closed_by = auth.uid(),
         closed_at = now()
  WHERE  id = p_tab_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_tab(uuid, text) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PART H — void_tab(tab_id, reason)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Closes a tab that has no non-cancelled orders and records the reason.
-- Use case: a waiter opened a tab in error, or a group left without ordering.
-- Caller must cancel or move all orders before calling void_tab().
--
-- Auth: manager or owner only. A waiter may not void a tab.
-- Reason: must be at least 3 characters (de-facto "something was typed" guard).
-- void_reason is stored on the tabs row itself. Managers query
--   SELECT * FROM tabs WHERE status = 'closed' AND void_reason IS NOT NULL
-- to see all voided tabs and why.

CREATE OR REPLACE FUNCTION public.void_tab(
  p_tab_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tab      record;
  v_is_owner boolean := false;
  v_role     text;
BEGIN
  -- Validate reason first (cheap, no locks).
  IF length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'void_tab: reason must be at least 3 characters';
  END IF;

  -- Lock the tab row.
  SELECT id, restaurant_id, status
  INTO   v_tab
  FROM   public.tabs
  WHERE  id = p_tab_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tab % not found', p_tab_id;
  END IF;

  IF v_tab.status = 'closed' THEN
    RAISE EXCEPTION 'Tab is already closed';
  END IF;

  -- Authorisation: manager or owner only.
  SELECT (owner_id = auth.uid())
  INTO   v_is_owner
  FROM   public.restaurants
  WHERE  id = v_tab.restaurant_id;

  v_is_owner := COALESCE(v_is_owner, false);

  IF NOT v_is_owner THEN
    SELECT role
    INTO   v_role
    FROM   public.staff
    WHERE  id            = auth.uid()
      AND  restaurant_id = v_tab.restaurant_id;
  END IF;

  IF NOT (v_is_owner OR v_role = 'manager') THEN
    RAISE EXCEPTION 'Only a manager or the owner may void a tab';
  END IF;

  -- A voidable tab has no non-cancelled orders.
  IF EXISTS (
    SELECT 1
    FROM   public.orders
    WHERE  tab_id = p_tab_id
      AND  status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION
      'Cannot void a tab that has non-cancelled orders; '
      'cancel or move all orders first';
  END IF;

  -- Close the tab and record the reason.
  UPDATE public.tabs
  SET    status      = 'closed',
         void_reason = p_reason,
         closed_by   = auth.uid(),
         closed_at   = now()
  WHERE  id = p_tab_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_tab(uuid, text) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PART I — move_order_to_tab(order_id, new_tab_id, reason)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Reassigns one non-cancelled order from its current tab to a different
-- open tab in the same restaurant. Writes two order_history rows:
--   change_type='assignment', field='tab_id'       — old and new tab ids
--   change_type='assignment', field='tab_move_reason' — the supplied reason
--
-- Auth: manager or owner only. Waiters may never move orders between tabs.
--
-- Lock ordering: target tab is locked first, then the order row.
-- This is consistent with settle_tab (tab first, orders second) and prevents
-- deadlocks between settle_tab and move_order_to_tab in concurrent calls.
--
-- Session flag: sets vw.moving_order_tab = 'true' (is_local) before the
-- UPDATE so that the tab_id guard in enforce_staff_order_update (normal path)
-- permits this one change. The flag is cleared automatically at transaction end.
-- The recompute narrow-window guard blocks tab_id unconditionally; a total
-- recompute never changes a tab assignment.

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
  -- Validate reason first (cheap, no locks).
  IF length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'move_order_to_tab: reason must be at least 3 characters';
  END IF;

  -- Lock target tab first — consistent lock ordering with settle_tab().
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

  -- Lock the order row second.
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

  -- Authorisation: manager or owner only.
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

  -- Signal enforce_staff_order_update to allow this tab_id change.
  -- is_local = true: flag clears automatically at transaction end.
  PERFORM set_config('vw.moving_order_tab', 'true', true);

  -- Reassign the order.
  UPDATE public.orders
  SET    tab_id = p_new_tab_id
  WHERE  id     = p_order_id;

  -- record_order_history does not track tab_id changes; write audit rows directly.
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


-- ════════════════════════════════════════════════════════════════════════════
-- PART J — RLS on tabs
-- ════════════════════════════════════════════════════════════════════════════
--
-- Staff (waiter, manager) and owners may SELECT tabs for their restaurant.
-- Anon has no policies — read and write are both blocked by RLS default deny.
-- No INSERT or UPDATE policies are defined: open_tab() and settle_tab() are
-- SECURITY DEFINER and bypass RLS. Direct INSERT is blocked, which also
-- enforces that tab_number allocation always goes through the race-safe
-- open_tab() function.

-- Staff (any role: waiter, manager) read tabs for their restaurant.
CREATE POLICY "staff_read_tabs"
  ON public.tabs
  FOR SELECT TO authenticated
  USING (
    restaurant_id = public.current_staff_restaurant()
    AND NOT public.is_any_device()
  );

-- Owners read tabs via the owner_id path (owners have no staff row).
CREATE POLICY "owner_read_tabs"
  ON public.tabs
  FOR SELECT TO authenticated
  USING (
    restaurant_id IN (
      SELECT id FROM public.restaurants WHERE owner_id = auth.uid()
    )
    AND NOT public.is_any_device()
  );


COMMIT;
