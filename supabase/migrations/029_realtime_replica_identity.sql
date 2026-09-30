-- ============================================================
-- MIGRATION 029 — set REPLICA IDENTITY FULL on all realtime tables
--
-- Why this is needed
--   Supabase Realtime uses postgres_changes to deliver row events.
--   For UPDATE events filtered on a non-primary-key column (e.g.
--   filter: 'restaurant_id=eq.X'), the Realtime server needs the
--   complete old row in the WAL record to evaluate the filter and
--   decide whether to deliver or drop the event. PostgreSQL's default
--   replica identity only writes the primary key to the old-row slot.
--   Without FULL, UPDATE events on filtered channels are silently
--   dropped.
--
--   For DELETE events with any filter, FULL is also required.
--
--   INSERT events are unaffected (the new row is always fully logged).
--
-- Tables already in the supabase_realtime publication
--   orders, waiter_calls, cancellation_requests
--     — added via Supabase dashboard; dashboard auto-sets FULL, but we
--       set it explicitly here so the code is the authoritative source.
--   tabs
--     — added via migration 027 (ALTER PUBLICATION ... ADD TABLE).
--       That migration did NOT set REPLICA IDENTITY FULL, leaving tabs
--       at DEFAULT and silently dropping all UPDATE events on tabs.
--
-- order_items is intentionally excluded from the publication.
--   The waiter app receives order events via the orders INSERT
--   subscription and does not need a separate order_items channel.
-- ============================================================

BEGIN;

ALTER TABLE public.orders                  REPLICA IDENTITY FULL;
ALTER TABLE public.order_items             REPLICA IDENTITY FULL;
ALTER TABLE public.waiter_calls            REPLICA IDENTITY FULL;
ALTER TABLE public.cancellation_requests   REPLICA IDENTITY FULL;
ALTER TABLE public.tabs                    REPLICA IDENTITY FULL;

COMMIT;
