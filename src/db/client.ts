// Database access.
//
// Default: PGlite (embedded Postgres) in memory, so the app and tests run on any laptop without Docker.
// Postgres mode (set all three URLs, see .env.example and docker/init-roles.sql):
//   MIGRATION_DATABASE_URL  owner role: runs migrations, loads data, applies grants. Never used to answer questions.
//   DATABASE_URL            app_readonly: SELECT only, with a statement timeout. Answers every question.
//   AUDIT_DATABASE_URL      app_audit: INSERT on query_audit only. Writes the audit log.
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

export interface QueryClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Database {
  /** Read access used to answer questions (read-only role in Postgres mode). */
  db: Db;
  /** Raw parameterized queries on the same read-only connection. */
  client: QueryClient;
  /** Insert-only access to the audit log. */
  auditDb: Db;
  mode: 'pglite' | 'postgres';
  close(): Promise<void>;
}

const MIGRATIONS = path.join(process.cwd(), 'drizzle');
export const STATEMENT_TIMEOUT_MS = 5000;

/** Opens a database, applies migrations and loads the dataset if it is empty. */
export async function openDatabase(seed: string = DEFAULT_SEED): Promise<Database> {
  const { DATABASE_URL, AUDIT_DATABASE_URL, MIGRATION_DATABASE_URL } = process.env;
  if (DATABASE_URL || AUDIT_DATABASE_URL || MIGRATION_DATABASE_URL) {
    if (!DATABASE_URL || !AUDIT_DATABASE_URL || !MIGRATION_DATABASE_URL) {
      throw new Error('Postgres mode needs DATABASE_URL, AUDIT_DATABASE_URL and MIGRATION_DATABASE_URL together');
    }
    return openPostgres(DATABASE_URL, AUDIT_DATABASE_URL, MIGRATION_DATABASE_URL, seed);
  }
  // The embedded database has no separate read-only and audit logins and forgets everything on restart, so a
  // production server refuses it unless it is explicitly the laptop demo.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_IDENTITIES !== 'true' && process.env.ALLOW_EMBEDDED_DB !== 'true') {
    throw new Error('Production needs Postgres mode (DATABASE_URL, AUDIT_DATABASE_URL, MIGRATION_DATABASE_URL). Set ALLOW_EMBEDDED_DB=true only for a local demo.');
  }
  const client = new PGlite();
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  await migratePglite(db as never, { migrationsFolder: MIGRATIONS });
  if ((await db.select().from(schema.dataSnapshots)).length === 0) await loadSeed(db, seed);
  return { db, client, auditDb: db, mode: 'pglite', close: () => client.close() };
}

async function openPostgres(appUrl: string, auditUrl: string, ownerUrl: string, seed: string): Promise<Database> {
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
  const audit = new pg.Pool({ connectionString: auditUrl, max: 2 });
  return {
    db: drizzlePg(app, { schema }) as unknown as Db,
    client: { query: async (text, params) => app.query(text, params as unknown[]) as never },
    auditDb: drizzlePg(audit, { schema }) as unknown as Db,
    mode: 'postgres',
    close: async () => {
      await app.end();
      await audit.end();
    },
  };
}

/** Least privilege: the app role can only read the governed tables; the audit role can only append to the audit log. */
async function applyGrants(owner: pg.Pool) {
  await owner.query(`
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_readonly, app_audit;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO app_readonly, app_audit;
    -- Only the tables the governed query path reads. Contacts, support cases, engagements and the audit log
    -- are not readable, so a bug above the database can't reach them through this login.
    GRANT SELECT ON data_snapshots, regions, app_users, products, accounts, account_team, opportunities, quotas TO app_readonly;
    GRANT INSERT ON query_audit TO app_audit;
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
