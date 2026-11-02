// Next.js calls register() once when the server starts, before it says "Ready". A production server with a missing or
// weak setting stops here with the setting's name; before, the check ran only on the first database connection, so the
// server said "Ready" and then failed every page (UX review Nov 2, as for the copilot). With ALERTS_SCHEDULER=true this
// then starts the alert scheduler straight away, so alerts are evaluated and sent even if nobody ever opens a page. If
// the database isn't ready yet, start-up is retried in the background with growing waits until it works.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { productionConfigProblems } = await import('./src/server/config');
  const problems = productionConfigProblems(process.env, 'alerts');
  if (problems.length) {
    console.error(`Refusing to start in production:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  if (process.env.ALERTS_SCHEDULER !== 'true') return;
  const { startWithRetry } = await import('./src/server/runtime');
  startWithRetry();
}
