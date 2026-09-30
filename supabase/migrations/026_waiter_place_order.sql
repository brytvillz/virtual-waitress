-- ============================================================
-- MIGRATION 026: waiter_place_order RPC
--
-- Allows a waiter to place an order atomically from their phone.
-- The RPC wraps the order header + item inserts in one transaction
-- so a network failure mid-send cannot leave a stranded empty order.
--
-- ── Changes ─────────────────────────────────────────────────
-- A. enforce_waiter_order_header: also sets handled_by at INSERT
--    time so the creating waiter appears on the order immediately
--    (no waiting for a station device to claim it at 'preparing').
--
-- B. enforce_waiter_order_item_insert: removes the NULL-station
--    RAISE. NULL-station items (e.g. food at Ichiban, which has
--    no kitchen screen) are now orderable. Such items appear on
--    'all' devices only; they do not route to bar or kitchen.
--    The original guard assumed the waiter UI would hide untagged
--    items, which is no longer valid now that the waiter can build
--    orders directly from their phone.
--
-- C. waiter_place_order RPC: atomic order entry with full server-
--    side validation (caller role, item ownership, availability,
--    quantity bounds). Idempotent: safe to retry with the same
--    client_order_id on network failure.
--
-- ── Idempotency model ────────────────────────────────────────
-- First call:  inserts order header + all items → returns order id.
-- Retry (same client_order_id):
--   - Header INSERT hits the unique index → ignored (DO NOTHING).
--   - If items already exist → returns order id immediately (no
--     duplicate inserts).
--   - If items not yet inserted (crash mid-items) → inserts them.
-- ============================================================

BEGIN;


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — enforce_waiter_order_header: set handled_by at INSERT time
-- ════════════════════════════════════════════════════════════════════════════

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
    NEW.handled_by  := auth.uid();   -- attribute to creating waiter immediately
    NEW.source      := 'waiter';
    NEW.total       := 0;            -- recomputed by recompute_order_total as items arrive
    NEW.created_at  := now();
  END IF;
  RETURN NEW;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — enforce_waiter_order_item_insert: allow NULL-station items
-- ════════════════════════════════════════════════════════════════════════════

-- NULL station means the item has no dedicated station screen.
-- These items appear on 'all' devices only. Venues without a
-- kitchen screen (Ichiban) deliberately leave food items untagged;
-- blocking them entirely would be worse than routing them nowhere.

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

  -- NULL station is allowed: item will not route to any dedicated station
  -- screen but will appear on 'all' devices and in the waiter app.

  NEW.price   := v_price;
  NEW.station := v_station;

  RETURN NEW;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — waiter_place_order RPC
-- ════════════════════════════════════════════════════════════════════════════

-- Caller:       authenticated waiter (not a device, not a manager)
-- p_table_number: pass NULL for a Quick order (no table)
-- p_items:      JSON array of {menu_item_id, item_name, quantity}
-- RETURNS:      the order id (idempotent — same id on retry)
--
-- Validations (all server-side, before any INSERT):
--   1. Caller is a waiter (not device, not manager).
--   2. p_client_order_id is not null.
--   3. p_items is non-empty.
--   4. Each item has a menu_item_id.
--   5. Each quantity is an integer, 1–99.
--   6. Each menu_item_id belongs to current_staff_restaurant().
--   7. Each item is available at call time.
--
-- SECURITY DEFINER: runs as the function owner, bypassing RLS on
-- orders and order_items. All validation that RLS policies would
-- provide is reproduced explicitly in the function body.

CREATE OR REPLACE FUNCTION public.waiter_place_order(
  p_client_order_id uuid,
  p_table_number    int,
  p_items           jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_restaurant_id uuid;
  v_order_id      uuid;
  v_item          jsonb;
  v_menu_item_id  uuid;
  v_qty           int;
  v_item_name     text;
  v_available     boolean;
BEGIN
  -- Role checks (reproduces RLS waiter_insert_orders policy)
  IF public.current_staff_role() <> 'waiter' THEN
    RAISE EXCEPTION 'waiter_place_order: caller is not a waiter';
  END IF;
  IF public.is_any_device() THEN
    RAISE EXCEPTION 'waiter_place_order: devices may not place orders';
  END IF;

  v_restaurant_id := public.current_staff_restaurant();
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'waiter_place_order: caller has no restaurant';
  END IF;

  IF p_client_order_id IS NULL THEN
    RAISE EXCEPTION 'waiter_place_order: client_order_id is required';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'waiter_place_order: order must contain at least one item';
  END IF;

  -- Validate all items before touching orders (fail fast, no partial state)
  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    v_menu_item_id := (v_item->>'menu_item_id')::uuid;
    v_qty          := (v_item->>'quantity')::int;
    v_item_name    := v_item->>'item_name';

    IF v_menu_item_id IS NULL THEN
      RAISE EXCEPTION 'waiter_place_order: each item must include menu_item_id';
    END IF;

    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 99 THEN
      RAISE EXCEPTION 'waiter_place_order: quantity must be 1–99 (got %)',
        COALESCE(v_qty::text, 'null');
    END IF;

    SELECT available
    INTO   v_available
    FROM   public.menu_items
    WHERE  id            = v_menu_item_id
      AND  restaurant_id = v_restaurant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'waiter_place_order: item % does not belong to this restaurant',
        v_menu_item_id;
    END IF;

    IF NOT v_available THEN
      RAISE EXCEPTION 'waiter_place_order: "%" is not available',
        COALESCE(v_item_name, v_menu_item_id::text);
    END IF;
  END LOOP;

  -- Insert order header (idempotent on the partial unique index)
  INSERT INTO public.orders (restaurant_id, table_number, client_order_id)
  VALUES (v_restaurant_id, p_table_number, p_client_order_id)
  ON CONFLICT (restaurant_id, client_order_id) WHERE client_order_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_order_id;

  -- Conflict: order already exists — read the id back
  IF v_order_id IS NULL THEN
    SELECT id INTO v_order_id
    FROM   public.orders
    WHERE  restaurant_id   = v_restaurant_id
      AND  client_order_id = p_client_order_id;
  END IF;

  -- Items already present: order is complete — return idempotently
  IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order_id LIMIT 1) THEN
    RETURN v_order_id;
  END IF;

  -- Insert items in a single pass.
  -- enforce_waiter_order_item_insert (BEFORE trigger) fills price + station
  -- from menu_items, overwriting any client-supplied values.
  -- recompute_order_total (AFTER trigger) fires after each insert so by the
  -- time this function returns the total on orders is already correct.
  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    INSERT INTO public.order_items (order_id, menu_item_id, item_name, quantity)
    VALUES (
      v_order_id,
      (v_item->>'menu_item_id')::uuid,
      v_item->>'item_name',
      (v_item->>'quantity')::int
    );
  END LOOP;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.waiter_place_order(uuid, int, jsonb) TO authenticated;


COMMIT;
