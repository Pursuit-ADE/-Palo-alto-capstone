// HTTPS protections that must not depend on someone remembering an environment variable on the deploy.
// In a production build (`next build` / `next start`) HSTS is on by default. Browsers ignore it on plain http,
// so it is harmless on a laptop demo.
// The session cookie stays Secure in production. The one exception is a direct demo on this machine
// or the private LAN, with no trusted proxy in front, when the scheme is http or missing: Safari on a phone drops a Secure cookie,
// so sign-in never sticks. A TLS-terminating proxy usually makes the app see plain http too, so that case keeps
// Secure unless COOKIE_SECURE=false. COOKIE_SECURE=true forces the flag on.
// With no request to inspect, development stays off unless ENABLE_HSTS=true or COOKIE_SECURE=true.
export function httpsSettings(env: Record<string, string | undefined> = process.env): { hsts: boolean; secureCookie: boolean } {
  const production = env.NODE_ENV === 'production';
  const hsts = production ? env.ENABLE_HSTS !== 'false' : env.ENABLE_HSTS === 'true';
  const secureCookie = env.COOKIE_SECURE === 'false' ? false : production || hsts || env.COOKIE_SECURE === 'true';
  return { hsts, secureCookie };
}

function hostnameOf(host: string | null | undefined): string {
  if (!host) return '';
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end === -1 ? '' : trimmed.slice(1, end);
  }
  return trimmed.split(':')[0] ?? '';
}

function ipv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (nums.some((n) => !Number.isInteger(n) || n > 255)) return null;
  return nums as [number, number, number, number];
}

/** Loopback or a private LAN address: localhost, ::1, 127.x, 10.x, 192.168.x, 172.16.x-172.31.x. */
export function isLoopbackOrPrivateHost(host: string | null | undefined): boolean {
  const name = hostnameOf(host);
  if (name === 'localhost' || name === '::1') return true;
  const ip = ipv4(name);
  if (!ip) return false;
  const [a, b] = ip;
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  return a === 172 && b >= 16 && b <= 31;
}

/**
 * The Secure flag for one request. A forwarded scheme is ignored unless this process has no trusted proxy
 * and the host is loopback or the private LAN: that is the phone demo. Behind a proxy, production stays Secure.
 * A missing scheme counts as http there, so only https keeps Secure. A client that sends its own Host and
 * X-Forwarded-Proto only weakens that client's own cookie.
 */
export function secureCookieForRequest(
  request: { host?: string | null; proto?: string | null } = {},
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.COOKIE_SECURE === 'false') return false;
  if (env.COOKIE_SECURE === 'true') return true;
  const hops = Number(env.TRUSTED_PROXY_HOPS || 0);
  const direct = !Number.isInteger(hops) || hops < 1;
  if (direct && isLoopbackOrPrivateHost(request.host) && request.proto !== 'https') return false;
  return httpsSettings(env).secureCookie;
}

/** Sent per request from proxy.ts, so ENABLE_HSTS is read when the server runs, not frozen at `next build`. */
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';
