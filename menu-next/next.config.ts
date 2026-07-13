import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'rewdizxixvfytxnkcjyh.supabase.co' },
    ],
  },
  async redirects() {
    return [
      { source: '/signup',         destination: 'https://dashboard.virtualwaitress.com/signup',         permanent: true },
      { source: '/login',          destination: 'https://dashboard.virtualwaitress.com/login',          permanent: true },
      { source: '/reset-password', destination: 'https://dashboard.virtualwaitress.com/reset-password', permanent: true },
      { source: '/admin',          destination: 'https://dashboard.virtualwaitress.com',                permanent: true },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  tunnelRoute: '/monitoring',
});
