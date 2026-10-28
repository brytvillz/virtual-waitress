-- 041_staff_suspension.sql
-- Adds suspended_at to staff, updates the two helper functions to respect it,
-- and provides a revoke_staff_sessions() function for the edge function to call.

ALTER TABLE public.staff
  ADD COLUMN suspended_at TIMESTAMPTZ DEFAULT NULL;

-- Update current_staff_restaurant() to return NULL when suspended
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
    AND  NOT EXISTS (
           SELECT 1 FROM public.devices WHERE auth_user_id = auth.uid()
         );
$$;

-- Update current_staff_role() to return NULL when suspended
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
    AND  NOT EXISTS (
           SELECT 1 FROM public.devices WHERE auth_user_id = auth.uid()
         );
$$;

-- Revokes all active refresh tokens and marks all sessions as expired.
-- Called by the suspend-staff edge function via service-role RPC.
-- auth.refresh_tokens.user_id is stored as varchar, hence the cast.
CREATE OR REPLACE FUNCTION public.revoke_staff_sessions(p_staff_id UUID)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $$
  UPDATE auth.refresh_tokens
     SET revoked = true
   WHERE user_id = p_staff_id::text
     AND revoked = false;

  UPDATE auth.sessions
     SET not_after = now()
   WHERE user_id = p_staff_id
     AND (not_after IS NULL OR not_after > now());
$$;

-- Lock down the new function: only the service role may call it.
REVOKE ALL ON FUNCTION public.revoke_staff_sessions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_staff_sessions(UUID) TO service_role;
