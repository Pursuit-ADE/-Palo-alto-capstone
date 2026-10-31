// Database access for the alerts service.
//
// Default: PGlite (embedded Postgres) in memory, so the demo and tests run anywhere; state resets on restart.
// Postgres mode (persistent; see .env.example and ../docker/init-roles.sql):
//   MIGRATION_DATABASE_URL  owner role: migrations, data load and grants. Set it only for `npm run db:setup` (or on a
//                           laptop); a deployed server should not hold it.
//   ALERTS_DATABASE_URL     alerts_app: reads the CRM tables, events and the snapshot date; may only insert and update alert
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
import { assertNoTestIdentitiesInProduction } from '../server/identity';
import { buildSeed, DEFAULT_SEED } from './seed';
import { assertProductionConfig } from '../server/config';

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
  // Test identities in production would let anyone view the app as any demo person: refuse to start.
  assertNoTestIdentitiesInProduction();
  assertProductionConfig(process.env, 'alerts');
  // The alerts service only has the Maven dataset. If the copilot was switched to another dataset, refuse to start
  // rather than alert on different accounts than the copilot shows.
  const datasetDir = process.env.DATASET_DIR;
  if (datasetDir && path.basename(path.resolve(datasetDir)) !== 'maven-crm') {
    throw new Error(`The alerts service only supports the Maven dataset; DATASET_DIR=${datasetDir} is not supported yet. Unset DATASET_DIR for alerts, or run alerts only with the Maven copilot.`);
  }
  const { ALERTS_DATABASE_URL, MIGRATION_DATABASE_URL } = process.env;
  if (ALERTS_DATABASE_URL || MIGRATION_DATABASE_URL) {
    if (!ALERTS_DATABASE_URL) throw new Error('Postgres mode needs ALERTS_DATABASE_URL (and MIGRATION_DATABASE_URL for setup)');
    return openPostgres(ALERTS_DATABASE_URL, MIGRATION_DATABASE_URL, seed);
  }
  // The embedded database forgets everything on restart and has no separate login, so a production server
  // refuses it unless it is explicitly the laptop demo.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_EMBEDDED_DB !== 'true') {
    throw new Error('Production needs Postgres mode (ALERTS_DATABASE_URL). Set ALLOW_EMBEDDED_DB=true only for a local demo.');
  }
  const client = new PGlite();
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  await migratePglite(db as never, { migrationsFolder: MIGRATIONS });
  if ((await db.select().from(schema.dataSnapshots)).length === 0) await loadSeed(db, seed);
  return { db, mode: 'pglite', close: () => client.close() };
}

// Fail fast instead of hanging when the database is unreachable, and keep the number of connections bounded.
const POOL = { connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 };

/**
 * A pooled connection that Postgres drops (a restart, an admin kill) is reported here instead of reaching Node as an
 * unhandled 'error' event; the pool opens a fresh connection on the next query.
 */
function pool(config: pg.PoolConfig): pg.Pool {
  const p = new pg.Pool(config);
  p.on('error', (e) => console.error('database connection dropped; the next query reconnects', (e as { code?: string }).code ?? e.name));
  return p;
}

/** Migrations, data load and grants, as the owner login. Run by `npm run db:setup`, or at start when the owner URL is set. */
export async function setupDatabase(ownerUrl: string, seed: string = DEFAULT_SEED) {
  const owner = pool({ connectionString: ownerUrl, max: 1, ...POOL });
  try {
    const ownerDb = drizzlePg(owner, { schema });
    await migratePg(ownerDb, { migrationsFolder: MIGRATIONS });
    if ((await ownerDb.select().from(schema.dataSnapshots)).length === 0) await loadSeed(ownerDb as unknown as Db, seed);
    await applyGrants(owner);
  } finally {
    await owner.end();
  }
}

async function openPostgres(appUrl: string, ownerUrl: string | undefined, seed: string): Promise<Database> {
  if (ownerUrl) await setupDatabase(ownerUrl, seed);
  const app = pool({ connectionString: appUrl, max: 10, ...POOL, options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS}` });
  return { db: drizzlePg(app, { schema }) as unknown as Db, mode: 'postgres', close: () => app.end() };
}

/** Least privilege: read only what alerts need, write only its own state, delete only its own subscriptions, never change the schema. */
async function applyGrants(owner: pg.Pool) {
  await owner.query(`
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM alerts_app;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO alerts_app;
    -- Only what alert matching, routing and the inbox read: no deals, quotas, products or regions.
    -- product_usage is the synthetic table the low-usage rule reads. The products catalog stays closed.
    -- data_snapshots is read-only: the low-usage rule needs the newest snapshot's as-of date. It never writes one.
    GRANT SELECT ON data_snapshots, app_users, accounts, account_team, contacts, support_cases, engagements, product_usage, alert_deliveries, alert_subscriptions, alert_cursor TO alerts_app;
    GRANT INSERT, UPDATE ON alert_deliveries, alert_subscriptions, alert_cursor TO alerts_app;
    GRANT DELETE ON alert_subscriptions TO alerts_app; -- unsubscribing; alert history is never deleted
    -- Demo sign-in (Week 5): accounts and sessions; no UPDATE, so an account's person can't be changed.
    GRANT SELECT, INSERT, DELETE ON app_accounts, app_sessions TO alerts_app;
    -- Brute-force counters: one row per attempt, deleted after a minute.
    GRANT SELECT, INSERT, DELETE ON login_attempts TO alerts_app;
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
    if (s.productUsage.length) await tx.insert(schema.productUsage).values(s.productUsage);
  });
}
