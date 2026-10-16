-- Migration 031: record which access code a venue used at signup
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS signup_promo_id uuid REFERENCES promo_codes(id);
