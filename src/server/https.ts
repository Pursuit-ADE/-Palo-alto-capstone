// HTTPS protections that must not depend on someone remembering an environment variable on the deploy.
// In a production build (`next build` / `next start`) HSTS is on by default. Browsers ignore it on plain http,
// so it is harmless on a laptop demo.
// The session cookie is Secure on an HTTPS request. On plain http it is left off: Safari on a phone opened at
// the LAN address drops a Secure cookie, so sign-in never sticks. Chrome keeps a Secure cookie on
// http://localhost, which hid this. COOKIE_SECURE=true forces the flag on; COOKIE_SECURE=false forces it off.
// With no request scheme, development stays off unless ENABLE_HSTS=true or COOKIE_SECURE=true.
export const REQUEST_PROTO_HEADER = 'x-alto-request-proto';

export function httpsSettings(env: Record<string, string | undefined> = process.env): { hsts: boolean; secureCookie: boolean } {
  const production = env.NODE_ENV === 'production';
  const hsts = production ? env.ENABLE_HSTS !== 'false' : env.ENABLE_HSTS === 'true';
  const secureCookie = env.COOKIE_SECURE === 'false' ? false : production || hsts || env.COOKIE_SECURE === 'true';
  return { hsts, secureCookie };
}

/** The Secure flag for one request. `proto` is the scheme the server is answering, or null when that is unknown. */
export function secureCookieForRequest(proto: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (env.COOKIE_SECURE === 'false') return false;
  if (env.COOKIE_SECURE === 'true') return true;
  if (proto === 'http') return false;
  if (proto === 'https') return true;
  return httpsSettings(env).secureCookie;
}

/** Sent per request from proxy.ts, so ENABLE_HSTS is read when the server runs, not frozen at `next build`. */
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';
