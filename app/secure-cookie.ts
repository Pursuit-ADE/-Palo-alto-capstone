// Whether a display-preference cookie set in this request should be Secure: yes behind HTTPS, decided the same way as
// the sign-in cookies (src/server/https.ts). Server-only; not a server action, so the browser can't call it.
import { headers } from 'next/headers';
import { secureCookieForRequest } from '@/server/https';

export async function cookieIsSecure(): Promise<boolean> {
  try {
    const h = await headers();
    return secureCookieForRequest({ host: h.get('host'), proto: h.get('x-forwarded-proto') });
  } catch {
    // Outside a request (a script or a test) there are no headers: fall back to the server's own setting.
    return secureCookieForRequest();
  }
}
