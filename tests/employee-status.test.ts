// Employee status in the copilot (evaluator D-06): someone who has left can't sign in or keep a session, the same rule
// the alerts app applies (#55). The check is off when no directory is set.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '@/db/client';
import { AuthError, inviteCode, logIn, sessionInfo, signUp } from '@/server/auth';
import { createEmployeeDirectory, staticEmployeeDirectory, type EmployeeDirectory } from '@/server/employee-status';

const SECRET = 'test-invite-secret-at-least-32-characters-long';

async function withAccount(run: (db: Awaited<ReturnType<typeof openDatabase>>['authDb']) => Promise<void>) {
  const database = await openDatabase();
  try {
    await signUp(database.authDb, { username: 'jordan.t', password: 'a-long-enough-pass-1', invite: inviteCode('u_ts_east', SECRET) }, SECRET);
    await run(database.authDb);
  } finally {
    await database.close();
  }
}

const expectRefused = async (p: Promise<unknown>) => {
  await expect(p).rejects.toBeInstanceOf(AuthError);
  await expect(p).rejects.toMatchObject({ code: 'employee_inactive', message: 'The username or password is not right.' });
};

describe('copilot sign-in and sessions follow employee status', () => {
  it('signs in an active employee, and anyone when the check is off', async () => {
    await withAccount(async (db) => {
      const active = await logIn(db, 'jordan.t', 'a-long-enough-pass-1', new Date(), staticEmployeeDirectory({ u_ts_east: 'active' }));
      expect(await sessionInfo(db, active.token, new Date(), staticEmployeeDirectory({ u_ts_east: 'active' }))).toMatchObject({ userId: 'u_ts_east' });
      const off = await logIn(db, 'jordan.t', 'a-long-enough-pass-1');
      expect(await sessionInfo(db, off.token)).toMatchObject({ userId: 'u_ts_east' });
    });
  });

  it('refuses sign-in for someone inactive or not listed, with the same message as a wrong password', async () => {
    await withAccount(async (db) => {
      await expectRefused(logIn(db, 'jordan.t', 'a-long-enough-pass-1', new Date(), staticEmployeeDirectory({ u_ts_east: 'inactive' })));
      await expectRefused(logIn(db, 'jordan.t', 'a-long-enough-pass-1', new Date(), staticEmployeeDirectory({ someone_else: 'active' })));
    });
  });

  it('ends an existing session once the person becomes inactive', async () => {
    await withAccount(async (db) => {
      const { token } = await logIn(db, 'jordan.t', 'a-long-enough-pass-1', new Date(), staticEmployeeDirectory({ u_ts_east: 'active' }));
      expect(await sessionInfo(db, token, new Date(), staticEmployeeDirectory({ u_ts_east: 'inactive' }))).toBeUndefined();
    });
  });

  it('treats a directory that fails as not signed in (fail closed)', async () => {
    const down: EmployeeDirectory = { statusOf: () => { throw new Error('directory unreachable'); } };
    await withAccount(async (db) => {
      const { token } = await logIn(db, 'jordan.t', 'a-long-enough-pass-1');
      expect(await sessionInfo(db, token, new Date(), down)).toBeUndefined();
      await expectRefused(logIn(db, 'jordan.t', 'a-long-enough-pass-1', new Date(), down));
    });
  });

  it('reads EMPLOYEE_STATUS: unset or "off" is off, set is on even when malformed', () => {
    expect(createEmployeeDirectory({})).toBeUndefined();
    expect(createEmployeeDirectory({ EMPLOYEE_STATUS: ' ' })).toBeUndefined();
    expect(createEmployeeDirectory({ EMPLOYEE_STATUS: 'off' })).toBeUndefined();
    expect(createEmployeeDirectory({ EMPLOYEE_STATUS: ' Off ' })).toBeUndefined();
    expect(createEmployeeDirectory({ EMPLOYEE_STATUS: 'not json' }, () => {})).toBeDefined();
  });

  it('refuses sign-up for someone who has left before creating the account, so the invite is not spent', async () => {
    const database = await openDatabase();
    try {
      const invite = inviteCode('u_ts_east', SECRET);
      const input = { username: 'jordan.t', password: 'a-long-enough-pass-1', invite };
      await expect(signUp(database.authDb, input, SECRET, new Date(), null, staticEmployeeDirectory({ u_ts_east: 'inactive' }))).rejects.toMatchObject({ code: 'employee_inactive', message: 'That invite code is not valid.' });
      // Nothing was created, so the same invite still works once the person is active.
      expect(await signUp(database.authDb, input, SECRET, new Date(), null, staticEmployeeDirectory({ u_ts_east: 'active' }))).toMatchObject({ userId: 'u_ts_east' });
    } finally {
      await database.close();
    }
  });

  it('uses the same employee-status code as the alerts app', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
    expect(read('src/server/employee-status.ts')).toBe(read('alerts/src/alerts/employee-status.ts'));
  });
});
