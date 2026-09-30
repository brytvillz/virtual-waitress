-- ============================================================
-- ROLLBACK for migration 029_realtime_replica_identity
--
-- Reverts replica identity back to DEFAULT on all five tables.
-- This will break UPDATE/DELETE realtime filtering again.
-- Only roll back if you are reverting to a non-realtime setup.
-- ============================================================

BEGIN;

ALTER TABLE public.orders                  REPLICA IDENTITY DEFAULT;
ALTER TABLE public.order_items             REPLICA IDENTITY DEFAULT;
ALTER TABLE public.waiter_calls            REPLICA IDENTITY DEFAULT;
ALTER TABLE public.cancellation_requests   REPLICA IDENTITY DEFAULT;
ALTER TABLE public.tabs                    REPLICA IDENTITY DEFAULT;

COMMIT;
