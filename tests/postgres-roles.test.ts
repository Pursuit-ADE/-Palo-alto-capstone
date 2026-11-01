// Runs only in Postgres mode (the "Postgres roles" step of ci.yml's test job, or locally with docker compose and the three URLs set).
// Proves the least-privilege setup (PRD S7): the app role can only read, the audit role can only append.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DatasetMismatch, openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask } from '@/semantic/answer';

const enabled = Boolean(process.env.DATABASE_URL && process.env.AUDIT_DATABASE_URL && process.env.AUTH_DATABASE_URL && process.env.MIGRATION_DATABASE_URL);

async function expectAppWritesDenied(app: pg.Client, denied: (c: pg.Client, sql: string) => Promise<void>) {
  await denied(app, "UPDATE opportunities SET amount = 0 WHERE id = 'x'");
  await denied(app, 'DELETE FROM accounts');
  await denied(app, "INSERT INTO regions (id, name) VALUES ('north', 'North')");
  await denied(app, 'CREATE TABLE stolen (x int)');
  await denied(app, 'DROP TABLE quotas');
  await denied(app, 'SELECT * FROM session_guard');
  await denied(app, "UPDATE session_guard SET hits = '[]'");
  await denied(app, 'SELECT * FROM contacts');
  await denied(app, 'SELECT * FROM support_cases');
  await denied(app, 'SELECT * FROM engagements');
  await denied(app, 'SELECT * FROM app_accounts');
  await denied(app, 'SELECT * FROM app_sessions');
}

describe.skipIf(!enabled)('Postgres least privilege', () => {
  let database: Database;
  let app: pg.Client;
  let audit: pg.Client;
  let auth: pg.Client;

  beforeAll(async () => {
    database = await openDatabase();
    app = new pg.Client({ connectionString: process.env.DATABASE_URL });
    audit = new pg.Client({ connectionString: process.env.AUDIT_DATABASE_URL });
    auth = new pg.Client({ connectionString: process.env.AUTH_DATABASE_URL });
    await app.connect();
    await audit.connect();
    await auth.connect();
  });
  afterAll(async () => {
    await app?.end();
    await audit?.end();
    await auth?.end();
    await database?.close();
  });

  const denied = async (c: pg.Client, sql: string) => {
    await expect(c.query(sql)).rejects.toThrow(/permission denied|read-only transaction/);
  };

  it('the app role can read question counts and still cannot read the audit log', async () => {
    await app.query('SELECT week, metric, outcome, count FROM question_trends');
    await app.query('SELECT week, topic, outcome, count FROM question_topics');
    await denied(app, 'SELECT * FROM query_audit');
  });

  it('answers governed questions through the read-only role and audits them', async () => {
    expect(database.mode).toBe('postgres');
    const r = await ask(database, loadRegistry(), 'u_ts_east', 'What is our open pipeline?');
    expect(r.kind).toBe('answer');
  });

  it('the app role cannot write, change schema or read tables outside its grant', async () => {
    await expectAppWritesDenied(app, denied);
  });

  it('the app role has a statement timeout', async () => {
    const r = await app.query('SHOW statement_timeout');
    expect(r.rows[0].statement_timeout).toBe('5s');
  });

  it('the audit role can only append to the audit log', async () => {
    await denied(audit, 'SELECT * FROM opportunities');
    await denied(audit, 'SELECT * FROM query_audit');
    await denied(audit, "UPDATE query_audit SET outcome = 'answered'");
    await denied(audit, 'DELETE FROM query_audit');
    // Accounts and sessions belong to the auth login: the audit login can't read password hashes or tokens.
    await denied(audit, 'SELECT * FROM app_accounts');
    await denied(audit, 'SELECT * FROM app_sessions');
    await denied(audit, "UPDATE app_accounts SET user_id = 'u_analyst'");
  });

  it('the auth role can only manage accounts, sessions and the sign-in limit', async () => {
    await auth.query('SELECT username FROM app_accounts');
    await auth.query('SELECT token_hash FROM app_sessions');
    await denied(auth, 'SELECT * FROM opportunities');
    await denied(auth, 'SELECT * FROM query_audit');
    await denied(auth, "INSERT INTO query_audit (id, at, request_id, source, user_id, outcome) VALUES ('x', now(), 'x', 'x', 'x', 'x')");
    await denied(auth, 'SELECT * FROM contacts');
    // It can't change which person an account belongs to, or rewrite a password hash.
    await denied(auth, "UPDATE app_accounts SET user_id = 'u_analyst'");
    await denied(auth, "UPDATE app_accounts SET password_hash = 'x'");
  });

  it('the audit and auth roles have statement timeouts', async () => {
    for (const c of [audit, auth]) expect((await c.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('5s');
  });

  it('the audit role can update the session guard and nothing else', async () => {
    await audit.query(`INSERT INTO session_guard (user_id, hits, flagged) VALUES ('u_guard', '[]', '[]')`);
    await audit.query(`UPDATE session_guard SET hits = '[1]' WHERE user_id = 'u_guard'`);
    await audit.query(`DELETE FROM session_guard WHERE user_id = 'u_guard'`);
    await denied(audit, 'SELECT * FROM opportunities');
    await denied(audit, "UPDATE accounts SET name = 'x'");
  });
});

// Project review, Nov 1, finding 5: a normal start has no owner login, and used to skip the dataset checks that only
// setup ran, so a server pointed at another folder came up over this database. Opened on the runtime logins alone.
describe.skipIf(!enabled)('Postgres start without the owner login', () => {
  it('refuses a dataset the database does not hold, and starts on the one it does', async () => {
    const owner = process.env.MIGRATION_DATABASE_URL;
    delete process.env.MIGRATION_DATABASE_URL;
    try {
      await expect(openDatabase(undefined, { dataDir: path.join(process.cwd(), 'data', 'northstar-crm') })).rejects.toBeInstanceOf(DatasetMismatch);
      const matching = await openDatabase();
      await matching.close();
    } finally {
      if (owner) process.env.MIGRATION_DATABASE_URL = owner;
    }
  });
});
