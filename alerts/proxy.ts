// Content Security Policy with a fresh nonce per request, so only scripts Next.js renders with that nonce run.
// Pages are dynamic (force-dynamic), which nonces require. HSTS is set here too, per request, so ENABLE_HSTS is read
// when the server starts rather than baked in by `next build` (on in production, ignored by browsers over plain http). upgrade-insecure-requests stays off: it would break a plain-http localhost demo.
import { NextResponse, type NextRequest } from 'next/server';
import { HSTS_VALUE, httpsSettings, REQUEST_PROTO_HEADER } from './src/server/https';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Inline style attributes (bar widths) only; they cannot run code.
    "style-src-attr 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  // The scheme of the URL this server is answering. Replaces any client-supplied value. The session cookie
  // reads it so plain http does not get a Secure cookie that Safari on a phone would drop.
  requestHeaders.set(REQUEST_PROTO_HEADER, request.nextUrl.protocol === 'https:' ? 'https' : 'http');
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  if (httpsSettings().hsts) response.headers.set('Strict-Transport-Security', HSTS_VALUE);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
