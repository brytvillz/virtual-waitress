-- ============================================================
-- ROLLBACK for migration 027_tabs_idempotency
--
-- Reverses all four parts:
--   D. Drop waiter_place_order(uuid,int,jsonb,uuid) and restore
--      the 3-argument 026 body.
--   C. Drop open_tab(uuid,int,text,uuid) and restore the
--      3-argument 024 body.
--   B. Remove public.tabs from supabase_realtime publication.
--   A. Drop tabs_client_idempotency index and client_tab_id column.
--
-- WARNING: rows that already have a client_tab_id value are NOT
-- backed up. Those UUIDs are discarded when the column is dropped.
-- Rolling back only affects future opens; tabs already created with
-- a client_tab_id keep working (the column is gone but the tab rows
-- themselves are unaffected).
-- ============================================================

BEGIN;


-- ── D. Restore waiter_place_order (3-argument, no p_tab_id) ──────────────────

DROP FUNCTION IF EXISTS public.waiter_place_order(uuid, int, jsonb, uuid);

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

  INSERT INTO public.orders (restaurant_id, table_number, client_order_id)
  VALUES (v_restaurant_id, p_table_number, p_client_order_id)
  ON CONFLICT (restaurant_id, client_order_id) WHERE client_order_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT id INTO v_order_id
    FROM   public.orders
    WHERE  restaurant_id   = v_restaurant_id
      AND  client_order_id = p_client_order_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order_id LIMIT 1) THEN
    RETURN v_order_id;
  END IF;

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


-- ── C. Restore open_tab (3-argument, no p_client_tab_id) ─────────────────────

DROP FUNCTION IF EXISTS public.open_tab(uuid, int, text, uuid);

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

  v_local_now    := now() AT TIME ZONE v_tz;
  v_local_time   := v_local_now::time;
  v_business_day := v_local_now::date;

  IF v_local_time < v_start_time THEN
    v_business_day := v_business_day - 1;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text),
    hashtext(v_business_day::text)
  );

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


-- ── B. Remove tabs from realtime publication ──────────────────────────────────

ALTER PUBLICATION supabase_realtime DROP TABLE public.tabs;


-- ── A. Drop client_tab_id column and its index ───────────────────────────────

DROP INDEX IF EXISTS public.tabs_client_idempotency;

ALTER TABLE public.tabs DROP COLUMN IF EXISTS client_tab_id;


COMMIT;
