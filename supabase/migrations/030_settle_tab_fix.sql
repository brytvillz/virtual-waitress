-- Migration 030 — settle_tab: allow closing a tab whose orders are all
-- already individually paid.
--
-- The original check raised an exception when v_unpaid_count = 0.  That
-- blocked a waiter who had already marked every order paid one by one from
-- closing the tab.  Removing the guard is safe: the UPDATE that pays unpaid
-- orders simply becomes a no-op, and the tab closes normally.
--
-- v_unpaid_count is removed from DECLARE since it is no longer referenced.

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
  v_tab      record;
  v_is_owner boolean := false;
  v_role     text;
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

  -- Mark every non-cancelled unpaid order as paid.
  -- enforce_payment_update and record_order_history fire per row.
  -- When all orders were already individually paid this UPDATE is a no-op;
  -- the tab still closes normally (the old guard that raised an exception here
  -- is intentionally removed — see migration 030 header).
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
