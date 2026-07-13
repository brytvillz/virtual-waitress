-- Migration 006: Rate limit table for create-restaurant edge function
-- Tracks signup attempts per IP to prevent scripted account creation.
-- Checked and written by the edge function using service role key.

CREATE TABLE IF NOT EXISTS signup_attempts (
  ip         text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_attempts_ip_time
  ON signup_attempts (ip, created_at DESC);
