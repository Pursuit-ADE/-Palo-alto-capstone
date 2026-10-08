// Database access. PGlite (embedded Postgres) by default so the app and tests run on any laptop
// without Docker; set DATABASE_URL to use a real Postgres in Week 2.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import * as schema from './schema';
import { buildSeed, DEFAULT_SEED } from './seed';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface Database {
  db: Db;
  client: PGlite;
}

const MIGRATIONS = path.join(process.cwd(), 'drizzle');

/** Opens a database, applies migrations and loads the deterministic seed if it is empty. */
export async function openDatabase(dataDir?: string, seed: string = DEFAULT_SEED): Promise<Database> {
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  const existing = await db.select().from(schema.dataSnapshots);
  if (existing.length === 0) await loadSeed(db, seed);
  return { db, client };
}

export async function loadSeed(db: Db, seed: string = DEFAULT_SEED) {
  const s = buildSeed(seed);
  await db.transaction(async (tx) => {
    await tx.insert(schema.dataSnapshots).values(s.snapshot);
    await tx.insert(schema.regions).values(s.regions);
    await tx.insert(schema.appUsers).values(s.users);
    await tx.insert(schema.accounts).values(s.accounts);
    await tx.insert(schema.accountTeam).values(s.accountTeam);
    await tx.insert(schema.contacts).values(s.contacts);
    await tx.insert(schema.opportunities).values(s.opportunities);
    await tx.insert(schema.quotas).values(s.quotas);
    if (s.supportCases.length) await tx.insert(schema.supportCases).values(s.supportCases);
    if (s.engagements.length) await tx.insert(schema.engagements).values(s.engagements);
  });
}
