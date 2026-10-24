// Employee-status check (client ask, Oct 23): an alert goes only to someone whose status is "active". The demo reads a
// synthetic status list from EMPLOYEE_STATUS; a real rollout would read Active Directory or HR behind the same interface.
// Server-only. No real people or HR data belong here.

export interface EmployeeDirectory {
  /** True only when the person is a current employee. A failure or an unknown person must read as false. */
  isActive(userId: string): boolean | Promise<boolean>;
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
  for (const [userId, status] of Object.entries(parsed)) {
    if (typeof status === 'string') out[userId] = status.trim().toLowerCase();
  }
  return out;
}

/**
 * A directory backed by a fixed map. Only the exact status "active" passes, so "terminated", "on leave", a typo and
 * a person who is not listed are all refused (fail closed, like the email channel with no address).
 */
export function staticEmployeeDirectory(statuses: Record<string, string>): EmployeeDirectory {
  return { isActive: (userId) => Object.hasOwn(statuses, userId) && statuses[userId] === 'active' };
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

/** No directory means the check is off. A directory that throws counts as "not active". */
export async function employeeIsActive(directory: EmployeeDirectory | undefined, userId: string): Promise<boolean> {
  if (!directory) return true;
  try {
    return (await directory.isActive(userId)) === true;
  } catch {
    return false;
  }
}
