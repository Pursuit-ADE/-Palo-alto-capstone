// The Oct 17 audit's "before Demo Day" fixes, checked here so they stay fixed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { appSessions, queryAudit } from '@/db/schema';
import { loadRegistry } from '@/registry/load';
import { answerIntent, ask } from '@/semantic/answer';
import { AuthError, inviteCode, inviteExpiry, logIn, MAX_SESSIONS, sessionInfo, setAccountDisabled, signUp, revokeSessions } from '@/server/auth';
import { ModelBreaker } from '@/server/ask';
import { productionConfigProblems } from '@/server/config';

const SECRET = 'audit-fixes-test-secret';
const PASSWORD = 'violet-harbor-lantern';
const reg = loadRegistry();
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});
const code = (userId: string) => inviteCode(userId, SECRET);
const failCode = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AuthError ? e.code : String(e)));

describe('A1: an invite code works once and can expire', () => {
  it('refuses a second account for the same demo person', async () => {
    await signUp(database.auditDb, { username: 'avery.one', password: PASSWORD, invite: code('u_analyst') }, SECRET);
    expect(await failCode(signUp(database.auditDb, { username: 'avery.two', password: PASSWORD, invite: code('u_analyst') }, SECRET))).toBe('invite_used');
  });
  it('still says a taken username is taken', async () => {
    expect(await failCode(signUp(database.auditDb, { username: 'avery.one', password: PASSWORD, invite: code('u_ts_west') }, SECRET))).toBe('username_taken');
  });
  it('refuses codes after DEMO_INVITE_EXPIRES, and turns sign-up off if the date is unreadable', async () => {
    const now = new Date('2026-11-11T00:00:00Z');
    expect(await failCode(signUp(database.auditDb, { username: 'late.one', password: PASSWORD, invite: code('u_ts_west') }, SECRET, now, inviteExpiry('2026-11-10')))).toBe('invite_expired');
    expect(inviteExpiry('not a date')).toBe('invalid');
    expect(await failCode(signUp(database.auditDb, { username: 'late.two', password: PASSWORD, invite: code('u_ts_west') }, SECRET, now, 'invalid'))).toBe('signup_off');
    expect(inviteExpiry(undefined)).toBeNull();
  });
});

describe('A1: audit rows name the account and session', () => {
  it('writes username and session id for a question and a dashboard tile', async () => {
    const { token } = await logIn(database.auditDb, 'avery.one', PASSWORD);
    const s = (await sessionInfo(database.auditDb, token))!;
    expect(s).toMatchObject({ userId: 'u_analyst', username: 'avery.one' });
    expect(s.sessionId).toHaveLength(16);
    await ask(database, reg, s.userId, 'What is our open pipeline?', { actor: s });
    await answerIntent(database, reg, s.userId, { metric: 'open_pipeline', filters: {}, groupBy: [] }, 'dashboard', s);
    const rows = await database.db.select().from(queryAudit).where(eq(queryAudit.sessionId, s.sessionId));
    expect(rows.map((r) => r.source).sort()).toEqual(['dashboard', 'question']);
    expect(rows.every((r) => r.username === 'avery.one')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

describe('A2: disabling an account', () => {
  it('ends its sessions, refuses log-in with the usual message, and can be undone', async () => {
    await signUp(database.auditDb, { username: 'sam.disable', password: PASSWORD, invite: code('u_ts_west') }, SECRET);
    const { token } = await logIn(database.auditDb, 'sam.disable', PASSWORD);
    expect(await setAccountDisabled(database.db, 'sam.disable', true)).toBe(true);
    expect(await sessionInfo(database.auditDb, token)).toBeUndefined();
    const err = await logIn(database.auditDb, 'sam.disable', PASSWORD).catch((e: AuthError) => e);
    expect((err as AuthError).code).toBe('account_disabled');
    expect((err as AuthError).message).toBe('The username or password is not right.');
    await setAccountDisabled(database.db, 'sam.disable', false);
    const again = await logIn(database.auditDb, 'sam.disable', PASSWORD);
    expect(await sessionInfo(database.auditDb, again.token)).toBeDefined();
    expect(await revokeSessions(database.auditDb, 'sam.disable')).toBeGreaterThan(0);
    expect(await sessionInfo(database.auditDb, again.token)).toBeUndefined();
  });
});

describe('S1: session clean-up on log-in', () => {
  it('keeps at most MAX_SESSIONS per account and deletes expired sessions', async () => {
    await database.auditDb.insert(appSessions).values({ tokenHash: 'expired-row', username: 'avery.one', userId: 'u_analyst', createdAt: new Date('2026-01-01'), expiresAt: new Date('2026-01-01T08:00:00Z') });
    for (let i = 0; i < MAX_SESSIONS + 2; i++) await logIn(database.auditDb, 'avery.one', PASSWORD, new Date(Date.now() + i * 1000));
    const rows = await database.db.select().from(appSessions).where(eq(appSessions.username, 'avery.one'));
    expect(rows).toHaveLength(MAX_SESSIONS);
    expect(rows.some((r) => r.tokenHash === 'expired-row')).toBe(false);
  });
});

describe('AI2: model circuit breaker', () => {
  it('opens after 3 failures in a minute and closes after the cool-down', () => {
    const b = new ModelBreaker(3, 60_000, 300_000);
    b.failed(0);
    b.failed(10_000);
    expect(b.isOpen(10_001)).toBe(false);
    b.failed(20_000);
    expect(b.isOpen(20_001)).toBe(true);
    expect(b.isOpen(320_001)).toBe(false);
  });
  it('does not open for failures spread out over more than a minute', () => {
    const b = new ModelBreaker(3, 60_000, 300_000);
    b.failed(0);
    b.failed(50_000);
    b.failed(120_000);
    expect(b.isOpen(120_001)).toBe(false);
  });
});

describe('O3: production settings are checked at start-up', () => {
  it('requires a real AUDIT_HASH_KEY and sane invite settings in production only', () => {
    expect(productionConfigProblems({ NODE_ENV: 'development' })).toEqual([]);
    const bad = productionConfigProblems({ NODE_ENV: 'production', DEMO_INVITE_SECRET: 'short', DEMO_INVITE_EXPIRES: 'soon' });
    expect(bad.join(' ')).toMatch(/AUDIT_HASH_KEY/);
    expect(bad.join(' ')).toMatch(/DEMO_INVITE_SECRET/);
    expect(bad.join(' ')).toMatch(/DEMO_INVITE_EXPIRES/);
    expect(productionConfigProblems({ NODE_ENV: 'production', AUDIT_HASH_KEY: 'k'.repeat(32), DEMO_INVITE_SECRET: 's'.repeat(16) })).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: 'production' }, 'alerts')).toEqual([]);
  });
});
