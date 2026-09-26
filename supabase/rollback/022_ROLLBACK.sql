-- ============================================================
-- ROLLBACK for migration 022_cancellation_requests.sql
--
-- *** DATA SAFETY WARNING ***
-- Drops cancellation_requests — all pending and decided requests
-- are permanently lost. Only safe before any production use.
--
-- HOW TO USE
-- Supabase Dashboard → SQL Editor, or:
--   psql $DATABASE_URL -f supabase/rollback/022_ROLLBACK.sql
-- Do NOT place in supabase/migrations/ — the runner would apply it.
--
-- Verify after rollback:
--   SELECT to_regclass('public.cancellation_requests');
--   Expected: NULL.
--
--   SELECT p.proname FROM pg_proc p
--   WHERE  p.proname IN (
--     'approve_cancellation_request',
--     'decline_cancellation_request',
--     'cancel_order',
--     'enforce_cancellation_request_insert',
--     'enforce_cancellation_request_immutability'
--   );
--   Expected: 0 rows.
--
-- After this rollback:
--   • Orders can be cancelled by direct UPDATE again (pre-022 behaviour).
--   • Payment can be recorded regardless of cancellation request state.
--   • order_history cancellation rows will not include a reason row.
-- ============================================================

BEGIN;

-- ── Step 1: Drop SECURITY DEFINER decision/cancel functions ─────────────────
DROP FUNCTION IF EXISTS public.approve_cancellation_request(uuid);
DROP FUNCTION IF EXISTS public.decline_cancellation_request(uuid);
DROP FUNCTION IF EXISTS public.cancel_order(uuid, text);

-- ── Step 2: Drop cancellation_requests table ────────────────────────────────
-- CASCADE removes the dependent triggers (trg_cancellation_request_insert,
-- trg_cancellation_request_immutability), indexes, and RLS policies.
DROP TABLE IF EXISTS public.cancellation_requests CASCADE;

-- ── Step 3: Drop trigger functions (table CASCADE does not drop them) ────────
DROP FUNCTION IF EXISTS public.enforce_cancellation_request_insert();
DROP FUNCTION IF EXISTS public.enforce_cancellation_request_immutability();

-- ── Step 4: Restore enforce_staff_order_update to migration 020 body ─────────
-- Removes the universal cancellation guard added in 022.
-- Waiters and managers can cancel orders by direct UPDATE again.
-- This is the exact function body as left by migration 020.
CREATE OR REPLACE FUNCTION public.enforce_staff_order_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  IF public.is_any_device() THEN
    RETURN NEW;
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

-- ── Step 5: Restore enforce_payment_update to migration 021 body ─────────────
-- Removes the pending-cancellation-request check added in 022.
-- Payment can be recorded regardless of pending requests again.
-- This is the exact function body as left by migration 021.
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

  IF NEW.is_paid = true AND (OLD.is_paid IS NULL OR OLD.is_paid = false) THEN
    IF NEW.payment_method IS NULL THEN
      RAISE EXCEPTION 'payment_method must be set before marking an order as paid';
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

-- ── Step 6: Restore record_order_history to migration 021 body ───────────────
-- Removes the cancellation reason row added in 022.
-- order_history will no longer write a field='reason' row on cancellation.
-- This is the exact function body as left by migration 021.
CREATE OR REPLACE FUNCTION public.record_order_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
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

COMMIT;
