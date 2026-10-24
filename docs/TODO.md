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

## Known gaps — plan before fixing

- **Pro plan expiry drops owner straight to view-only with no warning.** The 2-day grace period and the trial-warning countdown both run off `trial_ends_at`, which is already expired by the time a paid plan runs out. The fix is a second countdown banner driven by `plan_expires_at` — same logic as the `trial-warning` branch in `getTrialStatus`, checking `(plan_expires_at - now) ≤ 7 days`. Pilot codes will use `duration_days = null` (no expiry) so no pilot venue hits this wall.

---

## Customer menu — plan before changing

- Item descriptions don't show. Ichiban CSV has no description column, so likely no bug; decide whether descriptions are needed.
- Past bug: +/- buttons didn't work on first tap, and the pop-up appeared before any item was added. Design the button and pop-up behaviour properly before touching this code.
