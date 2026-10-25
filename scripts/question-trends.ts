// Question trends (plan item 16). Counts by week, metric and outcome.
// No question text: the view has no fingerprint column.
//   npm run trends
// Postgres: set DATABASE_URL (the app login). It can read the counts view and cannot read the audit log.
// Laptop demo: the log lives in the running server. Sign in as the analyst and open /trends.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { finishThenClose, formatTrends } from '../src/audit/question-trends';
import { questionTrendsView } from '../src/db/schema';
import type { Db } from '../src/db/client';

async function fromPostgres(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  const db = drizzle(pool, { schema: { questionTrendsView } }) as unknown as Db;
  return finishThenClose(() => db.select().from(questionTrendsView), () => pool.end());
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('The laptop demo keeps this log in the running server, not in a second database.');
  console.log('Sign in as the analyst and open http://localhost:3000/trends.');
  console.log('For Postgres, set DATABASE_URL (the app login) and run this again.');
  process.exit(0);
}

const rows = await fromPostgres(url);
console.log(formatTrends(rows));
