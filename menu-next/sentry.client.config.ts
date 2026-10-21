import * as Sentry from '@sentry/nextjs';

// The bar screen is a fixed device — no session replay there.
const isBarScreen =
  typeof window !== 'undefined' &&
  window.location.pathname.startsWith('/bar');

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: isBarScreen ? 0 : 1.0,
  replaysSessionSampleRate: isBarScreen ? 0 : 0.02,
  integrations: isBarScreen ? [] : [Sentry.replayIntegration()],
});
