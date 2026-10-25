// Database access.
//
// Default: PGlite (embedded Postgres) in memory, so the app and tests run on any laptop without Docker.
// Postgres mode (see .env.example and docker/init-roles.sql):
//   DATABASE_URL            app_readonly: SELECT only, with a statement timeout. Answers every question.
//   AUDIT_DATABASE_URL      app_audit: INSERT on query_audit, plus the question rate limit and lock. Writes the audit log.
//   AUTH_DATABASE_URL       app_auth: demo accounts, sessions and the sign-in limit. Nothing else.
//   MIGRATION_DATABASE_URL  owner role: migrations, data load and grants. Set it only for `npm run db:setup` (or on a
//                           laptop); a deployed server should not hold it, so it can't be used to take over the database.
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import path from 'node:path';
import * as schema from './schema';
import { assertProductionConfig } from '../server/config';
import { assertNoTestIdentitiesInProduction } from '../server/identity';
import { buildSeed, defaultSeedForDir, resolveDataDir } from './seed';
import { assertDatasetConfirmed } from '../onboard/confirm';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface QueryClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Database {
  /** Read access used to answer questions (read-only role in Postgres mode). */
  db: Db;
  /** Raw parameterized queries on the same read-only connection. */
  client: QueryClient;
  /** Insert-only access to the audit log (and the question rate limit and lock). */
  auditDb: Db;
  /** Demo accounts and sessions only (app_auth in Postgres mode). */
  authDb: Db;
  mode: 'pglite' | 'postgres';
  close(): Promise<void>;
}

const MIGRATIONS = path.join(process.cwd(), 'drizzle');
export const STATEMENT_TIMEOUT_MS = 5000;

/** Opens a database, applies migrations and loads the dataset if it is empty. */
export async function openDatabase(seed?: string, options: { dataDir?: string } = {}): Promise<Database> {
  // Test identities in production would let anyone view the app as any demo person: refuse to start.
  assertNoTestIdentitiesInProduction();
  assertProductionConfig(process.env, 'copilot');
  const { DATABASE_URL, AUDIT_DATABASE_URL, AUTH_DATABASE_URL, MIGRATION_DATABASE_URL } = process.env;
  if (DATABASE_URL || AUDIT_DATABASE_URL || AUTH_DATABASE_URL || MIGRATION_DATABASE_URL) {
    if (!DATABASE_URL || !AUDIT_DATABASE_URL || !AUTH_DATABASE_URL) {
      throw new Error('Postgres mode needs DATABASE_URL, AUDIT_DATABASE_URL and AUTH_DATABASE_URL (and MIGRATION_DATABASE_URL for setup)');
    }
    return openPostgres({ app: DATABASE_URL, audit: AUDIT_DATABASE_URL, auth: AUTH_DATABASE_URL, owner: MIGRATION_DATABASE_URL }, seed, options);
  }
  // The embedded database has no separate read-only and audit logins and forgets everything on restart, so a
  // production server refuses it unless it is explicitly the laptop demo.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_EMBEDDED_DB !== 'true') {
    throw new Error('Production needs Postgres mode (DATABASE_URL, AUDIT_DATABASE_URL, AUTH_DATABASE_URL). Set ALLOW_EMBEDDED_DB=true only for a local demo.');
  }
  const client = new PGlite();
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  try {
    await migratePglite(db as never, { migrationsFolder: MIGRATIONS });
    await prepareDataset(db, seed, options);
  } catch (e) {
    await client.close(); // a failed start doesn't leave the embedded database open
    throw e;
  }
  return { db, client, auditDb: db, authDb: db, mode: 'pglite', close: () => client.close() };
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
export async function setupDatabase(ownerUrl: string, seed?: string, options: { dataDir?: string } = {}) {
  const owner = pool({ connectionString: ownerUrl, max: 1, ...POOL });
  try {
    const ownerDb = drizzlePg(owner, { schema });
    await migratePg(ownerDb, { migrationsFolder: MIGRATIONS });
    await prepareDataset(ownerDb as unknown as Db, seed, options);
    await applyGrants(owner);
  } finally {
    await owner.end();
  }
}

async function openPostgres(urls: { app: string; audit: string; auth: string; owner?: string }, seed: string | undefined, options: { dataDir?: string } = {}): Promise<Database> {
  if (urls.owner) await setupDatabase(urls.owner, seed, options);
  const app = pool({ connectionString: urls.app, max: 10, ...POOL, options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS}` });
  const audit = pool({ connectionString: urls.audit, max: 4, ...POOL });
  const auth = pool({ connectionString: urls.auth, max: 4, ...POOL });
  return {
    db: drizzlePg(app, { schema }) as unknown as Db,
    client: { query: async (text, params) => app.query(text, params as unknown[]) as never },
    auditDb: drizzlePg(audit, { schema }) as unknown as Db,
    authDb: drizzlePg(auth, { schema }) as unknown as Db,
    mode: 'postgres',
    close: async () => {
      await app.end();
      await audit.end();
      await auth.end();
    },
  };
}

/**
 * Least privilege: the app role can only read the governed tables; the audit role can append to the audit log and
 * keep the question rate limit; the auth role can only manage demo accounts and sessions.
 */
async function applyGrants(owner: pg.Pool) {
  await owner.query(`
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_readonly, app_audit, app_auth;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO app_readonly, app_audit, app_auth;
    -- Only the tables the governed query path reads. Contacts, support cases, engagements and the audit log
    -- are not readable, so a bug above the database can't reach them through this login.
    GRANT SELECT ON data_snapshots, regions, app_users, products, accounts, account_team, opportunities, quotas TO app_readonly;
    GRANT INSERT ON query_audit TO app_audit;
    REVOKE SELECT ON session_guard FROM app_readonly;
    GRANT SELECT, INSERT, UPDATE, DELETE ON session_guard TO app_audit;
    -- Demo sign-in: accounts, sessions and the sign-in limit belong to the auth login only, so neither the
    -- answering nor the audit login can read password hashes or session tokens.
    GRANT SELECT, INSERT, DELETE ON app_accounts, app_sessions TO app_auth;
    GRANT SELECT, INSERT, UPDATE, DELETE ON session_guard TO app_auth;
  `);
}

function chunks<T>(rows: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export class DatasetMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetMismatch';
  }
}

/**
 * Makes sure the database holds the dataset this server was started for. An empty database is loaded. A
 * database that already holds another dataset is refused rather than shown under the new name: labels, demo
 * people, invite codes and filter checks all follow the requested folder, so they must match what is stored.
 * A second dataset chosen by DATASET_DIR also needs a person's confirmation first (PRD A7); tests and scripts that
 * pass a folder explicitly are already choosing it in code.
 */
export async function prepareDataset(db: Db, seed?: string, options: { dataDir?: string } = {}) {
  const envDir = process.env.DATASET_DIR;
  if (!options.dataDir && envDir && resolveDataDir(envDir) !== resolveDataDir(path.join('data', 'maven-crm'))) assertDatasetConfirmed(envDir);
  const dataDir = options.dataDir ?? envDir;
  const expected = `snap_${seed ?? defaultSeedForDir(dataDir)}`;
  const stored = await db.select({ id: schema.dataSnapshots.id }).from(schema.dataSnapshots);
  if (stored.length === 0) return loadSeed(db, seed, { dataDir });
  if (!stored.some((s) => s.id === expected)) {
    throw new DatasetMismatch(
      `This database already holds ${stored.map((s) => s.id).join(', ')}, but the app was started for ${expected} (${dataDir ?? 'data/maven-crm'}). Start with the matching DATASET_DIR, or use a fresh database for the other dataset.`,
    );
  }
}

export async function loadSeed(db: Db, seed?: string, options: { dataDir?: string } = {}) {
  const s = buildSeed(seed, { dataDir: options.dataDir ?? process.env.DATASET_DIR });
  await db.transaction(async (tx) => {
    await tx.insert(schema.dataSnapshots).values(s.snapshot);
    await tx.insert(schema.regions).values(s.regions);
    await tx.insert(schema.appUsers).values(s.users);
    await tx.insert(schema.products).values(s.products);
    await tx.insert(schema.accounts).values(s.accounts);
    for (const c of chunks(s.accountTeam)) await tx.insert(schema.accountTeam).values(c);
    if (s.contacts.length) await tx.insert(schema.contacts).values(s.contacts);
    for (const c of chunks(s.opportunities)) await tx.insert(schema.opportunities).values(c);
    if (s.quotas.length) await tx.insert(schema.quotas).values(s.quotas); // none when no rep has won deals yet
    if (s.supportCases.length) await tx.insert(schema.supportCases).values(s.supportCases);
    if (s.engagements.length) await tx.insert(schema.engagements).values(s.engagements);
    if (s.productUsage.length) await tx.insert(schema.productUsage).values(s.productUsage);
  });
}
