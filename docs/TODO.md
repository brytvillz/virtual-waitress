# TODO

## Before first real venue goes live

- **Session replay decision:** decide whether session replay is wanted for support. If yes: add a clear disclosure to the privacy policy first, then switch it on in `admin-next/sentry.client.config.ts` (and `menu-next` if customer-facing replay is also wanted). Do not enable it before the disclosure is live.

## Before second customer

- Turn on "Confirm email" in the Supabase dashboard (Authentication → Sign In / Providers → Email)
- Keep `email_confirm: false` in `create-restaurant` — that value means "not yet confirmed, must go through the flow"; changing it to `true` would bypass confirmation entirely
- Login page: if Supabase returns "Email not confirmed", send a fresh 8-digit code and show the code screen instead of an error
- Must be done AFTER custom SMTP (Resend) is live — the built-in mailer's 3 emails/hour cap makes this unreliable at any real signup volume

## Admin panel restructure (agreed 30 Sept)

Two governing principles:

- **One screen answers one question.** The current Analytics page tries to
  answer five at once, which is why it feels crowded.
- **Every number can be opened.** Tapping a total shows the rows behind it.
  A number you cannot open is decoration.

Five sections:

**TODAY** — only what is happening right now. Open tabs, live orders,
cancellation requests waiting, money collected so far, money still owed.
Nothing historical.

**HISTORY** — pick a day or a range. That day's total split by cash, transfer
and POS. Every order. Every tab. Every cancellation with its reason and who
approved it. This screen does not exist at all today and is the one an owner
opens the morning after.

**STAFF** — pick one waiter and a period. What he handled, what he collected,
what is still unpaid, what he asked to cancel and how many were approved.
One person, one page.

**MENU** — what sells and what does not, over a chosen period, including items
never ordered.

**SETTINGS** — only things that configure the venue. Nothing that reports.

Also: when a venue has `uses_table_numbers` off, the Tables page, the QR
page and table assignment must disappear from the admin navigation entirely.

---

## Pre-pilot blockers

- ~~**PRE-PILOT BLOCKER — Waiter session not killed on Remove.** `access_code = null` only blocked new logins; Supabase auth refresh ran independently and a removed waiter's session renewed indefinitely. Fix: `suspended_at` column (nullable timestamp) on `staff`; `current_staff_restaurant()` and `current_staff_role()` return NULL when set; `revoke_staff_sessions()` SECURITY DEFINER RPC kills refresh tokens and sets `not_after`; `suspend-staff` edge function calls RPC then sets `suspended_at` and nulls `access_code`; WaiterApp detects `suspended_at` on empty-fetch and returns to login screen; admin button renamed to "Suspend" with inline confirmation. Migration 041. [landed]~~

---

## Known gaps — plan before fixing

- **Pro plan expiry drops owner straight to view-only with no warning.** The 2-day grace period and the trial-warning countdown both run off `trial_ends_at`, which is already expired by the time a paid plan runs out. The fix is a second countdown banner driven by `plan_expires_at` — same logic as the `trial-warning` branch in `getTrialStatus`, checking `(plan_expires_at - now) ≤ 7 days`. Pilot codes will use `duration_days = null` (no expiry) so no pilot venue hits this wall.

---

## Known and accepted

- **`menu-images` write policies are not scoped to the caller's own restaurant.** The INSERT, UPDATE, and DELETE policies on `storage.objects` for the `menu-images` bucket check only `bucket_id = 'menu-images'`. They do not verify that the caller owns or works at the venue whose images they are touching. Any authenticated user on the platform — owner, waiter, or device — can upload to this bucket, and can update or delete any object in it, including another venue's menu photographs. Reads being public is expected. Writes being unscoped is not. Delete is the worse half: a waiter at one venue could remove another venue's images, and nothing in the current policies would attribute it. Must be scoped (e.g. `(storage.foldername(name))[1]` tied to `restaurant_id`) before any venue that is not mine goes live.

- **"Anyone can view menu items" (menu_items, role: public, qual: true).** Any anonymous caller — including unauthenticated browsers and paired devices — can SELECT all rows from `menu_items`, including names, prices, and photos, for every venue on the platform. This is intentional: the customer-facing menu screen runs anonymously, and a menu is a public document. No changes planned.

- **`menu_item_id` FK accepts cross-venue items (order_items, fk to menu_items).** The `menu_item_id` column is a plain FK to `menu_items(id)` with no restaurant-level scope check. A client that sends a `menu_item_id` belonging to a different venue will have it accepted by the database. After the BarApp menu filter fix the interface will never offer a cross-venue item, but the database would still accept one sent directly. No constraint built tonight. Needs a CHECK or trigger before any venue that is not mine goes live.

- **PRE-PILOT BLOCKER — Order board is open to flooding. Any caller with a venue's menu URL can insert orders with items onto that venue's board, as fast as the API allows, with no account, no verification, and no limit. Nothing in RLS, no trigger, and no application code prevents or limits this. The `anon_insert_orders` policy requires only that `customer_ordering_enabled = true`, which is true for every live venue by definition. Migration 037 closed nothing for enabled venues; the trigger (`trg_customer_ordering_gate`, migration 023) only gates disabled venues and does not apply here. The bar screen is the product's enforcement point. A board that can be flooded is a product failure, not only a security one: a waiter managing 40 real orders and 400 fake ones cannot work. This must be closed before any venue that is not mine goes live. Design the throttle deliberately — do not bolt it on.**

---

## Close of night screen

- **Junk-dismissal reason convention for cancel_order.** The admin dashboard already calls `cancel_order(order_id, reason)`, which records the cancellation in `order_history` with `changed_by` and the reason. Once the close-of-night screen exists, it should show dismissals (flood junk cleared by owner or manager) on their own line, separate from legitimate cancellations. A simple convention: agree on a reserved reason string (e.g. `'__dismiss__'`) so the report can count them without a schema change. Do not build this now — wait until the report screen is designed.

## Service worker

- **`sw.js` fetch handler has no `.catch()`.** The handler in `public/sw.js` is `caches.match(req).then(cached => cached || fetch(req))` with no `.catch()`. If a same-origin resource is not in the cache and the network is down, `fetch` rejects, the `FetchEvent` rejects, and the browser shows a generic network error page — not a cached fallback or a readable error. This happens in any bar with intermittent wifi. The customer currently sees whatever the browser renders for a failed FetchEvent (typically a "No internet" error page). Fix by adding `.catch(() => caches.match('/offline.html'))` or equivalent, and ensuring an offline fallback page is pre-cached in the `install` handler.

## Customer menu — plan before changing

- Item descriptions don't show. Ichiban CSV has no description column, so likely no bug; decide whether descriptions are needed.
- Past bug: +/- buttons didn't work on first tap, and the pop-up appeared before any item was added. Design the button and pop-up behaviour properly before touching this code.
