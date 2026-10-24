// Question trends for the demo database (plan item 16). Counts by week, metric and outcome.
// No question text: the select list does not include the fingerprint column.
//   npm run trends
// Postgres: set MIGRATION_DATABASE_URL (the owner login). The app login cannot read the audit log.
// Laptop demo: the log lives in the running server. Sign in as the analyst and open /trends.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { formatTrends, questionTrends, type AuditCountInput } from '../src/audit/question-trends';
import { queryAudit } from '../src/db/schema';
import type { Db } from '../src/db/client';

const columns = {
  at: queryAudit.at,
  source: queryAudit.source,
  outcome: queryAudit.outcome,
  metricId: queryAudit.metricId,
};

async function fromPostgres(url: string): Promise<AuditCountInput[]> {
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const db = drizzle(pool, { schema: { queryAudit } }) as unknown as Db;
    return db.select(columns).from(queryAudit);
  } finally {
    await pool.end();
  }
}

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.log('The laptop demo keeps this log in the running server, not in a second database.');
  console.log('Sign in as the analyst and open http://localhost:3000/trends.');
  console.log('For Postgres, set MIGRATION_DATABASE_URL (the owner login) and run this again.');
  process.exit(0);
}

const rows = await fromPostgres(url);
console.log(formatTrends(questionTrends(rows)));
