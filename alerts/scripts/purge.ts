// Deletes alert history and sessions past retention (src/db/retention.ts) as the owner login. Run daily: `npm run purge`, or
// `npm run purge -- --dry-run` to only count. Needs MIGRATION_DATABASE_URL (the restricted logins can't delete
// audit rows, by design).
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Db } from '../src/db/client';
import { purge } from '../src/db/retention';
import * as schema from '../src/db/schema';

const owner = process.env.MIGRATION_DATABASE_URL;
if (!owner) {
  console.error('Set MIGRATION_DATABASE_URL (the owner login) to run the purge.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: owner, max: 1, connectionTimeoutMillis: 5000 });
try {
  const result = await purge(drizzle(pool, { schema }) as unknown as Db, { dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
