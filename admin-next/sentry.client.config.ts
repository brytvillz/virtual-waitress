import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.2,
  // Session replay is off entirely in admin-next. No disclosure exists in the
  // privacy policy. Re-enable only after adding that disclosure.
});
