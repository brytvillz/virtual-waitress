-- 039_customer_place_order.sql
-- Move customer order creation server-side. Closes the price hole where
-- the browser supplied item prices that the database accepted unchanged.
-- The trigger enforce_waiter_order_item_insert had a deliberate passthrough
-- for NULL menu_item_id labelled "customer (legacy)" — every customer order
-- since that trigger was written had its price taken from the browser.

-- ── 1. Rate-limit rejection log ────────────────────────────────────────────────

CREATE TABLE public.order_throttle_rejections (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  rejected_at   timestamptz NOT NULL DEFAULT now(),
  limit_type    text        NOT NULL CHECK (limit_type IN ('per_minute', 'per_hour'))
);

ALTER TABLE public.order_throttle_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read_throttle_rejections"
  ON public.order_throttle_rejections
  FOR SELECT TO authenticated
  USING (restaurant_id IN (
    SELECT id FROM public.restaurants WHERE owner_id = auth.uid()
  ));

-- ── 2. customer_place_order ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.customer_place_order(
  p_client_order_id  uuid,
  p_restaurant_id    uuid,
  p_table_number     int,
  p_items            jsonb   -- [{menu_item_id uuid, quantity int}] only
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id     uuid;
  v_item         jsonb;
  v_menu_item_id uuid;
  v_qty          int;
  v_item_name    text;
  v_available    boolean;
  v_enabled      boolean;
BEGIN
  -- 0. Idempotency first. A retry on bad wifi must not be counted as a new order
  --    and must not be counted against the rate limit.
  IF p_client_order_id IS NOT NULL THEN
    SELECT id INTO v_order_id
    FROM   public.orders
    WHERE  restaurant_id   = p_restaurant_id
      AND  client_order_id = p_client_order_id;

    IF FOUND THEN RETURN v_order_id; END IF;
  END IF;

  -- 1. Items not empty; quantities in range.
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'customer_place_order: order must contain at least one item';
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 99 THEN
      RAISE EXCEPTION 'customer_place_order: quantity must be 1–99';
    END IF;
  END LOOP;

  -- 2. Venue must have customer ordering enabled.
  SELECT customer_ordering_enabled INTO v_enabled
  FROM   public.restaurants
  WHERE  id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_place_order: restaurant not found';
  END IF;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'customer_place_order: ordering is not enabled at this venue';
  END IF;

  -- 3. Rate: 30 orders / minute, 400 orders / hour, per venue.
  IF (
    SELECT COUNT(*) FROM public.orders
    WHERE  restaurant_id = p_restaurant_id
      AND  created_at   > now() - interval '1 minute'
  ) >= 30 THEN
    INSERT INTO public.order_throttle_rejections(restaurant_id, limit_type)
    VALUES (p_restaurant_id, 'per_minute');
    RAISE EXCEPTION 'customer_place_order: please try again in a moment';
  END IF;

  IF (
    SELECT COUNT(*) FROM public.orders
    WHERE  restaurant_id = p_restaurant_id
      AND  created_at   > now() - interval '1 hour'
  ) >= 400 THEN
    INSERT INTO public.order_throttle_rejections(restaurant_id, limit_type)
    VALUES (p_restaurant_id, 'per_hour');
    RAISE EXCEPTION 'customer_place_order: please try again in a moment';
  END IF;

  -- 4. Validate every item before touching orders (fail fast, no partial state).
  --    Rejects any menu_item_id that belongs to a different restaurant.
  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    v_menu_item_id := (v_item->>'menu_item_id')::uuid;

    IF v_menu_item_id IS NULL THEN
      RAISE EXCEPTION 'customer_place_order: each item requires menu_item_id';
    END IF;

    SELECT name, available INTO v_item_name, v_available
    FROM   public.menu_items
    WHERE  id            = v_menu_item_id
      AND  restaurant_id = p_restaurant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'customer_place_order: item does not belong to this restaurant';
    END IF;

    IF NOT v_available THEN
      RAISE EXCEPTION 'customer_place_order: "%" is not available', v_item_name;
    END IF;
  END LOOP;

  -- 5. Insert order header. total starts at 0; recompute_order_total will set
  --    it from the items once they are inserted below.
  INSERT INTO public.orders (restaurant_id, table_number, client_order_id, source, total)
  VALUES (p_restaurant_id, p_table_number, p_client_order_id, 'customer', 0)
  ON CONFLICT (restaurant_id, client_order_id) WHERE client_order_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_order_id;

  -- Concurrent insert raced us: read the id back.
  IF v_order_id IS NULL THEN
    SELECT id INTO v_order_id
    FROM   public.orders
    WHERE  restaurant_id   = p_restaurant_id
      AND  client_order_id = p_client_order_id;
  END IF;

  -- Items already present: this is a complete replay — return idempotently.
  IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order_id LIMIT 1) THEN
    RETURN v_order_id;
  END IF;

  -- 6. Insert items. enforce_waiter_order_item_insert (BEFORE trigger) looks up
  --    price and station from menu_items and overwrites NEW.price / NEW.station.
  --    Any price or total arriving from the browser is never used.
  --    recompute_order_total (AFTER trigger) fires after each row and sets
  --    orders.total from the sum of all items.
  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    v_menu_item_id := (v_item->>'menu_item_id')::uuid;

    INSERT INTO public.order_items (order_id, menu_item_id, item_name, quantity)
    SELECT
      v_order_id,
      v_menu_item_id,
      name,
      (v_item->>'quantity')::int
    FROM public.menu_items
    WHERE id = v_menu_item_id;
  END LOOP;

  RETURN v_order_id;
END;
$$;

-- ── 3. Grants ──────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.customer_place_order(uuid, uuid, int, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.customer_place_order(uuid, uuid, int, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.customer_place_order(uuid, uuid, int, jsonb) TO authenticated;

-- ── 4. Harden the item trigger: remove the NULL passthrough ────────────────────
--    The "customer (legacy)" branch was there because MenuApp did not send
--    menu_item_id. Now that all paths do, NULL is a programming error.

CREATE OR REPLACE FUNCTION public.enforce_waiter_order_item_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_price   int;
  v_station text;
BEGIN
  IF NEW.menu_item_id IS NULL THEN
    RAISE EXCEPTION
      'order_items: menu_item_id is required — the legacy customer passthrough has been removed';
  END IF;

  SELECT price, station
  INTO   v_price, v_station
  FROM   public.menu_items
  WHERE  id = NEW.menu_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Menu item % does not exist', NEW.menu_item_id;
  END IF;

  NEW.price   := v_price;
  NEW.station := v_station;

  RETURN NEW;
END;
$$;

-- ── 5. Drop anon insert policies ───────────────────────────────────────────────

DROP POLICY anon_insert_orders     ON public.orders;
DROP POLICY anon_insert_order_items ON public.order_items;
