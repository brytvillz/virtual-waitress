-- 036: Stage 9 — counter entry and signup rejection logging.

-- signup_attempts: record why a code-based rejection happened, server-side only.
-- The column is null for rate-limit hits and for successful signups.
ALTER TABLE public.signup_attempts
  ADD COLUMN rejection_reason text;

-- orders: record which device entered a counter order (nullable; null for all
-- customer and waiter orders).
ALTER TABLE public.orders
  ADD COLUMN entered_by_device uuid REFERENCES public.devices(id);

-- Allow a paired, active device to insert order_items for its own restaurant.
-- Required so the counter-entry panel can create the full order in one flow.
CREATE POLICY "device_insert_order_items"
  ON public.order_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_device()
    AND order_id IN (
      SELECT id FROM public.orders
      WHERE restaurant_id = current_device_restaurant()
    )
  );
