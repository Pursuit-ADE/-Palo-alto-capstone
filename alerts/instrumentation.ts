// Next.js calls register() once when the server starts. With ALERTS_SCHEDULER=true this starts the alert
// scheduler straight away, so alerts are evaluated and sent even if nobody ever opens a page. If the database
// isn't ready yet, start-up is retried in the background with growing waits until it works.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.ALERTS_SCHEDULER !== 'true') return;
  const { startWithRetry } = await import('./src/server/runtime');
  startWithRetry();
}
