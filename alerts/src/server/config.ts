// Settings checked when a production server starts (audit O3), so a missing or weak value stops the start instead
// of silently weakening the app. Development and tests are not checked.
export function productionConfigProblems(env: Record<string, string | undefined> = process.env, app: 'copilot' | 'alerts' = 'copilot'): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  // Without a fixed key each process picks a random one, and audit fingerprints can't be compared across restarts.
  if (app === 'copilot' && (env.AUDIT_HASH_KEY ?? '').length < 32) problems.push('AUDIT_HASH_KEY must be set to a random value of at least 32 characters.');
  if (env.DEMO_INVITE_SECRET && env.DEMO_INVITE_SECRET.length < 16) problems.push('DEMO_INVITE_SECRET must be at least 16 characters.');
  if (env.DEMO_INVITE_EXPIRES && Number.isNaN(new Date(env.DEMO_INVITE_EXPIRES).getTime())) problems.push('DEMO_INVITE_EXPIRES must be a date such as 2026-11-10.');
  // Employee status is a decision, not a variable someone forgot (evaluator D-06, #82): a list with at least one
  // active person, or "off" written on purpose for a laptop or Docker demo.
  if (!employeeStatusDecided(env.EMPLOYEE_STATUS)) {
    problems.push('EMPLOYEE_STATUS must list active employees as JSON (for example {"u_ts_east":"active"}), or be "off" to run without the check on purpose (demo only).');
  }
  return problems;
}

function employeeStatusDecided(raw: string | undefined): boolean {
  const value = (raw ?? '').trim();
  if (value.toLowerCase() === 'off') return true;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return Object.values(parsed).some((s) => typeof s === 'string' && s.trim().toLowerCase() === 'active');
  } catch {
    return false;
  }
}

export function assertProductionConfig(env: Record<string, string | undefined> = process.env, app: 'copilot' | 'alerts' = 'copilot'): void {
  const problems = productionConfigProblems(env, app);
  if (problems.length) throw new Error(`Refusing to start in production:\n- ${problems.join('\n- ')}`);
}
