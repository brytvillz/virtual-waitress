-- Migration 007: Atomic promo code claim
-- Replaces the non-atomic read-check-update in create-restaurant with a
-- single locked UPDATE that only increments if the code is still valid.

CREATE OR REPLACE FUNCTION claim_promo_uses(p_promo_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_rows integer;
BEGIN
  UPDATE promo_codes
  SET uses_count = uses_count + 1
  WHERE id = p_promo_id
    AND (max_uses IS NULL OR uses_count < max_uses)
    AND (expires_at IS NULL OR expires_at > now());

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows > 0;
END;
$$;
