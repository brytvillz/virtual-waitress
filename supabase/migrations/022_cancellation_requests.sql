-- ============================================================
-- Migration 022 — cancellation requests
--
-- Gives waiters a formal path to request order cancellations
-- without being able to cancel orders themselves. Managers and
-- owners decide via SECURITY DEFINER functions. The decision
-- that approves a cancellation atomically cancels the order
-- and clears any recorded payment.
--
-- Part A — cancellation_requests table
--   Stores every request with its outcome. Multiple requests
--   per order are allowed (one pending at a time).
--
-- Part B — enforce_cancellation_request_insert (BEFORE INSERT)
--   Validates the request: order exists, order is not already
--   cancelled, no pending request already exists. Overwrites
--   requested_by, status, decided_by, decided_at, created_at
--   server-side so the client cannot spoof them.
--
-- Part C — enforce_cancellation_request_immutability (BEFORE UPDATE)
--   Blocks any update to a request that is already approved or
--   declined. Blocks changes to all immutable fields.
--
-- Part D — enforce_staff_order_update: block all direct cancellations
--   No staff session (waiter, manager) or owner may set
--   orders.status = 'cancelled' by direct UPDATE. Every
--   cancellation must carry a reason, enforced by this guard.
--   cancel_order() and approve_cancellation_request() set the
--   session flag vw.cancelling_order before their UPDATE on
--   orders so this guard lets them through.
--
-- Part E — cancel_order(order_id uuid, reason text) SECURITY DEFINER
--   The direct-cancel path for managers and owners. Validates
--   the caller, requires a non-blank reason, cancels the order,
--   and clears payment if it was paid — identical to
--   approve_cancellation_request in effect. No cancellation_requests
--   row is created.
--
-- Part F — approve_cancellation_request(uuid) SECURITY DEFINER
--   One atomic operation: marks the request approved, cancels
--   the order, and (if the order was paid) clears the payment.
--   enforce_payment_update (021) handles paid_at/paid_by clearing.
--   record_order_history writes the cancellation, payment events,
--   and the cancellation reason to order_history.
--
-- Part G — decline_cancellation_request(uuid) SECURITY DEFINER
--   Marks the request declined. Order is unchanged.
--
-- Part H — enforce_payment_update replacement (from 021)
--   Adds one guard to the existing function: refuse to mark an
--   order paid while a cancellation request is pending for it.
--
-- Part I — record_order_history replacement (from 021)
--   Adds a second order_history row for cancellations: reads the
--   reason from the session variable vw.cancel_reason (set by
--   cancel_order and approve_cancellation_request) and writes it
--   as change_type='cancellation', field='reason'.
--
-- Part J — RLS policies
--   INSERT: waiters for their own restaurant only.
--   SELECT: staff (any role) and owners for their restaurant.
--   UPDATE/DELETE: no policies — direct writes are blocked;
--   the SECURITY DEFINER functions are the only update path.
--
-- Session variables (is_local = true, cleared at transaction end):
--   vw.cancelling_order  set 'true' by cancel_order() and
--                        approve_cancellation_request() around
--                        their UPDATE on orders; lets
--                        enforce_staff_order_update pass through.
--   vw.cancel_reason     the reason text, read by
--                        record_order_history to write the
--                        second history row.
--
-- Purely additive: no existing tables dropped. enforce_staff_order_update,
-- enforce_payment_update, and record_order_history are replaced in place
-- (CREATE OR REPLACE).
-- ============================================================


BEGIN;


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — cancellation_requests table
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cancellation_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id       uuid        NOT NULL REFERENCES public.orders(id)      ON DELETE CASCADE,
  -- requested_by is always a waiter; waiter auth UID = staff.id in this schema.
  requested_by   uuid        NOT NULL REFERENCES public.staff(id)       ON DELETE SET NULL,
  reason         text        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined')),
  -- decided_by can be a manager (staff row) or an owner (no staff row),
  -- so it references auth.users rather than staff.
  decided_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cancellation_requests ENABLE ROW LEVEL SECURITY;

-- "Show me all requests for this order" — used by admin orders page and
-- by the trigger's duplicate-pending check.
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_order_id
  ON public.cancellation_requests (order_id);

-- "Show me all open requests for this restaurant" — the manager's queue.
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_restaurant_time
  ON public.cancellation_requests (restaurant_id, created_at DESC);

-- Enforce at most one pending request per order at the database level.
-- This index exists only for rows where status = 'pending'; rows that
-- transition to approved or declined leave the index, allowing a new
-- pending request for the same order to be submitted.
CREATE UNIQUE INDEX IF NOT EXISTS cancellation_requests_one_pending_per_order
  ON public.cancellation_requests (order_id)
  WHERE status = 'pending';


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — enforce_cancellation_request_insert (BEFORE INSERT)
-- ════════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER so the trigger can query orders without relying on
-- the calling session's own SELECT policies.
-- auth.uid() is session-local and reflects the actual caller even in
-- SECURITY DEFINER context.

CREATE OR REPLACE FUNCTION public.enforce_cancellation_request_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_order_restaurant uuid;
  v_order_status     text;
BEGIN
  -- Validate the target order.
  SELECT restaurant_id, status
  INTO   v_order_restaurant, v_order_status
  FROM   public.orders
  WHERE  id = NEW.order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % does not exist', NEW.order_id;
  END IF;

  IF v_order_restaurant <> NEW.restaurant_id THEN
    RAISE EXCEPTION 'Order does not belong to restaurant %', NEW.restaurant_id;
  END IF;

  IF v_order_status = 'cancelled' THEN
    RAISE EXCEPTION 'Order is already cancelled';
  END IF;

  -- Reason must not be blank.
  IF trim(NEW.reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to submit a cancellation request';
  END IF;

  -- Prevent duplicate pending requests (belt-and-braces alongside the
  -- unique partial index on (order_id) WHERE status = 'pending').
  IF EXISTS (
    SELECT 1 FROM public.cancellation_requests
    WHERE  order_id = NEW.order_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION
      'A pending cancellation request already exists for this order — '
      'wait for the manager to decide before submitting a new one';
  END IF;

  -- Server-side field overrides — client cannot spoof these values.
  NEW.requested_by := auth.uid();
  NEW.status       := 'pending';
  NEW.decided_by   := NULL;
  NEW.decided_at   := NULL;
  NEW.created_at   := now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cancellation_request_insert
  BEFORE INSERT ON public.cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cancellation_request_insert();


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — enforce_cancellation_request_immutability (BEFORE UPDATE)
-- ════════════════════════════════════════════════════════════════════════════
--
-- The SECURITY DEFINER functions in Parts F and G are the only intended
-- UPDATE path. This trigger provides belt-and-braces protection against
-- direct UPDATE statements (e.g. from psql or a rogue client).

CREATE OR REPLACE FUNCTION public.enforce_cancellation_request_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  -- A decided request is permanently closed.
  IF OLD.status IN ('approved', 'declined') THEN
    RAISE EXCEPTION
      'Cancellation request has already been % and may not be changed', OLD.status;
  END IF;

  -- Immutable fields may never change on any request.
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
  OR NEW.order_id      IS DISTINCT FROM OLD.order_id
  OR NEW.requested_by  IS DISTINCT FROM OLD.requested_by
  OR NEW.reason        IS DISTINCT FROM OLD.reason
  OR NEW.created_at    IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'Cancellation request fields are immutable — only the status '
      'decision (via approve/decline functions) may be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cancellation_request_immutability
  BEFORE UPDATE ON public.cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cancellation_request_immutability();


-- ════════════════════════════════════════════════════════════════════════════
-- PART D — enforce_staff_order_update: block all direct cancellations
-- ════════════════════════════════════════════════════════════════════════════
--
-- Replaces the migration 020 body with one change: a universal cancellation
-- guard placed before the role check, so it covers waiters, managers, AND
-- owners (all non-device sessions). The guard checks the session flag
-- vw.cancelling_order, which cancel_order() and approve_cancellation_request()
-- set to 'true' before their UPDATE on orders. When the flag is set, the
-- guard is skipped and the cancellation proceeds.
--
-- The migration 022 original (waiter-only block) is replaced entirely.
-- The trigger trg_enforce_staff_order_update already exists from migration 018;
-- CREATE OR REPLACE on the function takes effect immediately.

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
  -- cancel_order() and approve_cancellation_request() set vw.cancelling_order
  -- = 'true' (is_local) before their UPDATE on orders; the guard lets them
  -- through. Any other caller — waiter, manager, owner — hits this exception.
  -- IS DISTINCT FROM handles NULL (flag not set) the same as a non-'true' value.
  IF current_setting('vw.cancelling_order', true) IS DISTINCT FROM 'true'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'cancelled'
  THEN
    RAISE EXCEPTION
      'Orders cannot be cancelled by a direct UPDATE — use cancel_order() '
      'or approve_cancellation_request() so the reason is recorded';
  END IF;

  -- Only apply column guards to waiter and manager sessions.
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
    -- Allowed: status (for managers via cancel_order), handled_by, prepared_at,
    --          ready_at, served_at, payment_method, is_paid, paid_at, paid_by.
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


-- ════════════════════════════════════════════════════════════════════════════
-- PART E — cancel_order(order_id uuid, reason text) SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════════════
--
-- Direct-cancel path for managers and owners. Requires a non-blank reason.
-- No cancellation_requests row is created. The reason lands in order_history
-- via the vw.cancel_reason session variable read by record_order_history.
--
-- Payment clearing: same as approve_cancellation_request — sets is_paid=false
-- and payment_method=NULL in the same UPDATE. enforce_payment_update (BEFORE)
-- handles paid_at/paid_by. record_order_history (AFTER) writes the
-- cancellation history rows, including the reason.

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_restaurant_id uuid;
  v_order_stat    text;
  v_is_owner      boolean := false;
  v_role          text;
BEGIN
  IF trim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'A reason is required to cancel an order';
  END IF;

  SELECT restaurant_id, status
  INTO   v_restaurant_id, v_order_stat
  FROM   public.orders
  WHERE  id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  IF v_order_stat = 'cancelled' THEN
    RAISE EXCEPTION 'Order is already cancelled';
  END IF;

  -- Verify caller is owner or manager of this restaurant.
  SELECT (owner_id = auth.uid())
  INTO   v_is_owner
  FROM   public.restaurants
  WHERE  id = v_restaurant_id;

  v_is_owner := COALESCE(v_is_owner, false);

  IF NOT v_is_owner THEN
    SELECT role
    INTO   v_role
    FROM   public.staff
    WHERE  id            = auth.uid()
      AND  restaurant_id = v_restaurant_id;
  END IF;

  IF NOT (v_is_owner OR v_role = 'manager') THEN
    RAISE EXCEPTION 'Only a manager or owner may cancel an order';
  END IF;

  -- Signal to enforce_staff_order_update that this cancellation is authorised,
  -- and pass the reason to record_order_history for the history row.
  -- Both are is_local=true and clear automatically at transaction end.
  PERFORM set_config('vw.cancelling_order', 'true',    true);
  PERFORM set_config('vw.cancel_reason',    p_reason,  true);

  -- Cancel the order, clearing payment if it was paid.
  -- enforce_payment_update (BEFORE) validates the paid-cancel path and
  -- clears paid_at/paid_by. record_order_history (AFTER) writes the events.
  UPDATE public.orders
  SET    status         = 'cancelled',
         is_paid        = false,
         payment_method = NULL
  WHERE  id = p_order_id;

  PERFORM set_config('vw.cancelling_order', 'false', true);
  PERFORM set_config('vw.cancel_reason',    '',      true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PART F — approve_cancellation_request(uuid) SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════════════
--
-- One atomic operation:
--   1. Locks the request row (prevents concurrent approvals).
--   2. Verifies the caller is a manager or owner of that restaurant.
--   3. Marks the request approved with decided_by and decided_at.
--   4. Sets vw.cancelling_order and vw.cancel_reason, then cancels the
--      order (and clears payment if paid) in a single UPDATE.
--
-- Downstream effects on the order UPDATE:
--   enforce_payment_update (BEFORE, 021) — if paid, validates caller,
--     clears paid_at/paid_by. If unpaid, early-exits (no-op).
--   record_order_history (AFTER, 021/022) — writes the status change,
--     any payment events, and (via vw.cancel_reason) the reason row.

CREATE OR REPLACE FUNCTION public.approve_cancellation_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_req        record;
  v_is_owner   boolean := false;
  v_role       text;
  v_order_stat text;
BEGIN
  -- Lock the request row to serialise concurrent calls.
  SELECT id, restaurant_id, order_id, status, reason
  INTO   v_req
  FROM   public.cancellation_requests
  WHERE  id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cancellation request % not found', p_request_id;
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION
      'Cancellation request has already been % — cannot approve again',
      v_req.status;
  END IF;

  -- Verify caller is owner or manager of this restaurant.
  SELECT (owner_id = auth.uid())
  INTO   v_is_owner
  FROM   public.restaurants
  WHERE  id = v_req.restaurant_id;

  v_is_owner := COALESCE(v_is_owner, false);

  IF NOT v_is_owner THEN
    SELECT role
    INTO   v_role
    FROM   public.staff
    WHERE  id            = auth.uid()
      AND  restaurant_id = v_req.restaurant_id;
  END IF;

  IF NOT (v_is_owner OR v_role = 'manager') THEN
    RAISE EXCEPTION 'Only a manager or owner may approve a cancellation request';
  END IF;

  -- Mark the request approved.
  UPDATE public.cancellation_requests
  SET    status     = 'approved',
         decided_by = auth.uid(),
         decided_at = now()
  WHERE  id = p_request_id;

  -- Fetch the current order status.
  SELECT status
  INTO   v_order_stat
  FROM   public.orders
  WHERE  id = v_req.order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', v_req.order_id;
  END IF;

  -- Cancel the order if not already done.
  IF v_order_stat <> 'cancelled' THEN
    -- Pass the reason to record_order_history via session config.
    -- vw.cancelling_order lets enforce_staff_order_update pass through.
    PERFORM set_config('vw.cancelling_order', 'true',       true);
    PERFORM set_config('vw.cancel_reason',    v_req.reason, true);

    UPDATE public.orders
    SET    status         = 'cancelled',
           is_paid        = false,
           payment_method = NULL
    WHERE  id = v_req.order_id;

    PERFORM set_config('vw.cancelling_order', 'false', true);
    PERFORM set_config('vw.cancel_reason',    '',      true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_cancellation_request(uuid) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PART G — decline_cancellation_request(uuid) SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════════════
--
-- Marks the request declined. The order is not touched. The waiter may
-- submit a new request for the same order after a decline (the pending
-- unique index no longer blocks once this row moves to 'declined').

CREATE OR REPLACE FUNCTION public.decline_cancellation_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_req       record;
  v_is_owner  boolean := false;
  v_role      text;
BEGIN
  SELECT id, restaurant_id, status
  INTO   v_req
  FROM   public.cancellation_requests
  WHERE  id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cancellation request % not found', p_request_id;
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION
      'Cancellation request has already been % — cannot decline again',
      v_req.status;
  END IF;

  SELECT (owner_id = auth.uid())
  INTO   v_is_owner
  FROM   public.restaurants
  WHERE  id = v_req.restaurant_id;

  v_is_owner := COALESCE(v_is_owner, false);

  IF NOT v_is_owner THEN
    SELECT role
    INTO   v_role
    FROM   public.staff
    WHERE  id            = auth.uid()
      AND  restaurant_id = v_req.restaurant_id;
  END IF;

  IF NOT (v_is_owner OR v_role = 'manager') THEN
    RAISE EXCEPTION 'Only a manager or owner may decline a cancellation request';
  END IF;

  UPDATE public.cancellation_requests
  SET    status     = 'declined',
         decided_by = auth.uid(),
         decided_at = now()
  WHERE  id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_cancellation_request(uuid) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PART H — enforce_payment_update replacement (from migration 021)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Adds one guard to the existing migration 021 body: refuse to set
-- is_paid = true while a cancellation request is pending for the order.
--
-- The guard sits inside the "marking paid (false → true)" block, after
-- the payment_method check. It queries cancellation_requests, which exists
-- after migration 022 has been applied (this function replaces the 021
-- version in place, so the table is guaranteed to exist when it runs).
--
-- All other behaviour is identical to the 021 body.

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
  v_payment_changing := (
    NEW.is_paid           IS DISTINCT FROM OLD.is_paid
    OR NEW.paid_at        IS DISTINCT FROM OLD.paid_at
    OR NEW.paid_by        IS DISTINCT FROM OLD.paid_by
    OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
  );

  v_paid_cancel := (
    OLD.is_paid    = true
    AND OLD.status != 'cancelled'
    AND NEW.status  = 'cancelled'
  );

  IF NOT v_payment_changing AND NOT v_paid_cancel THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'cancelled' AND v_payment_changing THEN
    RAISE EXCEPTION 'Cannot record or reverse payment on a cancelled order';
  END IF;

  IF public.is_active_device() THEN
    RAISE EXCEPTION 'Station screens cannot record payment or cancel a paid order';
  END IF;

  SELECT (owner_id = auth.uid())
  INTO   v_is_owner
  FROM   public.restaurants
  WHERE  id = NEW.restaurant_id;

  v_is_owner := COALESCE(v_is_owner, false);

  IF NOT v_is_owner THEN
    SELECT role
    INTO   v_role
    FROM   public.staff
    WHERE  id            = auth.uid()
      AND  restaurant_id = NEW.restaurant_id;
  END IF;

  IF v_paid_cancel THEN
    IF NOT (v_is_owner OR v_role = 'manager') THEN
      RAISE EXCEPTION 'Only a manager or owner may cancel a paid order';
    END IF;
    IF NOT v_payment_changing THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NOT (v_is_owner OR v_role IN ('waiter', 'manager')) THEN
    RAISE EXCEPTION 'Not authorised to record payment for this restaurant';
  END IF;

  IF OLD.is_paid = true AND NEW.is_paid = false THEN
    IF NOT (v_is_owner OR v_role = 'manager') THEN
      RAISE EXCEPTION 'Only a manager or owner may reverse a payment';
    END IF;
    NEW.payment_method := NULL;
  END IF;

  -- Marking paid (false → true): payment_method must be set, and no
  -- cancellation request may be pending for this order.
  IF NEW.is_paid = true AND (OLD.is_paid IS NULL OR OLD.is_paid = false) THEN
    IF NEW.payment_method IS NULL THEN
      RAISE EXCEPTION 'payment_method must be set before marking an order as paid';
    END IF;
    -- Block payment while a cancellation is under review.
    IF EXISTS (
      SELECT 1 FROM public.cancellation_requests
      WHERE  order_id = NEW.id AND status = 'pending'
    ) THEN
      RAISE EXCEPTION
        'Cannot record payment — a cancellation request is pending for this '
        'order; the manager must decide the request first';
    END IF;
  END IF;

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


-- ════════════════════════════════════════════════════════════════════════════
-- PART I — record_order_history replacement (from migration 021)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Adds a second INSERT for cancellations: reads the reason from the
-- session variable vw.cancel_reason (set by cancel_order and
-- approve_cancellation_request) and writes it as a separate order_history
-- row with change_type='cancellation', field='reason', old_value=NULL.
-- The existing status-change row is unchanged.
--
-- If vw.cancel_reason is not set or is empty, the reason row is not
-- written. This is a safety fallback only; both cancel paths always
-- set the variable.

CREATE OR REPLACE FUNCTION public.record_order_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor         uuid := auth.uid();
  v_cancel_reason text;
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

    -- Reason row — written alongside the status row for every cancellation.
    -- Readable without joining cancellation_requests.
    IF NEW.status = 'cancelled' THEN
      v_cancel_reason := NULLIF(current_setting('vw.cancel_reason', true), '');
      IF v_cancel_reason IS NOT NULL THEN
        INSERT INTO public.order_history
          (restaurant_id, order_id, changed_by, change_type, field, old_value, new_value)
        VALUES (
          NEW.restaurant_id,
          NEW.id,
          v_actor,
          'cancellation',
          'reason',
          NULL,
          v_cancel_reason
        );
      END IF;
    END IF;
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


-- ════════════════════════════════════════════════════════════════════════════
-- PART J — RLS policies
-- ════════════════════════════════════════════════════════════════════════════

-- Waiters insert cancellation requests for their own restaurant only.
CREATE POLICY "waiter_insert_cancellation_requests"
  ON public.cancellation_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.current_staff_restaurant()
    AND public.current_staff_role() = 'waiter'
    AND NOT public.is_any_device()
  );

-- Staff (any role: waiter, manager) read requests for their restaurant.
CREATE POLICY "staff_read_cancellation_requests"
  ON public.cancellation_requests
  FOR SELECT TO authenticated
  USING (
    restaurant_id = public.current_staff_restaurant()
    AND NOT public.is_any_device()
  );

-- Owners read requests via the owner_id path (no staff row for owners).
CREATE POLICY "owner_read_cancellation_requests"
  ON public.cancellation_requests
  FOR SELECT TO authenticated
  USING (
    restaurant_id IN (
      SELECT id FROM public.restaurants WHERE owner_id = auth.uid()
    )
    AND NOT public.is_any_device()
  );

-- No UPDATE or DELETE policies are defined.
-- Direct writes are blocked by default (RLS deny-by-default).
-- approve_cancellation_request() and decline_cancellation_request()
-- are the only legitimate update path (SECURITY DEFINER bypasses RLS).


COMMIT;
