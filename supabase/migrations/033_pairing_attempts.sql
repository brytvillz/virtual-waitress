-- 033: Rate-limit table for the pair-device edge function.
-- Mirrors the signup_attempts pattern (migration 006).
-- The edge function inserts a row on every attempt and counts recent rows
-- for the same IP before doing anything else.

CREATE TABLE IF NOT EXISTS public.pairing_attempts (
  ip         text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pairing_attempts_ip_time
  ON public.pairing_attempts (ip, created_at DESC);
