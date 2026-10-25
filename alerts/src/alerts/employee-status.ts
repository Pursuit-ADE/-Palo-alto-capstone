// Employee-status check (client ask, Oct 23): an alert goes only to someone whose status is "active", and a person who
// has left can't sign in to read old alerts. The demo reads a synthetic status list from EMPLOYEE_STATUS; a real
// rollout would read Active Directory or HR behind the same interface. Server-only. No real people or HR data here.

/**
 * What the directory knows. "unknown" means it could not tell (an outage), which is not the same as "inactive": the
 * first is retried later, the second is final (PR #55 review).
 */
export type EmployeeStatus = 'active' | 'inactive' | 'unknown';

export interface EmployeeDirectory {
  /** Must answer "unknown" (or throw) when it cannot tell. Only "active" lets an alert or a sign-in through. */
  statusOf(userId: string): EmployeeStatus | Promise<EmployeeStatus>;
}

/** Keeps `{ userId: status }` entries whose value is a string; anything else is dropped, so that person is not active. */
export function parseEmployeeStatus(raw: string | Record<string, unknown> | undefined): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  // Both sides are normalized, so a stray space in the list can't make someone silently never match.
  for (const [userId, status] of Object.entries(parsed)) {
    if (typeof status === 'string') out[userId.trim()] = status.trim().toLowerCase();
  }
  return out;
}

/**
 * A directory backed by a fixed map. Only the exact status "active" passes. "terminated", "on leave", a typo and a
 * person who is not listed are all "inactive" (fail closed, like the email channel with no address). A fixed map
 * always knows, so it never answers "unknown".
 */
export function staticEmployeeDirectory(statuses: Record<string, string>): EmployeeDirectory {
  return { statusOf: (userId) => (Object.hasOwn(statuses, userId) && statuses[userId] === 'active' ? 'active' : 'inactive') };
}

export const EMPLOYEE_STATUS_WARNING =
  'EMPLOYEE_STATUS is set but has no valid entries; every alert will be held back until it lists active people.';

/**
 * Reads EMPLOYEE_STATUS. Unset or blank means the check is off and only the disabled-account check applies (so the
 * laptop demo still alerts everyone). Set means it is on, even if the value is malformed: a broken list must stop
 * alerts, not quietly turn the check off.
 */
export function createEmployeeDirectory(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = console.warn,
): EmployeeDirectory | undefined {
  const raw = env.EMPLOYEE_STATUS;
  if (raw === undefined || raw.trim() === '') return undefined;
  const statuses = parseEmployeeStatus(raw);
  if (Object.keys(statuses).length === 0) warn(EMPLOYEE_STATUS_WARNING);
  return staticEmployeeDirectory(statuses);
}

/**
 * The status to act on. No directory means the check is off, so everyone counts as active. A directory that throws,
 * or answers with anything but "active" or "inactive", counts as "unknown": refused now, and retried where it can be.
 */
export async function employeeStatusOf(directory: EmployeeDirectory | undefined, userId: string): Promise<EmployeeStatus> {
  if (!directory) return 'active';
  try {
    const status = await directory.statusOf(userId);
    return status === 'active' || status === 'inactive' ? status : 'unknown';
  } catch {
    return 'unknown';
  }
}
