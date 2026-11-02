// Next.js calls register() once when the server starts, before it says "Ready". A production server with a missing or
// weak setting stops here with the setting's name (UX review, Nov 2).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { checkConfigAtStart } = await import('./src/server/startup-check');
  checkConfigAtStart();
}
