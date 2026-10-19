// Demo sign-in (Week 5): the role comes from the invite, passwords and session tokens are only stored hashed,
// and a session is the only way to say who is asking.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { appAccounts, appSessions } from '@/db/schema';
import { DEMO_USER_IDS } from '@/db/seed';
import { AuthError, hashPassword, inviteCode, logIn, logOut, sessionUser, signUp, userForInvite, verifyPassword } from '@/server/auth';

const SECRET = 'test-only-invite-secret';
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

describe('passwords', () => {
  it('are stored as salted scrypt hashes and verified', async () => {
    const h1 = await hashPassword('correct horse battery');
    const h2 = await hashPassword('correct horse battery');
    expect(h1).toMatch(/^scrypt\$/);
    expect(h1).not.toBe(h2); // a fresh salt each time
    expect(h1).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery', h1)).toBe(true);
    expect(await verifyPassword('wrong horse battery', h1)).toBe(false);
  });
});

describe('invite codes', () => {
  it('map to exactly one demo person, and nothing else', () => {
    const codes = DEMO_USER_IDS.map((id) => inviteCode(id, SECRET));
    expect(new Set(codes).size).toBe(DEMO_USER_IDS.length);
    for (const id of DEMO_USER_IDS) expect(userForInvite(inviteCode(id, SECRET), SECRET)).toBe(id);
    expect(userForInvite(inviteCode('u_analyst', SECRET).toLowerCase(), SECRET)).toBe('u_analyst');
    expect(userForInvite('0000-0000-0000', SECRET)).toBeUndefined();
    expect(userForInvite(inviteCode('u_analyst', 'another-secret'), SECRET)).toBeUndefined();
    expect(userForInvite(inviteCode('u_analyst', SECRET), undefined)).toBeUndefined();
  });
});

describe('sign-up, log-in and sessions', () => {
  const jordanInvite = inviteCode('u_ts_east', SECRET);

  it('gives the account the person from the invite, whatever else is sent', async () => {
    const r = await signUp(database.authDb, { username: 'Jordan.Lee', password: 'a long demo password', invite: jordanInvite, role: 'analyst' } as never, SECRET);
    expect(r).toEqual({ username: 'jordan.lee', userId: 'u_ts_east' });
    const [row] = await database.db.select().from(appAccounts);
    expect(row!.userId).toBe('u_ts_east');
    expect(row!.passwordHash).not.toContain('a long demo password');
  });

  it('refuses a taken username, a short password, a bad username, a bad invite, or sign-up turned off', async () => {
    const bad = [
      { username: 'jordan.lee', password: 'a long demo password', invite: jordanInvite },
      { username: 'sam', password: 'short', invite: jordanInvite },
      { username: 'Robert"); DROP TABLE x;--', password: 'a long demo password', invite: jordanInvite },
      { username: 'sam', password: 'a long demo password', invite: 'ABCD-EF01-2345' },
    ];
    for (const b of bad) await expect(signUp(database.authDb, b, SECRET)).rejects.toBeInstanceOf(AuthError);
    await expect(signUp(database.authDb, { username: 'sam', password: 'a long demo password', invite: jordanInvite }, undefined)).rejects.toThrow(/turned off/);
  });

  it('logs in, keeps only a hash of the session token, and logs out', async () => {
    const { token, userId } = await logIn(database.authDb, 'jordan.lee', 'a long demo password');
    expect(userId).toBe('u_ts_east');
    expect(await sessionUser(database.authDb, token)).toBe('u_ts_east');
    const stored = await database.db.select().from(appSessions);
    expect(JSON.stringify(stored)).not.toContain(token);
    await logOut(database.authDb, token);
    expect(await sessionUser(database.authDb, token)).toBeUndefined();
  });

  it('gives the same answer for a wrong username and a wrong password', async () => {
    await expect(logIn(database.authDb, 'jordan.lee', 'not the password')).rejects.toThrow('The username or password is not right.');
    await expect(logIn(database.authDb, 'nobody.here', 'a long demo password')).rejects.toThrow('The username or password is not right.');
  });

  it('expires sessions and ignores made-up tokens', async () => {
    const start = new Date('2026-10-15T12:00:00Z');
    const { token } = await logIn(database.authDb, 'jordan.lee', 'a long demo password', start);
    expect(await sessionUser(database.authDb, token, new Date('2026-10-15T19:59:00Z'))).toBe('u_ts_east');
    expect(await sessionUser(database.authDb, token, new Date('2026-10-15T20:01:00Z'))).toBeUndefined(); // 8 hours
    expect(await sessionUser(database.authDb, 'made-up-token')).toBeUndefined();
    expect(await sessionUser(database.authDb, undefined)).toBeUndefined();
  });
});
