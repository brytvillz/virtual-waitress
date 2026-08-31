-- ============================================================
-- MIGRATION 009: Station Screen — schema
--
-- 1. devices table (paired screens, one per physical device)
-- 2. device_pairing_codes (short-lived 6-digit codes)
-- 3. call_type + response-time columns on waiter_calls
-- 4. 'ready' status + timestamp columns on orders
-- 5. Alert settings + escalation thresholds on restaurants
-- ============================================================

BEGIN;

-- ── 1. devices ───────────────────────────────────────────────────────────────
-- One row per paired Station Screen. auth_user_id links to a real Supabase
-- Auth user created during the pairing handshake so we reuse the existing
-- session/JWT machinery without inventing a separate token system.
-- revoked_at IS NULL = active. Set revoked_at to deactivate; never delete.

CREATE TABLE devices (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid        UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid        NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          text        NOT NULL DEFAULT 'Station Screen',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;


-- ── 2. device_pairing_codes ──────────────────────────────────────────────────
-- Manager clicks "Add a screen" → row inserted with a random 6-digit code.
-- Screen types the code at /station → pair-device edge function validates,
-- marks used_at, creates the auth user + devices row via service role.

CREATE TABLE device_pairing_codes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid        NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  code          char(6)     NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL DEFAULT now() + INTERVAL '10 minutes',
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE device_pairing_codes ENABLE ROW LEVEL SECURITY;


-- ── 3. waiter_calls additions ─────────────────────────────────────────────────

ALTER TABLE waiter_calls
  -- 'service' = existing Call Waiter (default, backward-compatible)
  -- 'bill'    = new Request Bill button on the customer menu
  ADD COLUMN IF NOT EXISTS call_type       text        NOT NULL DEFAULT 'service'
    CHECK (call_type IN ('service', 'bill')),

  -- Set by trigger (server-side) when status → 'acknowledged'.
  -- acknowledged_by resolved from shift_assignments, not from client input.
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid        REFERENCES staff(id);


-- ── 4. orders additions ───────────────────────────────────────────────────────

-- New status flow: pending → preparing → ready → served
-- 'ready' = kitchen/pass finished; a waiter now carries it to the table.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'preparing', 'ready', 'served', 'cancelled'));

-- Timestamp columns set by trigger (server-side) on each status transition.
-- Client sends only {status: 'ready'}; trigger sets the timestamps and attribution.
-- These are the numbers the owner looks at: response time, preparation time,
-- delivery time — all trustworthy because the client can never write them.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz,  -- when status → 'preparing'
  ADD COLUMN IF NOT EXISTS ready_at    timestamptz,  -- when status → 'ready'
  ADD COLUMN IF NOT EXISTS served_at   timestamptz;  -- when status → 'served'


-- ── 5. Alert settings + escalation thresholds on restaurants ─────────────────
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  BILLING WARNING — DO NOT ADD BILLING DATA HERE                         ║
-- ║  This table is world-readable: "Public can read restaurants" RLS policy  ║
-- ║  grants SELECT to anon (customers need it to load the menu).             ║
-- ║  Subscription status, plan prices, Paystack customer IDs, transaction    ║
-- ║  references, or any financial field added here becomes world-readable    ║
-- ║  the moment it lands.                                                    ║
-- ║  Billing belongs in its own table with its own restrictive RLS.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Thresholds stored in seconds. Defaults:
--   Waiter called / bill    amber 2 min   red 5 min   escalate 8 min
--   Food ready              amber 3 min   red 5 min   escalate 8 min
--   New order not started   amber 5 min   red 8 min   escalate 12 min

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS alert_station_screen  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alert_staff_phones    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_sound           boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS thresh_call_amber     int     NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS thresh_call_red       int     NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS thresh_call_escalate  int     NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS thresh_ready_amber    int     NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS thresh_ready_red      int     NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS thresh_ready_escalate int     NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS thresh_order_amber    int     NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS thresh_order_red      int     NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS thresh_order_escalate int     NOT NULL DEFAULT 720;


-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_devices_restaurant ON devices(restaurant_id);
CREATE INDEX idx_devices_auth_user  ON devices(auth_user_id);
CREATE INDEX idx_pairing_codes_code ON device_pairing_codes(code);

-- Partial unique index: at most one unused pairing code per restaurant.
-- Without this a double-click on "Add a screen" generates two codes, the
-- first of which is silently orphaned. This makes the second insert fail
-- cleanly instead.
CREATE UNIQUE INDEX idx_one_pending_code_per_restaurant
  ON device_pairing_codes(restaurant_id)
  WHERE used_at IS NULL;

COMMIT;
