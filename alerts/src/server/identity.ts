// There is no sign-in yet (F-01). Until there is, the "Viewing as" switch picks a test identity from the
// URL, so it must never be reachable by real users. It only works when ALLOW_TEST_IDENTITIES is exactly "true".
// Real authentication replaces this: the user id must come from a verified server-side session.
export function testIdentitiesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ALLOW_TEST_IDENTITIES === 'true';
}
