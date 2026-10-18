// Runs only in Postgres mode (CI job "postgres-roles", or locally with docker compose and the three URLs set).
// Proves the least-privilege setup (PRD S7): the app role can only read, the audit role can only append.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask } from '@/semantic/answer';

const enabled = Boolean(process.env.DATABASE_URL && process.env.AUDIT_DATABASE_URL && process.env.AUTH_DATABASE_URL && process.env.MIGRATION_DATABASE_URL);

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

  it('answers governed questions through the read-only role and audits them', async () => {
    expect(database.mode).toBe('postgres');
    const r = await ask(database, loadRegistry(), 'u_ts_east', 'What is our open pipeline?');
    expect(r.kind).toBe('answer');
  });

  it('the app role cannot write, change schema or read the audit log', async () => {
    await denied(app, "UPDATE opportunities SET amount = 0 WHERE id = 'x'");
    await denied(app, 'DELETE FROM accounts');
    await denied(app, "INSERT INTO regions (id, name) VALUES ('north', 'North')");
    await denied(app, 'CREATE TABLE stolen (x int)');
    await denied(app, 'DROP TABLE quotas');
    await denied(app, 'SELECT * FROM query_audit');
    await denied(app, 'SELECT * FROM session_guard');
    await denied(app, "UPDATE session_guard SET hits = '[]'");
    // Tables outside the governed query path are not readable either.
    await denied(app, 'SELECT * FROM contacts');
    await denied(app, 'SELECT * FROM support_cases');
    await denied(app, 'SELECT * FROM engagements');
    // Demo sign-in tables: never readable by the answering login.
    await denied(app, 'SELECT * FROM app_accounts');
    await denied(app, 'SELECT * FROM app_sessions');
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
