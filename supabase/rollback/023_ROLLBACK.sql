-- ============================================================
-- ROLLBACK for migration 023_customer_ordering_gate.sql
--
-- Removes the defense-in-depth trigger.
-- The RLS policy (anon_insert_orders from migration 018) continues to
-- block anonymous customer orders when customer_ordering_enabled = false.
--
-- HOW TO USE
-- Supabase Dashboard → SQL Editor, or:
--   psql $DATABASE_URL -f supabase/rollback/023_ROLLBACK.sql
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_customer_ordering_gate ON public.orders;
DROP FUNCTION IF EXISTS public.enforce_customer_ordering_enabled();

COMMIT;
