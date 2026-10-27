-- 040_fix_throttle_log.sql
-- Fix: throttle rejection log was rolled back when RAISE EXCEPTION fired
-- because both were in the same transaction. Replace RAISE with RETURN NULL
-- so the log INSERT commits before the function exits. The client treats
-- NULL return identically to an error (shows the "please try again" message).

CREATE OR REPLACE FUNCTION public.customer_place_order(
  p_client_order_id  uuid,
  p_restaurant_id    uuid,
  p_table_number     int,
  p_items            jsonb
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
  -- 0. Idempotency first. A retry on bad wifi must not be counted as a new order.
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

  -- 3. Rate: 30/minute, 400/hour per venue.
  --    RETURN NULL (not RAISE) so the rejection log INSERT commits before
  --    the function exits. The client treats NULL return as a retry signal.
  IF (
    SELECT COUNT(*) FROM public.orders
    WHERE  restaurant_id = p_restaurant_id
      AND  created_at   > now() - interval '1 minute'
  ) >= 30 THEN
    INSERT INTO public.order_throttle_rejections(restaurant_id, limit_type)
    VALUES (p_restaurant_id, 'per_minute');
    RETURN NULL;
  END IF;

  IF (
    SELECT COUNT(*) FROM public.orders
    WHERE  restaurant_id = p_restaurant_id
      AND  created_at   > now() - interval '1 hour'
  ) >= 400 THEN
    INSERT INTO public.order_throttle_rejections(restaurant_id, limit_type)
    VALUES (p_restaurant_id, 'per_hour');
    RETURN NULL;
  END IF;

  -- 4. Validate every item before touching orders.
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

  -- 5. Insert order header.
  INSERT INTO public.orders (restaurant_id, table_number, client_order_id, source, total)
  VALUES (p_restaurant_id, p_table_number, p_client_order_id, 'customer', 0)
  ON CONFLICT (restaurant_id, client_order_id) WHERE client_order_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT id INTO v_order_id
    FROM   public.orders
    WHERE  restaurant_id   = p_restaurant_id
      AND  client_order_id = p_client_order_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order_id LIMIT 1) THEN
    RETURN v_order_id;
  END IF;

  -- 6. Insert items. Trigger fills price + station; recompute_order_total fires.
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
