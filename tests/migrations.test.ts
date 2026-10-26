// Upgrades must keep working: a database created from main's baseline migration must upgrade to the current
// schema with the same migrator the app runs on start. Migrations are append-only; never rewrite an applied one.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

const MIGRATIONS = path.join(process.cwd(), 'drizzle');

describe('migrations', () => {
  it('upgrades a database created from the baseline (main) to the current schema', async () => {
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
    expect(journal.entries[0].tag).toBe('0000_init');
    // A copy of the migrations folder that only knows the first migration: the baseline database.
    const baseline = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.cpSync(MIGRATIONS, baseline, { recursive: true });
    fs.writeFileSync(path.join(baseline, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: [journal.entries[0]] }));

    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: baseline });
    const before = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'query_audit'");
    expect(before.rows[0]!.n).toBe(0);

    await migrate(db, { migrationsFolder: MIGRATIONS }); // the upgrade: must not try to recreate existing tables
    await migrate(db, { migrationsFolder: MIGRATIONS }); // and running it again on start is a no-op
    const cols = await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'query_audit'");
    expect(cols.rows.map((r) => r.column_name)).toEqual(expect.arrayContaining(['question_sha256', 'flags', 'model', 'turn', 'topic']));
    const purchased = await client.query<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'product_usage_purchased_quantity_positive'");
    expect(purchased.rows[0]?.def).toContain('purchased_quantity > 0');
    await client.query(`INSERT INTO query_audit (id, at, request_id, source, user_id, outcome, metric_id) VALUES
      ('q1', '2026-10-20T12:00:00Z', 'r1', 'question', 'u', 'answered', 'pipeline_coverage'),
      ('q2', '2026-10-20T12:00:00Z', 'r2', 'dashboard', 'u', 'answered', 'open_pipeline')`);
    const trends = await client.query<{ week: string; metric: string; outcome: string; count: number }>(
      "SELECT week::text AS week, metric, outcome, count FROM question_trends",
    );
    expect(trends.rows).toEqual([{ week: '2026-10-19', metric: 'pipeline_coverage', outcome: 'answered', count: 1 }]);
    await client.query(`INSERT INTO query_audit (id, at, request_id, source, user_id, outcome, topic) VALUES
      ('q3', '2026-10-20T12:00:00Z', 'r3', 'question', 'u', 'unsupported', 'support_cases')`);
    const topics = await client.query<{ week: string; topic: string; outcome: string; count: number }>(
      'SELECT week::text AS week, topic, outcome, count FROM question_topics',
    );
    expect(topics.rows).toEqual([{ week: '2026-10-19', topic: 'support_cases', outcome: 'unsupported', count: 1 }]);
    await client.close();
  });

  it('only ever appends migrations', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
    expect(journal.entries.map((e: { idx: number }) => e.idx)).toEqual(journal.entries.map((_: unknown, i: number) => i));
  });
});
