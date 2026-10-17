// A real deployment needs a fixed audit key. Without one each process fingerprints with its own random key, so
// audit rows from different processes or restarts can't be matched and the per-address sign-in limit isn't shared
// between them. The laptop demo (ALLOW_EMBEDDED_DB=true) is one in-memory process, so it may run without.
export const AUDIT_KEY_MIN_LENGTH = 32;

export function assertAuditKeyInProduction(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === 'production' && env.ALLOW_EMBEDDED_DB !== 'true' && (env.AUDIT_HASH_KEY ?? '').length < AUDIT_KEY_MIN_LENGTH) {
    throw new Error(
      `Refusing to start a production deployment: AUDIT_HASH_KEY must be set to at least ${AUDIT_KEY_MIN_LENGTH} characters (e.g. \`openssl rand -hex 32\`), the same on every server.`,
    );
  }
}
