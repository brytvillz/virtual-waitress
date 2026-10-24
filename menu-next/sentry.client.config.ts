import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // Session replay is off entirely in menu-next. The routes here serve
  // customers who have not consented to screen recording, and waiters on
  // shift. Error reporting (stack traces) is kept; replay is not.
});
