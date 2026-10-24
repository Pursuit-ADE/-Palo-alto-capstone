// Runs only in Postgres mode (CI job "alerts-postgres", or locally with docker compose and both URLs set).
// The alerts login can read and record its own state, but cannot delete, change other data or the schema.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { openDatabase, type Database } from '@/db/client';
import { alertSubscriptions } from '@/db/schema';
import { createChannels } from '@/alerts/channels';
import { loadRules } from '@/alerts/rules';
import { tick } from '@/alerts/scheduler';

const enabled = Boolean(process.env.ALERTS_DATABASE_URL && process.env.MIGRATION_DATABASE_URL);

describe.skipIf(!enabled)('alerts Postgres least privilege', () => {
  let database: Database;
  let app: pg.Client;

  beforeAll(async () => {
    database = await openDatabase();
    app = new pg.Client({ connectionString: process.env.ALERTS_DATABASE_URL });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
    await database?.close();
  });

  const denied = (sql: string) => expect(app.query(sql)).rejects.toThrow(/permission denied|must be owner/);

  it('runs the scheduler and keeps its state across connections', async () => {
    expect(database.mode).toBe('postgres');
    await database.db
      .insert(alertSubscriptions)
      .values({ userId: 'u_ts_east', ruleId: 'high_severity_case', frequency: 'realtime', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false })
      .onConflictDoNothing();
    await tick(database.db, loadRules(), createChannels(), new Date('2026-10-08T15:00:00Z'), new Date('2026-09-01T00:00:00Z'));
    const cursor = await app.query('SELECT evaluated_until FROM alert_cursor');
    expect(cursor.rows).toHaveLength(1);
  });

  it('cannot delete alerts, change CRM data or the schema', async () => {
    await denied('DELETE FROM alert_deliveries');
    await denied("UPDATE opportunities SET amount = 0 WHERE id = 'x'");
    await denied("INSERT INTO regions (id, name) VALUES ('north', 'North')");
    await denied('CREATE TABLE stolen (x int)');
    await denied('DROP TABLE alert_cursor');
    // Sign-in: sessions can be added and removed, but an account's person can't be changed.
    await denied("UPDATE app_accounts SET user_id = 'u_analyst'");
    // Only the tables alerts need are readable: no deals, quotas or products.
    await denied('SELECT * FROM opportunities');
    await denied('SELECT * FROM quotas');
    await denied('SELECT * FROM products');
  });
});
