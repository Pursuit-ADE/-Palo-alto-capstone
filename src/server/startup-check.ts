// Stops a production server at start when a setting is missing or weak (audit O3), naming it. The same check used to
// run only on the first database connection, so the server said "Ready" and then failed every page (UX review, Nov 2).
import { productionConfigProblems } from './config';

/** Logs every problem and exits when there are any. `exit` is injectable for tests. */
export function checkConfigAtStart(env: Record<string, string | undefined> = process.env, exit: (code: number) => void = process.exit): void {
  const problems = productionConfigProblems(env, 'copilot');
  if (problems.length === 0) return;
  console.error(`Refusing to start in production:\n- ${problems.join('\n- ')}`);
  exit(1);
}
