# TODO

## Before second customer

- Turn on "Confirm email" in the Supabase dashboard (Authentication → Sign In / Providers → Email)
- Keep `email_confirm: false` in `create-restaurant` — that value means "not yet confirmed, must go through the flow"; changing it to `true` would bypass confirmation entirely
- Login page: if Supabase returns "Email not confirmed", send a fresh 8-digit code and show the code screen instead of an error
- Must be done AFTER custom SMTP (Resend) is live — the built-in mailer's 3 emails/hour cap makes this unreliable at any real signup volume

## Customer menu — plan before changing

- Item descriptions don't show. Ichiban CSV has no description column, so likely no bug; decide whether descriptions are needed.
- Past bug: +/- buttons didn't work on first tap, and the pop-up appeared before any item was added. Design the button and pop-up behaviour properly before touching this code.
