-- ============================================================
-- MIGRATION 015: Active-device uniqueness + LIMIT 1 guard
--
-- Two guarantees added together. The index makes the bad state
-- impossible; the LIMIT 1 is the second layer if it ever happened.
-- ============================================================

BEGIN;

-- ── 1. Partial unique index on devices.auth_user_id ──────────────────────────
--
-- At most one ACTIVE row per auth_user_id (WHERE revoked_at IS NULL).
--
-- A plain UNIQUE on auth_user_id would block re-pairing: revoked rows stay
-- as audit history, so a plain index would reject a new pairing for the
-- same physical device (same auth user re-paired after revocation, if ever
-- that becomes the flow) or a coding error that reuses a user ID.
-- The WHERE clause allows history while enforcing the guarantee that matters:
-- no single auth user can be active in two different restaurants at once.
--
-- If this fails to create, at least one auth_user_id has more than one row
-- with revoked_at IS NULL in the live table. Do not proceed — report the
-- duplicates rather than deleting them.

CREATE UNIQUE INDEX devices_active_auth_user_uniq
  ON public.devices (auth_user_id)
  WHERE revoked_at IS NULL;


-- ── 2. Re-state LIMIT 1 in current_device_restaurant() ───────────────────────
--
-- The function was written with LIMIT 1 in migration 010. It is restated here
-- because:
--   - Migration 010 is the only place it lives outside this repo; a future
--     CREATE OR REPLACE that forgets LIMIT 1 would silently introduce the
--     multi-row ambiguity below.
--   - PostgreSQL returns an arbitrary row (not an error) when a scalar SQL
--     function's SELECT returns multiple rows. If one auth_user_id ever had
--     two active device rows for two different restaurants, current_device_
--     restaurant() would silently return the wrong restaurant_id with no log.
--     The index (above) makes that state impossible; LIMIT 1 is the second
--     layer in case the index is ever bypassed (service-role insert, future
--     migration error, etc.).

CREATE OR REPLACE FUNCTION public.current_device_restaurant()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT restaurant_id
  FROM   public.devices
  WHERE  auth_user_id = auth.uid()
    AND  revoked_at IS NULL
  LIMIT  1;
$$;

COMMIT;
