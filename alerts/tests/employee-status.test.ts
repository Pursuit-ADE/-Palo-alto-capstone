// Employee-status check (client ask, Oct 23): alerts go only to active employees, and anything unclear is refused.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { alertDeliveries, alertSubscriptions, supportCases } from '@/db/schema';
import { buildSeed } from '@/db/seed';
import type { Channels } from '@/alerts/channels';
import {
  EMPLOYEE_STATUS_WARNING,
  createEmployeeDirectory,
  employeeIsActive,
  parseEmployeeStatus,
  staticEmployeeDirectory,
  type EmployeeDirectory,
} from '@/alerts/employee-status';
import { flushDigests, runAlerts } from '@/alerts/engine';
import { loadRules } from '@/alerts/rules';
import { tick } from '@/alerts/scheduler';

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

describe('employee status directory (client ask, Oct 23)', () => {
  it('passes only the exact status "active", whatever the case or spacing', async () => {
    const dir = staticEmployeeDirectory(parseEmployeeStatus('{"a":" Active ","b":"inactive","c":"terminated","d":"on leave","e":"actve"}'));
    expect(await dir.isActive('a')).toBe(true);
    for (const who of ['b', 'c', 'd', 'e']) expect(await dir.isActive(who)).toBe(false);
  });

  it('refuses a person who is not listed, including names that exist on every object', async () => {
    const dir = staticEmployeeDirectory(parseEmployeeStatus('{"a":"active"}'));
    for (const who of ['ghost', '', 'constructor', 'toString', '__proto__']) expect(await dir.isActive(who)).toBe(false);
  });

  it('drops malformed entries and malformed lists', () => {
    expect(parseEmployeeStatus('{"a":"active","b":true,"c":null,"d":1,"e":["active"]}')).toEqual({ a: 'active' });
    for (const bad of ['not json', '[]', '"active"', 'null', '', undefined]) expect(parseEmployeeStatus(bad)).toEqual({});
  });

  it('is off when EMPLOYEE_STATUS is unset or blank, and on for any other value', async () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(createEmployeeDirectory({}, warn)).toBeUndefined();
    expect(createEmployeeDirectory({ EMPLOYEE_STATUS: '   ' }, warn)).toBeUndefined();
    expect(warnings).toEqual([]);
    const on = createEmployeeDirectory({ EMPLOYEE_STATUS: '{"a":"active"}' }, warn);
    expect(await on?.isActive('a')).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('fails closed on a malformed list, and says so at startup', async () => {
    const warnings: string[] = [];
    const dir = createEmployeeDirectory({ EMPLOYEE_STATUS: '{oops' }, (m) => warnings.push(m));
    expect(dir).toBeDefined();
    expect(await dir?.isActive('a')).toBe(false);
    expect(warnings).toEqual([EMPLOYEE_STATUS_WARNING]);
  });

  it('treats a directory that throws or answers with a non-boolean as not active', async () => {
    const throws: EmployeeDirectory = { isActive: () => { throw new Error('hr down'); } };
    const rejects: EmployeeDirectory = { isActive: () => Promise.reject(new Error('hr down')) };
    const odd = { isActive: () => 'yes' } as unknown as EmployeeDirectory;
    for (const dir of [throws, rejects, odd]) expect(await employeeIsActive(dir, USER)).toBe(false);
    expect(await employeeIsActive(undefined, USER)).toBe(true);
  });
});

describe('alerts and the employee status (client ask, Oct 23)', () => {
  let database: Database;
  beforeEach(async () => {
    database = await openDatabase();
    await database.db.delete(supportCases);
    await database.db.insert(supportCases).values({
      id: 'case_emp', snapshotId: data.snapshot.id, accountId: account, severity: 'P1', status: 'Open', subject: 'Outage', openedAt: new Date('2026-10-08T10:00:00Z'),
    });
  });
  afterEach(async () => {
    await database.close();
  });

  const subscribe = (frequency: string) =>
    database.db.insert(alertSubscriptions).values({ userId: USER, ruleId: 'high_severity_case', frequency, channel: 'slack', quietStartHour: null, quietEndHour: null, criticalBypass: false });
  const status = (value: string) => ({ directory: staticEmployeeDirectory({ [USER]: value }) });
  const deliveries = () => database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, USER));

  it('alerts an active employee (control)', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY, status('active'));
    expect(ch.calls).toHaveLength(1);
  });

  it('alerts everyone as before when no directory is set', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(ch.calls).toHaveLength(1);
  });

  it('creates no alert for an inactive employee', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY, status('inactive'));
    expect(ch.calls).toHaveLength(0);
    expect(await deliveries()).toHaveLength(0);
  });

  it('creates no alert for someone the directory does not list', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY, { directory: staticEmployeeDirectory({}) });
    expect(ch.calls).toHaveLength(0);
  });

  it('holds back a digest that was queued while the person was active, once they leave', async () => {
    await subscribe('digest');
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY, status('active'));
    await flushDigests(database.db, rules, ch, DAY, status('inactive'));
    expect(ch.calls).toHaveLength(0);
    expect((await deliveries()).map((d) => d.status)).toEqual(['suppressed_no_access']);
  });

  it('stops a retry of a failed send once the person leaves', async () => {
    await subscribe('realtime');
    const down: Channels = { async deliver() { return false; } };
    await runAlerts(database.db, rules, down, SINCE, DAY, status('active'));
    expect((await deliveries()).map((d) => d.status)).toEqual(['failed']);
    const ch = recorder();
    await flushDigests(database.db, rules, ch, new Date(DAY.getTime() + 3 * 60_000), status('inactive'));
    expect(ch.calls).toHaveLength(0);
  });

  it('is applied by the scheduler tick, not only by direct engine calls', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await tick(database.db, rules, ch, DAY, SINCE, status('inactive'));
    expect(ch.calls).toHaveLength(0);
    expect(await deliveries()).toHaveLength(0);
  });
});
