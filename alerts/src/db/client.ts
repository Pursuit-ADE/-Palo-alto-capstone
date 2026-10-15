// Database access for the alerts service.
//
// Default: PGlite (embedded Postgres) in memory, so the demo and tests run anywhere; state resets on restart.
// Postgres mode (persistent; set both URLs, see .env.example and ../docker/init-roles.sql):
//   MIGRATION_DATABASE_URL  owner role: runs migrations, loads data, applies grants. Never used at runtime.
//   ALERTS_DATABASE_URL     alerts_app: reads the CRM and event tables; may only insert and update alert
//                           deliveries, subscriptions and the scheduler cursor, and delete only a subscription
//                           (unsubscribing). No other deletes, no schema changes.
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import path from 'node:path';
import * as schema from './schema';
import { buildSeed, DEFAULT_SEED } from './seed';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  mode: 'pglite' | 'postgres';
  close(): Promise<void>;
}

const MIGRATIONS = path.join(process.cwd(), 'drizzle');
export const STATEMENT_TIMEOUT_MS = 10_000;

/** Opens a database, applies migrations and loads the dataset if it is empty. */
export async function openDatabase(seed: string = DEFAULT_SEED): Promise<Database> {
  const { ALERTS_DATABASE_URL, MIGRATION_DATABASE_URL } = process.env;
  if (ALERTS_DATABASE_URL || MIGRATION_DATABASE_URL) {
    if (!ALERTS_DATABASE_URL || !MIGRATION_DATABASE_URL) {
      throw new Error('Postgres mode needs ALERTS_DATABASE_URL and MIGRATION_DATABASE_URL together');
    }
    return openPostgres(ALERTS_DATABASE_URL, MIGRATION_DATABASE_URL, seed);
  }
  // The embedded database forgets everything on restart and has no separate login, so a production server
  // refuses it unless it is explicitly the laptop demo.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_IDENTITIES !== 'true' && process.env.ALLOW_EMBEDDED_DB !== 'true') {
    throw new Error('Production needs Postgres mode (ALERTS_DATABASE_URL and MIGRATION_DATABASE_URL). Set ALLOW_EMBEDDED_DB=true only for a local demo.');
  }
  const client = new PGlite();
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  await migratePglite(db as never, { migrationsFolder: MIGRATIONS });
  if ((await db.select().from(schema.dataSnapshots)).length === 0) await loadSeed(db, seed);
  return { db, mode: 'pglite', close: () => client.close() };
}

async function openPostgres(appUrl: string, ownerUrl: string, seed: string): Promise<Database> {
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const ownerDb = drizzlePg(owner, { schema });
    await migratePg(ownerDb, { migrationsFolder: MIGRATIONS });
    if ((await ownerDb.select().from(schema.dataSnapshots)).length === 0) await loadSeed(ownerDb as unknown as Db, seed);
    await applyGrants(owner);
  } finally {
    await owner.end();
  }
  const app = new pg.Pool({ connectionString: appUrl, options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS}` });
  return { db: drizzlePg(app, { schema }) as unknown as Db, mode: 'postgres', close: () => app.end() };
}

/** Least privilege: read only what alerts need, write only its own state, delete only its own subscriptions, never change the schema. */
async function applyGrants(owner: pg.Pool) {
  await owner.query(`
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM alerts_app;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO alerts_app;
    -- Only what alert matching, routing and the inbox read: no deals, quotas, products or regions.
    GRANT SELECT ON app_users, accounts, account_team, contacts, support_cases, engagements, alert_deliveries, alert_subscriptions, alert_cursor TO alerts_app;
    GRANT INSERT, UPDATE ON alert_deliveries, alert_subscriptions, alert_cursor TO alerts_app;
    GRANT DELETE ON alert_subscriptions TO alerts_app; -- unsubscribing; alert history is never deleted
  `);
}

function chunks<T>(rows: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function loadSeed(db: Db, seed: string = DEFAULT_SEED) {
  const s = buildSeed(seed);
  await db.transaction(async (tx) => {
    await tx.insert(schema.dataSnapshots).values(s.snapshot);
    await tx.insert(schema.regions).values(s.regions);
    await tx.insert(schema.appUsers).values(s.users);
    await tx.insert(schema.products).values(s.products);
    await tx.insert(schema.accounts).values(s.accounts);
    for (const c of chunks(s.accountTeam)) await tx.insert(schema.accountTeam).values(c);
    await tx.insert(schema.contacts).values(s.contacts);
    for (const c of chunks(s.opportunities)) await tx.insert(schema.opportunities).values(c);
    await tx.insert(schema.quotas).values(s.quotas);
    if (s.supportCases.length) await tx.insert(schema.supportCases).values(s.supportCases);
    if (s.engagements.length) await tx.insert(schema.engagements).values(s.engagements);
  });
}
