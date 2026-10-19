// The "Viewing as" switch picks a test identity from the URL, with no sign-in, so it must never be reachable by
// real users. It only works when ALLOW_TEST_IDENTITIES is exactly "true", and never in a production build
// (`next start`): there the setting is refused outright, so a deploy can't leave it on by mistake.
// Real users sign in; their user id comes only from a verified server-side session.
export const TEST_IDENTITIES_IN_PRODUCTION =
  'ALLOW_TEST_IDENTITIES=true is refused in production: anyone could view the app as any demo person. Use demo sign-in (DEMO_INVITE_SECRET), or run `npm run dev` for local testing.';

/** Throws when a production server is configured with test identities on. Called at start-up and on every use. */
export function assertNoTestIdentitiesInProduction(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === 'production' && env.ALLOW_TEST_IDENTITIES === 'true') throw new Error(TEST_IDENTITIES_IN_PRODUCTION);
}

export function testIdentitiesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.ALLOW_TEST_IDENTITIES !== 'true') return false;
  assertNoTestIdentitiesInProduction(env);
  return true;
}
