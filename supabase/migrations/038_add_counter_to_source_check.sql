-- 038: Extend orders_source_check to allow counter entry.
--
-- Migration 018 created the constraint with only ('customer', 'waiter').
-- Counter entry (Stage 9) inserts source='counter' and was failing with
-- a 23514 check_violation (400 Bad Request) on every Save.

ALTER TABLE public.orders DROP CONSTRAINT orders_source_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_source_check
  CHECK (source = ANY (ARRAY['customer'::text, 'waiter'::text, 'counter'::text]));
