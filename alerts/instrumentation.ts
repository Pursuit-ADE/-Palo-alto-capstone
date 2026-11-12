// Next.js calls register() once when the server starts. A production server with a missing or weak setting exits here,
// naming the setting, before it serves a page (it may print "Ready" just before); before, the check ran only on the first
// database connection, so the server served pages that all failed (UX review Nov 2, as for the copilot). With ALERTS_SCHEDULER=true this
// then starts the alert scheduler straight away, so alerts are evaluated and sent even if nobody ever opens a page. If
// the database isn't ready yet, start-up is retried in the background with growing waits until it works.
export async function register() {
  // `next build` runs as production without the runtime settings (Dockerfile, ci.yml), so the check waits for a start,
  // as in the copilot's instrumentation.ts.
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { checkConfigAtStart } = await import('./src/server/startup-check');
  checkConfigAtStart();
  if (process.env.ALERTS_SCHEDULER !== 'true') return;
  const { startWithRetry } = await import('./src/server/runtime');
  startWithRetry();
}
