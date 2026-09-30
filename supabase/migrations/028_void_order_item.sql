-- ============================================================
-- MIGRATION 028 — direct void of a single order-item line
--
-- Replaces the old request-and-approve flow (void_requests table,
-- void_requested status) for the common case where the waiter simply
-- needs to remove a wrong or cancelled item from the bill immediately,
-- with a reason recorded in the open.
--
-- Who may void
--   The waiter who placed the round (orders.handled_by = auth.uid())
--   OR the opener of the tab that round belongs to (tabs.opened_by)
--   OR any manager at this restaurant
--   OR the restaurant owner
--
-- Refused when
--   The order is already paid (is_paid = true)
--   The order is cancelled
--   A cancellation_request with status = 'pending' exists for the order
--   The item is already voided
--   The reason is blank or shorter than 3 characters
--
-- voided_while_served
--   Set true when the order status is 'preparing', 'served', or
--   'completed' at the moment of void. These are the "drink left the
--   bar" voids that an owner needs to look at separately.
--
-- Mechanics
--   Uses set_config('vw.resolving_void', 'true', true) — the same
--   session-local flag used by the old void_request triggers — to
--   bypass enforce_order_item_immutable during the UPDATE.
--   recompute_order_total already excludes voided items, so the order
--   total drops automatically via the existing AFTER trigger.
--   Writes one row to order_history with change_type = 'void'.
-- ============================================================

BEGIN;


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — void columns on order_items
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS void_reason        text,
  ADD COLUMN IF NOT EXISTS voided_by          uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_at          timestamptz,
  ADD COLUMN IF NOT EXISTS voided_while_served boolean;


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — extend order_history.change_type to include 'void'
-- ════════════════════════════════════════════════════════════════════════════
--
-- Postgres names auto-generated CHECK constraints as
-- <table>_<column>_check. Drop by that name and recreate with 'void'
-- added. The DROP uses IF EXISTS so it is safe even if the name differs.

ALTER TABLE public.order_history
  DROP CONSTRAINT IF EXISTS order_history_change_type_check;

ALTER TABLE public.order_history
  ADD CONSTRAINT order_history_change_type_check
    CHECK (change_type IN (
      'status', 'payment', 'cancellation', 'creation', 'assignment', 'void'
    ));


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — void_order_item RPC
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.void_order_item(
  p_order_item_id uuid,
  p_reason        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_order_id        uuid;
  v_restaurant_id   uuid;
  v_handled_by      uuid;
  v_tab_id          uuid;
  v_tab_opener      uuid;
  v_order_status    text;
  v_is_paid         boolean;
  v_item_status     text;
  v_item_name       text;
  v_quantity        int;
  v_price           numeric;
  v_is_owner        boolean;
  v_role            text;
  v_while_served    boolean;
  v_cancel_pending  boolean;
BEGIN
  -- Minimum reason length
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'void_order_item: reason must be at least 3 characters';
  END IF;

  -- Load item + its parent order in one query
  SELECT oi.order_id,  oi.item_status, oi.item_name, oi.quantity, oi.price,
         o.restaurant_id, o.handled_by, o.tab_id,
         o.status,     o.is_paid
  INTO   v_order_id,   v_item_status,  v_item_name,  v_quantity,  v_price,
         v_restaurant_id, v_handled_by, v_tab_id,
         v_order_status, v_is_paid
  FROM   public.order_items oi
  JOIN   public.orders      o ON o.id = oi.order_id
  WHERE  oi.id = p_order_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_order_item: item not found';
  END IF;

  -- Hard refusals
  IF v_is_paid THEN
    RAISE EXCEPTION 'void_order_item: cannot void an item on a paid order';
  END IF;

  IF v_order_status = 'cancelled' THEN
    RAISE EXCEPTION 'void_order_item: cannot void an item on a cancelled order';
  END IF;

  IF v_item_status = 'voided' THEN
    RAISE EXCEPTION 'void_order_item: item is already voided';
  END IF;

  -- Block while a cancellation request is pending on this order
  SELECT EXISTS (
    SELECT 1 FROM public.cancellation_requests
    WHERE  order_id = v_order_id
      AND  status   = 'pending'
  ) INTO v_cancel_pending;

  IF v_cancel_pending THEN
    RAISE EXCEPTION 'void_order_item: a cancellation request is pending for this order — resolve it first';
  END IF;

  -- Authorisation: owner, manager, order creator, or tab opener
  SELECT (owner_id = auth.uid())
  INTO   v_is_owner
  FROM   public.restaurants
  WHERE  id = v_restaurant_id;
  v_is_owner := COALESCE(v_is_owner, false);

  IF NOT v_is_owner THEN
    SELECT role INTO v_role
    FROM   public.staff
    WHERE  id            = auth.uid()
      AND  restaurant_id = v_restaurant_id;
  END IF;

  IF v_tab_id IS NOT NULL THEN
    SELECT opened_by INTO v_tab_opener
    FROM   public.tabs
    WHERE  id = v_tab_id;
  END IF;

  IF NOT (
    v_is_owner                                          OR
    v_role = 'manager'                                  OR
    v_handled_by = auth.uid()                           OR
    (v_tab_opener IS NOT NULL AND v_tab_opener = auth.uid())
  ) THEN
    RAISE EXCEPTION 'void_order_item: not authorised to void this item';
  END IF;

  -- "Drink left the bar" flag: order was already being prepared or served
  v_while_served := v_order_status IN ('preparing', 'served', 'completed');

  -- Bypass enforce_order_item_immutable using the existing session flag
  PERFORM set_config('vw.resolving_void', 'true', true);

  UPDATE public.order_items
  SET    item_status         = 'voided',
         void_reason         = trim(p_reason),
         voided_by           = auth.uid(),
         voided_at           = now(),
         voided_while_served = v_while_served
  WHERE  id = p_order_item_id;

  PERFORM set_config('vw.resolving_void', 'false', true);

  -- Audit trail in order_history
  -- field  : "<item_name> ×<qty> · before/after serving"
  -- new_value : the reason
  INSERT INTO public.order_history
    (restaurant_id, order_id, changed_by, change_type, field, old_value, new_value)
  VALUES (
    v_restaurant_id,
    v_order_id,
    auth.uid(),
    'void',
    v_item_name || ' ×' || v_quantity::text
      || ' · ' || CASE WHEN v_while_served THEN 'after serving' ELSE 'before serving' END,
    'active',
    trim(p_reason)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_order_item(uuid, text) TO authenticated;


COMMIT;
