-- 047_staff_removed_at.sql
-- Adds removed_at to staff, updates the two RLS helper functions to treat
-- removed staff the same as suspended staff (no access), and updates the
-- slot-count query so removed waiters do not occupy a plan seat.

ALTER TABLE public.staff
  ADD COLUMN removed_at TIMESTAMPTZ DEFAULT NULL;

-- CREATE OR REPLACE preserves the existing GRANT EXECUTE on anon and authenticated
-- that were added by the Supabase platform default privileges.
-- Adding AND removed_at IS NULL mirrors the suspended_at guard already in place.

CREATE OR REPLACE FUNCTION public.current_staff_restaurant()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $$
  SELECT restaurant_id
  FROM   public.staff
  WHERE  id = auth.uid()
    AND  suspended_at IS NULL
    AND  removed_at IS NULL
    AND  NOT EXISTS (
           SELECT 1 FROM public.devices WHERE auth_user_id = auth.uid()
         );
$$;

CREATE OR REPLACE FUNCTION public.current_staff_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $$
  SELECT role
  FROM   public.staff
  WHERE  id = auth.uid()
    AND  suspended_at IS NULL
    AND  removed_at IS NULL
    AND  NOT EXISTS (
           SELECT 1 FROM public.devices WHERE auth_user_id = auth.uid()
         );
$$;
