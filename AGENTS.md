# Function grants in this project

## The short version

New functions in `public` start **open** on a Supabase managed project. This is
deliberate infrastructure behaviour that cannot be fully overridden. Every
function that should be closed must be explicitly revoked in the same migration
that creates it.

---

## Rules

**New functions in public start open on Supabase. This is deliberate — plan for it.**

Supabase sets project-level `ALTER DEFAULT PRIVILEGES` that grants `EXECUTE` on
every new function in `public` to `anon`, `authenticated`, and `service_role`.
Migration 043 attempted to close the `postgres` role's default and confirmed
this partially: the explicit `anon` and `authenticated` entries were removed
from `pg_default_acl`. However, new functions still receive `=X/postgres`
(PUBLIC execute) from a Supabase platform mechanism that cannot be controlled
via the Management API. A throwaway function created after the change showed
`anon_exec: true`. The `supabase_admin` default could not be modified at all
(permission denied). `ALTER DEFAULT PRIVILEGES` alone does not make the project
fail loudly on a missing grant.

**An RLS helper function needs an explicit `GRANT EXECUTE` to `anon` and `authenticated`, or every query on the table it guards will 403.**

Functions used in RLS policies (e.g. `current_staff_restaurant()`,
`current_staff_role()`) are called as the querying role. If those roles lack
`EXECUTE`, every `SELECT`/`INSERT`/`UPDATE`/`DELETE` through that policy will
be refused.

**A function called from the browser with `supabase.rpc()` needs the same grant.**

The PostgREST RPC path runs as the caller's role. `anon` for unauthenticated
calls, `authenticated` for signed-in ones. No grant → 403.

**A trigger function needs no grant at all. Adding one is the mistake, not omitting it.**

The database engine invokes trigger functions directly, bypassing grantee
checks. A client that somehow calls a trigger function directly gets an
immediate error because `TG_OP`, `NEW`, `OLD`, and related variables are
undefined. That error is an implementation detail, not a security property.
Trigger functions must be explicitly revoked from `PUBLIC`, `anon`, and
`authenticated` so that the "it errors" behaviour is backed by a deliberate
access decision. See migration 042.

**A function called only by an edge function gets `service_role` and nothing else.**

Edge functions run with a service-role client. There is no legitimate path for
`anon` or `authenticated` to call these functions. Restrict them explicitly.
Example: `revoke_staff_sessions`, `claim_promo_uses`. See migrations 041, 042.

**Revoke all three. Neither `PUBLIC` alone nor `anon`+`authenticated` alone is sufficient.**

`anon` and `authenticated` are members of `PUBLIC`. This project has two
independent grants working against a closed function:

1. `=X/postgres` — a PUBLIC execute grant added by a Supabase platform
   mechanism that cannot be controlled via the Management API. Revoking only
   `anon` and `authenticated` by name leaves this entry, so both roles retain
   EXECUTE through PUBLIC membership.

2. `anon=X/postgres` and `authenticated=X/postgres` — explicit grants from the
   Supabase project-level default privilege. Revoking only PUBLIC removes the
   `=X/postgres` entry but leaves these named entries intact.

Both halves must be revoked. Neither alone is sufficient. Always use all three:

```sql
REVOKE EXECUTE ON FUNCTION public.fn_name() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_name() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_name() FROM authenticated;
```

---

## Platform limitation (recorded for future sessions)

**Who creates migration functions:** CLI migrations run as `postgres`. Every
function created by a migration is owned by `postgres` (confirmed live on this
project). The `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` change in migration
043 therefore does apply to everything we create — but it only removed the
explicit `anon` and `authenticated` entries from `pg_default_acl`. The Supabase
platform still re-adds `=X/postgres` (PUBLIC execute) on every new function via
a mechanism outside the Management API's reach, and `anon`/`authenticated` reach
EXECUTE through that PUBLIC grant. Migration 043 is not purely a record: it
closed half the problem. The per-function REVOKE on all three (PUBLIC, anon,
authenticated) closes the other half and is the only reliable mechanism.

`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public` returns
permission denied via the Supabase Management API and cannot be changed. The
`supabase_admin` role owns Supabase infrastructure objects, not migration
functions. See migration 043 for the full audit record.
