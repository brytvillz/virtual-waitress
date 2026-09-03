-- MIGRATION 017: Alert toggle columns + fix owner UPDATE policy regression
--
-- TWO CHANGES
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Add per-venue alert preference columns (Step 3 — Settings → Alerts).
--    Defaults match the intended out-of-the-box experience:
--      - Station Screen on  (show orders on the kitchen/bar display)
--      - Staff Phones off   (push notification — requires explicit opt-in)
--      - Sound on           (chime in the admin dashboard)
--
-- 2. Fix regression introduced by migration 013.
--    013 correctly narrowed manager_update_restaurant from role {public} to
--    {authenticated}. But the USING clause passes only when the caller has a
--    staff row with role='manager'. Restaurant owners are identified by
--    restaurants.owner_id, not by any staff row, so every owner UPDATE on
--    their own restaurant has been rejected since 013 was applied.
--
--    Correct fix: add an OR branch for the owner case.
--    is_any_device() guard blocks device sessions from reaching the owner
--    branch (a device's auth_user_id is a fresh Supabase auth user with no
--    restaurant, so owner_id = auth.uid() would already be false — but
--    explicit exclusion keeps intent clear and guards against future schema
--    drift).

BEGIN;

-- ── 1. Alert columns ──────────────────────────────────────────────────────────
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS alert_station_screen BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS alert_staff_phones   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS alert_sound          BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 2. Fix manager_update_restaurant to include owners ────────────────────────
DROP POLICY IF EXISTS "manager_update_restaurant" ON public.restaurants;

CREATE POLICY "manager_update_restaurant" ON public.restaurants
  FOR UPDATE TO authenticated
  USING (
    (id = public.current_staff_restaurant() AND public.current_staff_role() = 'manager')
    OR (owner_id = auth.uid() AND NOT public.is_any_device())
  )
  WITH CHECK (
    (id = public.current_staff_restaurant() AND public.current_staff_role() = 'manager')
    OR (owner_id = auth.uid() AND NOT public.is_any_device())
  );

COMMIT;
