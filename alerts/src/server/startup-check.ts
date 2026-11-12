// Stops a production alerts server at start when a setting is missing or weak (audit O3), naming it, as the copilot's
// src/server/startup-check.ts does. Kept out of instrumentation.ts, which Next.js also bundles for the Edge runtime,
// where process.exit doesn't exist (the build warned about it).
import { productionConfigProblems } from './config';

/** Logs every problem and exits when there are any. `exit` is injectable for tests. */
export function checkConfigAtStart(env: Record<string, string | undefined> = process.env, exit: (code: number) => void = process.exit): void {
  const problems = productionConfigProblems(env, 'alerts');
  if (problems.length === 0) return;
  console.error(`Refusing to start in production:\n- ${problems.join('\n- ')}`);
  exit(1);
}
