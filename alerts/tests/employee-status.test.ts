// Employee-status check (client ask, Oct 23; PR #55 review): alerts go only to active employees, a person who left
// can't sign in, and an outage of the directory delays alerts instead of dropping them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { alertDeliveries, alertSubscriptions, appAccounts, supportCases } from '@/db/schema';
import { buildSeed } from '@/db/seed';
import type { Channels } from '@/alerts/channels';
import {
  EMPLOYEE_STATUS_WARNING,
  createEmployeeDirectory,
  employeeStatusOf,
  parseEmployeeStatus,
  staticEmployeeDirectory,
  type EmployeeDirectory,
  type EmployeeStatus,
} from '@/alerts/employee-status';
import { flushDigests, runAlerts } from '@/alerts/engine';
import { loadRules } from '@/alerts/rules';
import { tick } from '@/alerts/scheduler';
import { AuthError, hashPassword, logIn, sessionInfo } from '@/server/auth';

const rules = loadRules();
const data = buildSeed();
const SINCE = new Date('2026-09-01T00:00:00Z');
const DAY = new Date('2026-10-08T15:00:00Z');
const USER = 'u_ts_east';
const account = data.accountTeam.find((t) => t.userId === USER)!.accountId;

function recorder(): Channels & { calls: string[][] } {
  const calls: string[][] = [];
  return { calls, async deliver(_c, _u, items) { calls.push(items.map((i) => i.id)); return true; } };
}

/** A directory whose answer the test can change, such as an outage that ends. */
function switchable(initial: EmployeeStatus | 'throws'): EmployeeDirectory & { set(next: EmployeeStatus | 'throws'): void } {
  let current = initial;
  return {
    statusOf: () => {
      if (current === 'throws') throw new Error('directory down');
      return current;
    },
    set: (next) => {
      current = next;
    },
  };
}

describe('employee status directory (client ask, Oct 23)', () => {
  it('passes only the exact status "active", whatever the case or spacing', async () => {
    const dir = staticEmployeeDirectory(parseEmployeeStatus('{"a":" Active ","b":"inactive","c":"terminated","d":"on leave","e":"actve"}'));
    expect(await dir.statusOf('a')).toBe('active');
    for (const who of ['b', 'c', 'd', 'e']) expect(await dir.statusOf(who)).toBe('inactive');
  });

  it('refuses a person who is not listed, including names that exist on every object', async () => {
    const dir = staticEmployeeDirectory(parseEmployeeStatus('{"a":"active"}'));
    for (const who of ['ghost', '', 'constructor', 'toString', '__proto__']) expect(await dir.statusOf(who)).toBe('inactive');
  });

  it('ignores stray spaces around the user id in the list', async () => {
    const dir = staticEmployeeDirectory(parseEmployeeStatus('{" u_ts_east ":"active"}'));
    expect(await dir.statusOf('u_ts_east')).toBe('active');
  });

  it('drops malformed entries and malformed lists', () => {
    expect(parseEmployeeStatus('{"a":"active","b":true,"c":null,"d":1,"e":["active"]}')).toEqual({ a: 'active' });
    for (const bad of ['not json', '[]', '"active"', 'null', '', undefined]) expect(parseEmployeeStatus(bad)).toEqual({});
  });

  it('is off when EMPLOYEE_STATUS is unset, blank or "off", and on for any other value', async () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(createEmployeeDirectory({}, warn)).toBeUndefined();
    expect(createEmployeeDirectory({ EMPLOYEE_STATUS: '   ' }, warn)).toBeUndefined();
    expect(createEmployeeDirectory({ EMPLOYEE_STATUS: 'off' }, warn)).toBeUndefined();
    expect(warnings).toEqual([]);
    const on = createEmployeeDirectory({ EMPLOYEE_STATUS: '{"a":"active"}' }, warn);
    expect(await on?.statusOf('a')).toBe('active');
    expect(warnings).toEqual([]);
  });

  it('fails closed on a malformed list, and says so at startup', async () => {
    const warnings: string[] = [];
    const dir = createEmployeeDirectory({ EMPLOYEE_STATUS: '{oops' }, (m) => warnings.push(m));
    expect(dir).toBeDefined();
    expect(await dir?.statusOf('a')).toBe('inactive');
    expect(warnings).toEqual([EMPLOYEE_STATUS_WARNING]);
  });

  it('reads a directory that throws or answers oddly as "unknown", not "inactive"', async () => {
    const throws: EmployeeDirectory = { statusOf: () => { throw new Error('hr down'); } };
    const rejects: EmployeeDirectory = { statusOf: () => Promise.reject(new Error('hr down')) };
    const odd = { statusOf: () => 'yes' } as unknown as EmployeeDirectory;
    for (const dir of [throws, rejects, odd]) expect(await employeeStatusOf(dir, USER)).toBe('unknown');
    expect(await employeeStatusOf(undefined, USER)).toBe('active');
  });
});

/** Opens a database with one P1 case for Jordan's account before each test and closes it after. */
function useAlertsDatabase(): { database: () => Database; subscribe: (frequency: string) => Promise<unknown>; deliveries: () => Promise<{ status: string }[]> } {
  let open: Database | undefined;
  const database = () => {
    if (!open) throw new Error('database is not open');
    return open;
  };
  beforeEach(async () => {
    open = await openDatabase();
    await open.db.delete(supportCases);
    await open.db.insert(supportCases).values({
      id: 'case_emp', snapshotId: data.snapshot.id, accountId: account, severity: 'P1', status: 'Open', subject: 'Outage', openedAt: new Date('2026-10-08T10:00:00Z'),
    });
  });
  afterEach(async () => {
    await open?.close();
    open = undefined;
  });
  return {
    database,
    subscribe: (frequency) =>
      database().db.insert(alertSubscriptions).values({ userId: USER, ruleId: 'high_severity_case', frequency, channel: 'slack', quietStartHour: null, quietEndHour: null, criticalBypass: false }),
    deliveries: () => database().db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, USER)),
  };
}

describe('alerts and the employee status (client ask, Oct 23)', () => {
  const { database, subscribe, deliveries } = useAlertsDatabase();
  const status = (value: string) => ({ directory: staticEmployeeDirectory({ [USER]: value }) });
  const statuses = async () => (await deliveries()).map((d) => d.status);

  it('alerts an active employee (control)', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await runAlerts(database().db, rules, ch, SINCE, DAY, status('active'));
    expect(ch.calls).toHaveLength(1);
  });

  it('alerts everyone as before when no directory is set', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await runAlerts(database().db, rules, ch, SINCE, DAY);
    expect(ch.calls).toHaveLength(1);
  });

  it('creates no alert for an inactive employee', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await runAlerts(database().db, rules, ch, SINCE, DAY, status('inactive'));
    expect(ch.calls).toHaveLength(0);
    expect(await deliveries()).toHaveLength(0);
  });

  it('creates no alert for someone the directory does not list', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await runAlerts(database().db, rules, ch, SINCE, DAY, { directory: staticEmployeeDirectory({}) });
    expect(ch.calls).toHaveLength(0);
  });

  it('drops a queued digest for good once the person leaves, with its own reason', async () => {
    await subscribe('digest');
    const ch = recorder();
    await runAlerts(database().db, rules, ch, SINCE, DAY, status('active'));
    await flushDigests(database().db, rules, ch, DAY, status('inactive'));
    expect(ch.calls).toHaveLength(0);
    // Not "suppressed_no_access": the counts and audit can tell leaving the company from losing an account.
    expect(await statuses()).toEqual(['suppressed_inactive']);
  });

  it('stops a retry of a failed send once the person leaves', async () => {
    await subscribe('realtime');
    const down: Channels = { async deliver() { return false; } };
    await runAlerts(database().db, rules, down, SINCE, DAY, status('active'));
    expect(await statuses()).toEqual(['failed']);
    const ch = recorder();
    await flushDigests(database().db, rules, ch, new Date(DAY.getTime() + 3 * 60_000), status('inactive'));
    expect(ch.calls).toHaveLength(0);
    expect(await statuses()).toEqual(['suppressed_inactive']);
  });

  it('is applied by the scheduler tick, not only by direct engine calls', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await tick(database().db, rules, ch, DAY, SINCE, status('inactive'));
    expect(ch.calls).toHaveLength(0);
    expect(await deliveries()).toHaveLength(0);
  });
});

describe('alerts when the employee directory is down (PR #55 review)', () => {
  const { database, subscribe, deliveries } = useAlertsDatabase();
  const statuses = async () => (await deliveries()).map((d) => d.status);

  it('keeps an alert for retry when the directory is down at send time, then delivers it once it recovers', async () => {
    await subscribe('digest');
    const directory = switchable('active');
    const ch = recorder();
    await runAlerts(database().db, rules, ch, SINCE, DAY, { directory }); // queued for the digest while the person is active
    expect(await statuses()).toEqual(['queued_digest']);

    directory.set('throws');
    await flushDigests(database().db, rules, ch, DAY, { directory });
    expect(ch.calls).toHaveLength(0); // nothing sent during the outage
    expect(await statuses()).toEqual(['failed']); // retryable, not "suppressed"

    directory.set('active');
    await flushDigests(database().db, rules, ch, new Date(DAY.getTime() + 3 * 60_000), { directory });
    expect(ch.calls).toHaveLength(1);
    expect(await statuses()).toEqual(['delivered']);
  });

  it('creates nothing while the directory is down, and creates the alert when it is back', async () => {
    await subscribe('realtime');
    const directory = switchable('throws');
    const ch = recorder();
    await runAlerts(database().db, rules, ch, SINCE, DAY, { directory });
    expect(await deliveries()).toHaveLength(0);
    directory.set('active');
    await runAlerts(database().db, rules, ch, SINCE, DAY, { directory }); // the late-arrival window rescans the event
    expect(ch.calls).toHaveLength(1);
  });
});

describe('sign-in and the employee status (PR #55 review)', () => {
  let database: Database;
  const ACCOUNT = 'jordan';
  beforeEach(async () => {
    database = await openDatabase();
    await database.db.insert(appAccounts).values({ username: ACCOUNT, userId: USER, passwordHash: await hashPassword('correct horse battery'), createdAt: SINCE });
  });
  afterEach(async () => {
    await database.close();
  });

  const login = (directory?: EmployeeDirectory) => logIn(database.db, ACCOUNT, 'correct horse battery', DAY, directory);

  it('signs in an active employee and keeps their session (control)', async () => {
    const dir = staticEmployeeDirectory({ [USER]: 'active' });
    const { token } = await login(dir);
    expect((await sessionInfo(database.db, token, DAY, dir))?.userId).toBe(USER);
  });

  it('changes nothing when no directory is set', async () => {
    const { token } = await login();
    expect((await sessionInfo(database.db, token, DAY))?.userId).toBe(USER);
  });

  it('refuses sign-in for an inactive employee with the same message as a wrong password', async () => {
    const err = await login(staticEmployeeDirectory({ [USER]: 'inactive' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toBe('The username or password is not right.');
    expect((err as AuthError).code).toBe('employee_inactive');
  });

  it('ends a live session when the person is marked inactive, so the inbox is unreachable', async () => {
    const { token } = await login(staticEmployeeDirectory({ [USER]: 'active' }));
    expect(await sessionInfo(database.db, token, DAY, staticEmployeeDirectory({ [USER]: 'inactive' }))).toBeUndefined();
    expect(await sessionInfo(database.db, token, DAY, staticEmployeeDirectory({}))).toBeUndefined();
  });

  it('reads nothing on a guess: a directory outage is not a signed-in session', async () => {
    const { token } = await login(staticEmployeeDirectory({ [USER]: 'active' }));
    expect(await sessionInfo(database.db, token, DAY, switchable('throws'))).toBeUndefined();
    await expect(login(switchable('throws'))).rejects.toBeInstanceOf(AuthError);
  });
});
