import type { NextConfig } from 'next';
import { httpsSettings } from './src/server/https';

// Static security headers for every response. The Content Security Policy is set per request in proxy.ts.
export function securityHeadersFor(hsts: boolean) {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // On by default in production (src/server/https.ts). Browsers ignore it on plain-http responses.
    ...(hsts
      ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
      : []),
  ];
}

const securityHeaders = securityHeadersFor(httpsSettings().hsts);

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
