// The question-trends agent, run weekly (client call, Oct 24). Reads only the count views through the read-only app
// login, so it can't see questions, users or the audit log, and it writes nothing to the database.
//   npm run trends:agent                       plain summary, worked out by code
//   TRENDS_AGENT=claude npm run trends:agent   Claude picks what matters (needs ANTHROPIC_API_KEY); numbers still from code
// npm run trends:agent reads .env.local if there is one (DATABASE_URL, ANTHROPIC_API_KEY); a variable already set in the
// shell wins over the file.
//   add -- --out reports/trends/2026-10-26.md  to save the summary as a file
// Postgres: set DATABASE_URL (the app login). The laptop demo keeps the log in the running server: open /trends.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { finishThenClose } from '../src/audit/question-trends';
import { agentSummary, plainSummary, trendFacts } from '../src/audit/trends-agent';
import { questionTopicsView, questionTrendsView } from '../src/db/schema';
import type { Db } from '../src/db/client';

const url = process.env.DATABASE_URL;
if (!url) {
  // Non-zero, so a weekly scheduler shows the run as failed instead of quietly writing nothing (PR #71 review).
  console.error('Set DATABASE_URL (the app login) to run the trends agent against Postgres.');
  console.error('The laptop demo keeps this log in the running server: sign in as the analyst and open http://localhost:3000/trends.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
const db = drizzle(pool, { schema: { questionTrendsView, questionTopicsView } }) as unknown as Db;
const [counts, topics] = await finishThenClose(
  () => Promise.all([db.select().from(questionTrendsView), db.select().from(questionTopicsView)]),
  () => pool.end(),
);

const facts = trendFacts(counts, topics);
const useClaude = process.env.TRENDS_AGENT === 'claude' && Boolean(process.env.ANTHROPIC_API_KEY);
const { text, by } = useClaude ? await agentSummary(facts, new Anthropic({ timeout: 30_000, maxRetries: 1 })) : { text: plainSummary(facts), by: 'code' as const };
console.log(text);
if (process.env.TRENDS_AGENT === 'claude' && by === 'code') console.error('\n(Claude was not used: no API key, an error, or output that failed the checks. This is the plain summary.)');

const outAt = process.argv.indexOf('--out');
if (outAt !== -1 && process.argv[outAt + 1]) {
  const out = path.resolve(process.argv[outAt + 1]!);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${text}\n`);
  console.error(`Saved to ${out}`);
}
