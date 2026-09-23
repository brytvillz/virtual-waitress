-- ============================================================
-- Migration 021 — payment recording and order history
--
-- Part A — Payment columns on orders
--   is_paid:  boolean flag — whether the order has been settled
--   paid_at:  timestamptz — set server-side by trigger on mark-paid
--   paid_by:  uuid — the auth user who marked it paid
--   payment_method already exists from 020; reused here, not added again.
--
-- Part B — order_history table
--   Immutable audit log for every status change, payment event, and
--   cancellation. Written only by the record_order_history trigger
--   (SECURITY DEFINER). Readable by owners and managers only.
--   No INSERT/UPDATE/DELETE policy: staff cannot write or delete rows.
--
-- Part C — enforce_payment_update (BEFORE UPDATE on orders)
--   Fine-grained payment gate:
--   - Blocked: cancelled orders, device sessions, unauthorised sessions
--   - Allowed to mark paid: waiter, manager, owner of this restaurant
--   - Reversal (is_paid true → false): manager or owner only, never waiter
--   - Sets paid_at / paid_by server-side; overwrites any client-supplied values
--   - Requires payment_method to be non-null before is_paid can be set true
--
-- Part D — record_order_history (AFTER UPDATE on orders)
--   Fires for every UPDATE that changes status, is_paid, or payment_method,
--   regardless of which screen triggered the write (admin panel, waiter app,
--   bar station screen). Captures auth.uid() as the actor.
--
-- Purely additive: no columns dropped, renamed, or altered.
-- No existing rows updated. Existing orders get is_paid = false.
-- ============================================================


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — Payment columns on orders
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_paid  boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at  timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — order_history table
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.order_history (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id      uuid        NOT NULL REFERENCES public.orders(id)      ON DELETE CASCADE,
  changed_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  change_type   text        NOT NULL
    CHECK (change_type IN ('status', 'payment', 'cancellation', 'creation', 'assignment')),
  field         text        NOT NULL,
  old_value     text,
  new_value     text,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_history ENABLE ROW LEVEL SECURITY;

-- 1. "Show me the full history of this one order"
CREATE INDEX IF NOT EXISTS idx_order_history_order_id
  ON public.order_history (order_id);

-- 2. "Show me all events for this restaurant, newest first"
CREATE INDEX IF NOT EXISTS idx_order_history_restaurant_time
  ON public.order_history (restaurant_id, changed_at DESC);

-- Owners can read all history rows for their restaurant.
CREATE POLICY "owner_read_order_history" ON public.order_history
  FOR SELECT TO authenticated
  USING (
    restaurant_id IN (
      SELECT id FROM public.restaurants WHERE owner_id = auth.uid()
    )
  );

-- Managers can read history rows for their restaurant.
-- current_staff_role() returns NULL for device sessions (excluded by design).
CREATE POLICY "manager_read_order_history" ON public.order_history
  FOR SELECT TO authenticated
  USING (
    restaurant_id = public.current_staff_restaurant()
    AND public.current_staff_role() = 'manager'
  );

-- No INSERT, UPDATE, or DELETE policies are defined.
-- Only the record_order_history trigger (SECURITY DEFINER) may write rows.


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — enforce_payment_update (BEFORE UPDATE)
-- ════════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER: internal lookups on restaurants and staff bypass RLS.
-- auth.uid() is session-local and reflects the actual caller even in
-- SECURITY DEFINER context — this is how auth.uid() works in Supabase.
--
-- Trigger name: trg_enforce_payment_update
-- Alphabetically between trg_enforce_device_order_update (d) and
-- trg_enforce_staff_order_update (s). For device sessions: the device
-- trigger has already validated status; this trigger fires next and blocks
-- device sessions from touching payment columns. For waiter/manager/owner
-- sessions: the device trigger passes through (is_active_device() = false),
-- this trigger validates the payment change, the staff trigger then validates
-- the column-header guards (party_label etc.) in the same row lock.

CREATE OR REPLACE FUNCTION public.enforce_payment_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role             text;
  v_is_owner         boolean := false;
  v_payment_changing boolean;
  v_paid_cancel      boolean;
BEGIN
  -- Determine which kind of change requires attention.
  v_payment_changing := (
    NEW.is_paid           IS DISTINCT FROM OLD.is_paid
    OR NEW.paid_at        IS DISTINCT FROM OLD.paid_at
    OR NEW.paid_by        IS DISTINCT FROM OLD.paid_by
    OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
  );

  -- A paid order is transitioning to cancelled.
  v_paid_cancel := (
    OLD.is_paid    = true
    AND OLD.status != 'cancelled'
    AND NEW.status  = 'cancelled'
  );

  -- Early exit: neither payment columns changing nor cancelling a paid order.
  IF NOT v_payment_changing AND NOT v_paid_cancel THEN
    RETURN NEW;
  END IF;

  -- Already-cancelled orders may not have payment changed.
  IF OLD.status = 'cancelled' AND v_payment_changing THEN
    RAISE EXCEPTION 'Cannot record or reverse payment on a cancelled order';
  END IF;

  -- Device sessions cannot record payment or cancel a paid order.
  IF public.is_active_device() THEN
    RAISE EXCEPTION 'Station screens cannot record payment or cancel a paid order';
  END IF;

  -- Determine whether the actor owns the restaurant.
  SELECT (owner_id = auth.uid())
  INTO   v_is_owner
  FROM   public.restaurants
  WHERE  id = NEW.restaurant_id;

  v_is_owner := COALESCE(v_is_owner, false);

  -- For non-owners, look up their staff role for this restaurant.
  IF NOT v_is_owner THEN
    SELECT role
    INTO   v_role
    FROM   public.staff
    WHERE  id            = auth.uid()
      AND  restaurant_id = NEW.restaurant_id;
  END IF;

  -- Cancelling a paid order requires manager or owner, never a waiter or device.
  IF v_paid_cancel THEN
    IF NOT (v_is_owner OR v_role = 'manager') THEN
      RAISE EXCEPTION 'Only a manager or owner may cancel a paid order';
    END IF;
    -- Cancellation is logged by record_order_history (status change to cancelled).
    -- If no payment columns are also changing, nothing more to do here.
    IF NOT v_payment_changing THEN
      RETURN NEW;
    END IF;
  END IF;

  -- From here: at least one payment column is changing.

  -- Only waiter, manager, or owner of this restaurant may touch payment.
  IF NOT (v_is_owner OR v_role IN ('waiter', 'manager')) THEN
    RAISE EXCEPTION 'Not authorised to record payment for this restaurant';
  END IF;

  -- Reversing payment (is_paid true → false) requires manager or owner.
  -- Also clears payment_method: an unpaid order must never display a method.
  IF OLD.is_paid = true AND NEW.is_paid = false THEN
    IF NOT (v_is_owner OR v_role = 'manager') THEN
      RAISE EXCEPTION 'Only a manager or owner may reverse a payment';
    END IF;
    NEW.payment_method := NULL;
  END IF;

  -- Marking paid (false → true): payment_method must already be set.
  IF NEW.is_paid = true AND (OLD.is_paid IS NULL OR OLD.is_paid = false) THEN
    IF NEW.payment_method IS NULL THEN
      RAISE EXCEPTION 'payment_method must be set before marking an order as paid';
    END IF;
  END IF;

  -- Force paid_at and paid_by from the trigger; never trust client values.
  -- is_paid true:  preserve existing values (idempotent), or set now on first mark.
  -- is_paid false: clear both. payment_method already cleared above on reversal.
  IF NEW.is_paid THEN
    NEW.paid_at := COALESCE(OLD.paid_at, now());
    NEW.paid_by := COALESCE(OLD.paid_by, auth.uid());
  ELSE
    NEW.paid_at := NULL;
    NEW.paid_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_payment_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_update();


-- ════════════════════════════════════════════════════════════════════════════
-- PART D — record_order_history (AFTER UPDATE)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Fires AFTER UPDATE so it sees the final committed values (after all BEFORE
-- triggers have applied server-side overrides such as paid_at and paid_by).
-- SECURITY DEFINER allows INSERT into order_history without an INSERT policy.
-- auth.uid() reflects the actual calling user even in SECURITY DEFINER —
-- the same session JWT is active throughout the transaction.
--
-- Tracks three fields: status, is_paid, payment_method.
-- Cancellations use change_type='cancellation' for easier end-of-night queries.

CREATE OR REPLACE FUNCTION public.record_order_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- Status change (cancellations get their own change_type for easier queries).
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_history
      (restaurant_id, order_id, changed_by, change_type, field, old_value, new_value)
    VALUES (
      NEW.restaurant_id,
      NEW.id,
      v_actor,
      CASE WHEN NEW.status = 'cancelled' THEN 'cancellation' ELSE 'status' END,
      'status',
      OLD.status,
      NEW.status
    );
  END IF;

  -- Payment flag change (marked paid or reversed).
  IF NEW.is_paid IS DISTINCT FROM OLD.is_paid THEN
    INSERT INTO public.order_history
      (restaurant_id, order_id, changed_by, change_type, field, old_value, new_value)
    VALUES (
      NEW.restaurant_id,
      NEW.id,
      v_actor,
      'payment',
      'is_paid',
      OLD.is_paid::text,
      NEW.is_paid::text
    );
  END IF;

  -- Payment method change (set, corrected, or cleared on reversal).
  IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
    INSERT INTO public.order_history
      (restaurant_id, order_id, changed_by, change_type, field, old_value, new_value)
    VALUES (
      NEW.restaurant_id,
      NEW.id,
      v_actor,
      'payment',
      'payment_method',
      OLD.payment_method,
      NEW.payment_method
    );
  END IF;

  -- Attribution change (waiter claimed the order, or attribution was set/corrected).
  IF NEW.handled_by IS DISTINCT FROM OLD.handled_by THEN
    INSERT INTO public.order_history
      (restaurant_id, order_id, changed_by, change_type, field, old_value, new_value)
    VALUES (
      NEW.restaurant_id,
      NEW.id,
      v_actor,
      'assignment',
      'handled_by',
      OLD.handled_by::text,
      NEW.handled_by::text
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_record_order_history
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.record_order_history();


-- ════════════════════════════════════════════════════════════════════════════
-- PART E — record_order_history_insert (AFTER INSERT)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Records order creation. Fires for every INSERT on orders, whether from
-- a customer (anon session, auth.uid() = NULL) or a waiter placing an order
-- on the customer's behalf (authenticated session, auth.uid() = waiter UID).
-- Two rows per order: table_number and total at time of creation.

CREATE OR REPLACE FUNCTION public.record_order_history_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.order_history
    (restaurant_id, order_id, changed_by, change_type, field, old_value, new_value)
  VALUES
    (NEW.restaurant_id, NEW.id, auth.uid(), 'creation', 'table_number', NULL, NEW.table_number::text),
    (NEW.restaurant_id, NEW.id, auth.uid(), 'creation', 'total',        NULL, NEW.total::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_record_order_history_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.record_order_history_insert();
