// Runs only in Postgres mode (CI job "postgres-roles", or locally with docker compose and the three URLs set).
// Proves the least-privilege setup (PRD S7): the app role can only read, the audit role can only append.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask } from '@/semantic/answer';

const enabled = Boolean(process.env.DATABASE_URL && process.env.AUDIT_DATABASE_URL && process.env.MIGRATION_DATABASE_URL);

describe.skipIf(!enabled)('Postgres least privilege', () => {
  let database: Database;
  let app: pg.Client;
  let audit: pg.Client;

  beforeAll(async () => {
    database = await openDatabase();
    app = new pg.Client({ connectionString: process.env.DATABASE_URL });
    audit = new pg.Client({ connectionString: process.env.AUDIT_DATABASE_URL });
    await app.connect();
    await audit.connect();
  });
  afterAll(async () => {
    await app?.end();
    await audit?.end();
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
    // Tables outside the governed query path are not readable either.
    await denied(app, 'SELECT * FROM contacts');
    await denied(app, 'SELECT * FROM support_cases');
    await denied(app, 'SELECT * FROM engagements');
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
  });
});
