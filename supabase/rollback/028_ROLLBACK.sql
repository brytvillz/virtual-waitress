-- ============================================================
-- ROLLBACK for migration 028_void_order_item
--
-- Reverses in order C → B → A.
--
-- WARNING: any rows in order_items that have been voided via
-- void_order_item will have item_status = 'voided' and the void
-- columns populated. After rollback, item_status stays 'voided'
-- (the column and CHECK constraint still exist — only the RPC and
-- the extra audit columns are removed). This is acceptable because
-- the item is already gone from the total and there is no safe way
-- to un-void a voided item.
-- ============================================================

BEGIN;


-- ── C. Drop the RPC ──────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.void_order_item(uuid, text);


-- ── B. Revert order_history.change_type CHECK ────────────────────────────────

ALTER TABLE public.order_history
  DROP CONSTRAINT IF EXISTS order_history_change_type_check;

ALTER TABLE public.order_history
  ADD CONSTRAINT order_history_change_type_check
    CHECK (change_type IN (
      'status', 'payment', 'cancellation', 'creation', 'assignment'
    ));

-- Note: any existing 'void' rows in order_history will now violate this
-- constraint if added back. In practice: only roll back 028 on a fresh
-- environment with no voids, or accept that 'void' rows will remain
-- unconstrained until 028 is re-applied.


-- ── A. Drop void columns from order_items ────────────────────────────────────

ALTER TABLE public.order_items
  DROP COLUMN IF EXISTS void_reason,
  DROP COLUMN IF EXISTS voided_by,
  DROP COLUMN IF EXISTS voided_at,
  DROP COLUMN IF EXISTS voided_while_served;


COMMIT;
