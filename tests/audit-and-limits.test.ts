import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { appUsers, queryAudit } from '@/db/schema';
import { loadRegistry } from '@/registry/load';
import { answerIntent, ask, MAX_QUESTION_LENGTH } from '@/semantic/answer';
import { IntentError } from '@/semantic/compile';
import { ScopeViolation } from '@/semantic/scope';
import { RateLimiter } from '@/server/limits';
import { testIdentitiesEnabled } from '@/server/identity';

const reg = loadRegistry();
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

const last = async () => (await database.db.select().from(queryAudit).orderBy(desc(queryAudit.at)).limit(1))[0]!;

describe('query audit log (S4)', () => {
  it('records an answered question with metric version, scope, snapshot and result hash, but not the raw text', async () => {
    const phrase = 'What is our open pipeline?';
    const r = await ask(database, reg, 'u_ts_east', phrase);
    if (r.kind !== 'answer') throw new Error('expected an answer');
    const row = await last();
    expect(row).toMatchObject({
      userId: 'u_ts_east',
      role: 'technical_seller',
      source: 'question',
      outcome: 'answered',
      metricId: 'open_pipeline',
      metricVersion: 1,
      regions: ['east'],
      resultHash: r.provenance.resultHash,
      questionSha256: createHash('sha256').update(phrase).digest('hex'),
    });
    expect(JSON.stringify(row)).not.toContain(phrase);
  });

  it('records a scope refusal', async () => {
    await expect(ask(database, reg, 'u_ts_east', 'number of open deals in the west')).rejects.toBeInstanceOf(ScopeViolation);
    expect(await last()).toMatchObject({ userId: 'u_ts_east', outcome: 'refused_scope', reason: 'You do not have access to region: west' });
  });

  it('records an invalid intent and an unknown user', async () => {
    await expect(answerIntent(database, reg, 'u_analyst', { metric: 'drop_tables', filters: {}, groupBy: [] })).rejects.toBeInstanceOf(IntentError);
    expect((await last()).outcome).toBe('refused_intent');
    await expect(ask(database, reg, 'u_new_ceo', 'What is our open pipeline?')).rejects.toBeInstanceOf(ScopeViolation);
    expect(await last()).toMatchObject({ userId: 'u_new_ceo', outcome: 'refused_scope', reason: 'Unknown user' });
  });

  it('returns no answer when the audit row cannot be written', async () => {
    const broken: Database = { ...database, auditDb: { insert: () => { throw new Error('audit store down'); } } as never };
    await expect(ask(broken, reg, 'u_analyst', 'What is our open pipeline?')).rejects.toThrow('audit store down');
  });
});

describe('fail closed', () => {
  it('refuses a user whose role is not recognized', async () => {
    await database.db.insert(appUsers).values({ id: 'u_weird', displayName: 'Weird role', role: 'ceo', regionId: 'east', managerId: null, source: 'test' });
    await expect(ask(database, reg, 'u_weird', 'What is our open pipeline?')).rejects.toBeInstanceOf(ScopeViolation);
  });
});

describe('limits (T-07)', () => {
  it('refuses questions over the length limit', async () => {
    await expect(ask(database, reg, 'u_analyst', 'pipeline '.repeat(MAX_QUESTION_LENGTH))).rejects.toBeInstanceOf(IntentError);
    expect((await last()).outcome).toBe('refused_intent');
  });

  it('rate-limits each user separately', () => {
    const limiter = new RateLimiter(3, 60_000);
    const t = 1_000_000;
    expect([1, 2, 3].map(() => limiter.allow('a', t))).toEqual([true, true, true]);
    expect(limiter.allow('a', t)).toBe(false);
    expect(limiter.allow('b', t)).toBe(true);
    expect(limiter.allow('a', t + 60_001)).toBe(true);
  });
});

describe('test identities (F-01)', () => {
  it('are off unless explicitly turned on', () => {
    expect(testIdentitiesEnabled({})).toBe(false);
    expect(testIdentitiesEnabled({ ALLOW_TEST_IDENTITIES: '1' })).toBe(false);
    expect(testIdentitiesEnabled({ ALLOW_TEST_IDENTITIES: 'true' })).toBe(true);
  });
});
