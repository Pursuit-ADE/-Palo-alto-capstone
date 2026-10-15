// Next.js calls register() once when the server starts. With ALERTS_SCHEDULER=true this starts the alert
// scheduler straight away, so alerts are evaluated and sent even if nobody ever opens a page.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.ALERTS_SCHEDULER !== 'true') return;
  const { getAlertsRuntime } = await import('./src/server/runtime');
  try {
    await getAlertsRuntime();
  } catch (e) {
    // The first request retries start-up (see onceWithRetry), so a database that isn't ready yet isn't fatal.
    console.error('alerts start-up failed; will retry on the next request', e instanceof Error ? e.name : 'unknown');
  }
}
