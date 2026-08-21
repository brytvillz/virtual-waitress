-- Add trial_ends_at to restaurants
-- New signups get 14 days set by the create-restaurant edge function.
-- Existing accounts (all test) have no trial — they'll see the expired state
-- until data is wiped before launch.

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
