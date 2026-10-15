import type { NextConfig } from 'next';

// Static security headers for every response. The Content Security Policy is set per request in proxy.ts.
export function securityHeadersFor(enableHsts: string | undefined) {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // Left off for plain-http localhost. Set ENABLE_HSTS=true only when the app is served over HTTPS.
    ...(enableHsts === 'true'
      ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
      : []),
  ];
}

const securityHeaders = securityHeadersFor(process.env.ENABLE_HSTS);

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
