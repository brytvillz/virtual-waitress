-- ============================================================
-- MIGRATION 003: Promo codes
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

CREATE TABLE IF NOT EXISTS promo_codes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text        UNIQUE NOT NULL,
  plan          text        NOT NULL CHECK (plan IN ('growth', 'pro')),
  duration_days int,        -- null = permanent access
  max_uses      int,        -- null = unlimited uses
  uses_count    int         NOT NULL DEFAULT 0,
  expires_at    timestamptz,-- null = code never expires
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Only service role (edge functions) can access this table.
-- No authenticated user should read or write promo_codes directly.
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
