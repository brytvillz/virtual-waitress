-- 043_close_default_function_grants.sql
--
-- Attempts to close the project-level default privilege so new functions in
-- public no longer automatically receive EXECUTE grants for anon and
-- authenticated.
--
-- RESULT OF TESTING:
-- Only the postgres role's default can be changed via the Supabase Management
-- API. The supabase_admin default privilege cannot be modified (permission
-- denied). After applying the postgres change, new functions still receive a
-- PUBLIC EXECUTE grant (=X/postgres) from a Supabase platform mechanism that
-- is outside the reach of this SQL. anon and authenticated retain effective
-- EXECUTE on every new function through PUBLIC inheritance.
--
-- PRACTICAL CONCLUSION:
-- ALTER DEFAULT PRIVILEGES alone cannot close new functions on a Supabase
-- managed project. The reliable mechanism is an explicit per-function REVOKE
-- in the same migration that creates the function — which is what migration
-- 042 does for all existing functions that should be closed. Future functions
-- that need to be closed must follow that pattern explicitly.
--
-- This migration is left here as a record of what was attempted and confirmed.
-- The postgres change is harmless and is kept: if Supabase's platform
-- behaviour ever changes, anon and authenticated will no longer appear as
-- explicit entries in new function proacls (PUBLIC access would still need a
-- separate REVOKE). See AGENTS.md at the repository root for the convention.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- The following line is intentionally omitted:
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...
-- because the Supabase Management API returns permission denied for that role.
