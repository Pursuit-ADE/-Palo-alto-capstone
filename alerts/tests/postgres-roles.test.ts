// Runs only in Postgres mode (the "Postgres roles" step of alerts-ci.yml's test job, or locally with docker compose and both URLs set).
// The alerts login can read and record its own state, but cannot delete, change other data or the schema.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { openDatabase, type Database } from '@/db/client';
import { alertSubscriptions } from '@/db/schema';
import { createChannels } from '@/alerts/channels';
import { loadRules } from '@/alerts/rules';
import { runAlerts } from '@/alerts/engine';
import { accountTeam, alertDeliveries, dataSnapshots } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { tick } from '@/alerts/scheduler';
import { allowAttempt } from '@/server/login-limit';

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

  // Real Postgres, through the alerts login: attempts on separate connections must still be counted one at a time.
  it('lets in exactly the sign-in limit when attempts arrive at the same moment', async () => {
    const key = `login:parallel-${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => allowAttempt(database.db, key, 10)));
    expect(results.filter(Boolean)).toHaveLength(10);
  });

  it('cannot delete alerts, change CRM data or the schema', async () => {
    await denied('DELETE FROM alert_deliveries');
    await denied("UPDATE opportunities SET amount = 0 WHERE id = 'x'");
    await denied("INSERT INTO regions (id, name) VALUES ('north', 'North')");
    await denied('CREATE TABLE stolen (x int)');
    await denied('DROP TABLE alert_cursor');
    // Sign-in: sessions can be added and removed, but an account's person can't be changed.
    await denied("UPDATE app_accounts SET user_id = 'u_analyst'");
    // The low-usage rule reads the snapshot date, and cannot change a snapshot.
    await app.query('SELECT id, as_of_date FROM data_snapshots');
    await denied("UPDATE data_snapshots SET notes = 'x'");
    // Only the tables alerts need are readable: no deals, quotas or products.
    await denied('SELECT * FROM opportunities');
    await denied('SELECT * FROM quotas');
    await denied('SELECT * FROM products');
  });
});

// Project review, Nov 1, finding 3: a queued case alert follows its case. The new reads and the in-place update run on the
// alerts login alone; the case is added and escalated with the owner login, as the data loader would.
describe.skipIf(!enabled)('Postgres: a queued case alert follows its case', () => {
  it('promotes a case that escalates to P1 for a subscriber with the bypass, using only the alerts login', async () => {
    const database = await openDatabase();
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    try {
      const [snapshot] = await database.db.select({ id: dataSnapshots.id }).from(dataSnapshots);
      const [team] = await database.db.select({ accountId: accountTeam.accountId }).from(accountTeam).where(eq(accountTeam.userId, 'u_ts_east')).limit(1);
      await owner.query(`INSERT INTO support_cases (id, snapshot_id, account_id, severity, status, subject, opened_at) VALUES ('case_pg_follow', $1, $2, 'P2', 'Open', 'Outage', '2026-10-08T10:00:00Z')`, [snapshot!.id, team!.accountId]);
      await database.db
        .insert(alertSubscriptions)
        .values({ userId: 'u_ts_east', ruleId: 'high_severity_case', frequency: 'daily', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: true })
        .onConflictDoUpdate({ target: [alertSubscriptions.userId, alertSubscriptions.ruleId], set: { frequency: 'daily', criticalBypass: true } });
      const sent: string[] = [];
      const channels = { async deliver(_c: string, _u: string, items: { id: string }[]) { sent.push(...items.map((i) => i.id)); return true; } };
      const [since, now] = [new Date('2026-09-01T00:00:00Z'), new Date('2026-10-08T15:00:00Z')];
      await runAlerts(database.db, loadRules(), channels, since, now);
      const mine = () => database.db.select().from(alertDeliveries).where(and(eq(alertDeliveries.userId, 'u_ts_east'), eq(alertDeliveries.eventId, 'case_pg_follow')));
      expect((await mine())[0]).toMatchObject({ status: 'queued_digest', severity: 'P2' });
      await owner.query(`UPDATE support_cases SET severity = 'P1' WHERE id = 'case_pg_follow'`);
      await runAlerts(database.db, loadRules(), channels, since, now);
      expect((await mine())[0]).toMatchObject({ status: 'delivered', severity: 'P1' });
      expect(sent).toContain('alert_high_severity_case_u_ts_east_case_pg_follow');
    } finally {
      await owner.query(`DELETE FROM alert_deliveries WHERE event_id = 'case_pg_follow'`);
      await owner.query(`DELETE FROM support_cases WHERE id = 'case_pg_follow'`);
      await owner.end();
      await database.close();
    }
  });
});
