// HTTPS protections that must not depend on someone remembering an environment variable on the deploy.
// In a production build (`next build` / `next start`) both are on by default:
// - HSTS tells browsers to use HTTPS only. Browsers ignore it on plain-http responses, so it is harmless on a
//   laptop demo at http://localhost.
// - The session cookie gets the Secure flag. Chrome, Edge and Firefox accept Secure cookies on http://localhost;
//   for a plain-http demo in another browser, set COOKIE_SECURE=false on purpose.
// In development both stay off unless ENABLE_HSTS=true or COOKIE_SECURE=true.
export function httpsSettings(env: Record<string, string | undefined> = process.env): { hsts: boolean; secureCookie: boolean } {
  const production = env.NODE_ENV === 'production';
  const hsts = production ? env.ENABLE_HSTS !== 'false' : env.ENABLE_HSTS === 'true';
  const secureCookie = env.COOKIE_SECURE === 'false' ? false : production || hsts || env.COOKIE_SECURE === 'true';
  return { hsts, secureCookie };
}
