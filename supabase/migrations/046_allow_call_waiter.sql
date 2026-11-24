-- Allow venues to control whether the customer-facing "Call Waiter" button
-- is visible. Defaults to FALSE so the button is hidden on all existing venues
-- until the owner enables it.
ALTER TABLE public.restaurants
  ADD COLUMN allow_call_waiter BOOLEAN NOT NULL DEFAULT FALSE;
