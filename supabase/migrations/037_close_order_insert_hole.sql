-- 037: Close the unscoped order INSERT hole.
--
-- "Anyone can place an order" (TO public, WITH CHECK status='pending') allowed
-- any caller -- anon or authenticated -- to insert an order against any
-- restaurant_id on the platform, because PostgreSQL ORs permissive policies
-- and this one had no restaurant-level scope. The correctly-scoped
-- anon_insert_orders policy was always present but never reached.
--
-- Fix: drop the broad policy; add a scoped device policy to replace the
-- only legitimate use case it was covering (paired-device counter entry).

DROP POLICY "Anyone can place an order" ON public.orders;

CREATE POLICY "device_insert_orders"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_device()
    AND restaurant_id = current_device_restaurant()
    AND status = 'pending'
  );
