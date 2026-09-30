-- ============================================================
-- MIGRATION 027 — tab idempotency, waiter_place_order tab
--                 support, and realtime publication
--
-- ── Changes ─────────────────────────────────────────────────
-- A. tabs.client_tab_id column + partial unique index.
--    Prevents a double-tap on a bad network from creating two
--    tabs for the same group (same class of bug fixed for
--    orders in migration 026 with client_order_id).
--
-- B. Add public.tabs to supabase_realtime publication.
--    Required for postgres_changes subscriptions to receive
--    INSERT/UPDATE/DELETE events on the tabs table.
--
-- C. open_tab — replace 3-argument signature with
--    4-argument (adds p_client_tab_id uuid DEFAULT NULL).
--    IMPORTANT: CREATE OR REPLACE with a different argument
--    list creates a NEW overload instead of replacing the old
--    one, leaving both alive and making 3-argument PostgREST
--    calls ambiguous. DROP the old signature first.
--    Idempotency logic: if p_client_tab_id IS NOT NULL and a
--    tab with that key already exists for this restaurant,
--    return its id without doing anything else.
--
-- D. waiter_place_order — replace 3-argument signature with
--    4-argument (adds p_tab_id uuid DEFAULT NULL).
--    Same DROP-first reason as open_tab above.
--    When p_tab_id IS NOT NULL the RPC validates the tab
--    exists, belongs to this restaurant, and is open, then
--    passes it through to the orders INSERT.
-- ============================================================

BEGIN;


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — client_tab_id column and partial unique index
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tabs
  ADD COLUMN IF NOT EXISTS client_tab_id uuid NULL;

-- One tab per (restaurant, client_tab_id) — ignores rows where
-- client_tab_id IS NULL (tabs opened without a client key, including all
-- rows written before this migration).
CREATE UNIQUE INDEX IF NOT EXISTS tabs_client_idempotency
  ON public.tabs (restaurant_id, client_tab_id)
  WHERE client_tab_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — add tabs to the realtime publication
-- ════════════════════════════════════════════════════════════════════════════

-- Required so that Supabase postgres_changes channel subscriptions on
-- public.tabs deliver INSERT and UPDATE events to the waiter app and
-- the admin panel in real time.
ALTER PUBLICATION supabase_realtime ADD TABLE public.tabs;


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — open_tab with idempotency
-- ════════════════════════════════════════════════════════════════════════════

-- Drop the old 3-argument signature BEFORE creating the new 4-argument one.
-- If we used CREATE OR REPLACE without dropping, PostgreSQL would create a
-- second overload: open_tab(uuid,int,text) and open_tab(uuid,int,text,uuid)
-- would both exist, and any PostgREST call with positional or partial named
-- params could match either, causing an ambiguous function error.
DROP FUNCTION IF EXISTS public.open_tab(uuid, int, text);

CREATE OR REPLACE FUNCTION public.open_tab(
  p_restaurant_id uuid,
  p_table_number  int  DEFAULT NULL,
  p_note          text DEFAULT NULL,
  p_client_tab_id uuid DEFAULT NULL
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
  -- Idempotency: if a client key is supplied and a tab with that key already
  -- exists for this restaurant, return the existing tab id immediately.
  -- Checked before the advisory lock — no need to serialise a read-only lookup.
  IF p_client_tab_id IS NOT NULL THEN
    SELECT id INTO v_tab_id
    FROM   public.tabs
    WHERE  restaurant_id = p_restaurant_id
      AND  client_tab_id = p_client_tab_id;
    IF FOUND THEN RETURN v_tab_id; END IF;
  END IF;

  -- Load restaurant config and verify ownership in one query.
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
  v_local_now    := now() AT TIME ZONE v_tz;
  v_local_time   := v_local_now::time;
  v_business_day := v_local_now::date;

  IF v_local_time < v_start_time THEN
    v_business_day := v_business_day - 1;
  END IF;

  -- Serialise concurrent opens for this restaurant+day.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text),
    hashtext(v_business_day::text)
  );

  -- Safe to read MAX now — no concurrent open_tab can be here for the same
  -- (restaurant_id, business_day).
  SELECT COALESCE(MAX(tab_number), 0) + 1
  INTO   v_tab_number
  FROM   public.tabs
  WHERE  restaurant_id = p_restaurant_id
    AND  business_day  = v_business_day;

  INSERT INTO public.tabs (
    restaurant_id, tab_number, business_day,
    table_number, note, client_tab_id, status,
    opened_by, opened_at
  ) VALUES (
    p_restaurant_id, v_tab_number, v_business_day,
    p_table_number, p_note, p_client_tab_id, 'open',
    auth.uid(), now()
  )
  RETURNING id INTO v_tab_id;

  RETURN v_tab_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_tab(uuid, int, text, uuid) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PART D — waiter_place_order with optional p_tab_id
-- ════════════════════════════════════════════════════════════════════════════

-- Drop the old 3-argument signature first (same reason as open_tab above).
DROP FUNCTION IF EXISTS public.waiter_place_order(uuid, int, jsonb);

CREATE OR REPLACE FUNCTION public.waiter_place_order(
  p_client_order_id uuid,
  p_table_number    int,
  p_items           jsonb,
  p_tab_id          uuid DEFAULT NULL
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
  v_tab_status    text;
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

  -- Validate tab before item loop (fail fast, no partial state).
  IF p_tab_id IS NOT NULL THEN
    SELECT status INTO v_tab_status
    FROM   public.tabs
    WHERE  id            = p_tab_id
      AND  restaurant_id = v_restaurant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'waiter_place_order: tab does not exist or does not belong to this restaurant';
    END IF;
    IF v_tab_status = 'closed' THEN
      RAISE EXCEPTION 'waiter_place_order: tab is already closed';
    END IF;
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
  INSERT INTO public.orders (restaurant_id, table_number, client_order_id, tab_id)
  VALUES (v_restaurant_id, p_table_number, p_client_order_id, p_tab_id)
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
  -- enforce_waiter_order_item_insert (BEFORE trigger) fills price + station.
  -- recompute_order_total (AFTER trigger) fires after each insert.
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

GRANT EXECUTE ON FUNCTION public.waiter_place_order(uuid, int, jsonb, uuid) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- Verification hint (run after applying to confirm the publication)
-- ════════════════════════════════════════════════════════════════════════════
-- SELECT tablename FROM pg_publication_tables
-- WHERE  pubname = 'supabase_realtime'
-- ORDER  BY tablename;
-- Expected: cancellation_requests, menu_items, order_items, orders,
--           tabs, waiter_calls  (and any others already present)


COMMIT;
