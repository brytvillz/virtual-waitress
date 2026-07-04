-- ============================================================
-- MIGRATION 002: Plan expiry tracking
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Add plan_expires_at to restaurants so we can auto-revert expired plans
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;

-- Optional index for efficient expiry queries (e.g. cron jobs, edge functions)
CREATE INDEX IF NOT EXISTS idx_restaurants_plan_expires_at
  ON restaurants(plan_expires_at)
  WHERE plan_expires_at IS NOT NULL;
