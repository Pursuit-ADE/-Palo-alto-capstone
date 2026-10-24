// Account administration for the demo sign-in (audit A2): disable an account, turn it back on, or sign it out
// everywhere. Runs against Postgres with the owner login, because the apps' own logins can't change accounts.
//   npm run accounts -- disable <username> [--app alerts]
//   npm run accounts -- enable <username> [--app alerts]
//   npm run accounts -- signout <username> [--app alerts]
// The copilot uses MIGRATION_DATABASE_URL. The alerts app has its own database: pass --app alerts and set
// ALERTS_MIGRATION_DATABASE_URL (or MIGRATION_DATABASE_URL pointing at the alerts database).
// The embedded laptop database lives inside the running server, so there it's enough to restart the server.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as copilotSchema from '../src/db/schema';
import * as alertsSchema from '../alerts/src/db/schema';
import { revokeSessions, setAccountDisabled } from '../src/server/auth';
import type { Db } from '../src/db/client';

const [action, username, ...rest] = process.argv.slice(2);
const app = rest.includes('--app') ? rest[rest.indexOf('--app') + 1] : 'copilot';
if (!['disable', 'enable', 'signout'].includes(action ?? '') || !username || !['copilot', 'alerts'].includes(app ?? '')) {
  console.error('Usage: npm run accounts -- disable|enable|signout <username> [--app copilot|alerts]');
  process.exit(2);
}
const url = app === 'alerts' ? (process.env.ALERTS_MIGRATION_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL) : process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('Set MIGRATION_DATABASE_URL (the owner login). With the embedded database, restart the server instead.');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
// Both apps' account tables have the same shape, so the copilot's functions work on either database.
const db = drizzle(pool, { schema: app === 'alerts' ? alertsSchema : copilotSchema }) as unknown as Db;
try {
  if (action === 'signout') {
    console.log(`Ended ${await revokeSessions(db, username)} session(s) for ${username} (${app}).`);
  } else {
    const found = await setAccountDisabled(db, username, action === 'disable');
    console.log(found ? `${username} is ${action === 'disable' ? 'disabled and signed out everywhere' : 'enabled'} (${app}).` : `No account named ${username} (${app}).`);
    if (!found) process.exitCode = 1;
  }
} finally {
  await pool.end();
}
