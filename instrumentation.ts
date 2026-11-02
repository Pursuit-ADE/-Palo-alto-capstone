// Next.js calls register() once when the server starts, before it says "Ready". A production server with a missing or
// weak setting stops here with the setting's name (UX review, Nov 2).
export async function register() {
  // `next build` runs as production without the runtime settings (Dockerfile, ci.yml), so the check waits for a start.
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { checkConfigAtStart } = await import('./src/server/startup-check');
  checkConfigAtStart();
}
