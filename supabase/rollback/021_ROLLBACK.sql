-- ============================================================
-- ROLLBACK for migration 021_payment_order_history.sql
--
-- *** DATA SAFETY WARNING ***
-- Drops order_history — all audit rows are permanently lost.
-- Drops is_paid, paid_at, paid_by from orders — all payment
-- records are permanently lost.
-- Only safe to run before real payment data has accumulated.
-- After your first paid order, write a forward fix instead.
--
-- HOW TO USE
-- Supabase Dashboard → SQL Editor, or:
--   psql $DATABASE_URL -f supabase/rollback/021_ROLLBACK.sql
-- Do NOT place in supabase/migrations/ — the runner would apply it.
--
-- Verify after rollback:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders'
--   AND column_name IN ('is_paid','paid_at','paid_by');
--   Expected: 0 rows.
--
--   SELECT to_regclass('public.order_history');
--   Expected: NULL.
-- ============================================================

BEGIN;

-- ── Step 1: Drop BEFORE payment trigger and function ─────────────────────
DROP TRIGGER IF EXISTS trg_enforce_payment_update ON public.orders;
DROP FUNCTION IF EXISTS public.enforce_payment_update();

-- ── Step 2: Drop AFTER history triggers and functions ────────────────────
DROP TRIGGER IF EXISTS trg_record_order_history        ON public.orders;
DROP TRIGGER IF EXISTS trg_record_order_history_insert ON public.orders;
DROP FUNCTION IF EXISTS public.record_order_history();
DROP FUNCTION IF EXISTS public.record_order_history_insert();

-- ── Step 3: Drop order_history table (CASCADE removes indexes and policies)
DROP TABLE IF EXISTS public.order_history;

-- ── Step 4: Drop payment columns from orders ─────────────────────────────
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS is_paid,
  DROP COLUMN IF EXISTS paid_at,
  DROP COLUMN IF EXISTS paid_by;

COMMIT;
